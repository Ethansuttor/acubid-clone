/**
 * Row codec for the SQLite store: validates a JS row against the logical
 * schema and translates it to column values, and back.
 *
 * Fidelity rules (each has a test in tests/storage-contract):
 * - Every finite JS double round-trips bit-for-bit, including -0, both in
 *   numeric columns (stored in ANY columns) and inside JSON (written with
 *   JSON.rawJSON("-0") when a -0 is present).
 * - NaN, Infinity, bigint, functions, symbols, class instances and cyclic
 *   values are rejected with `invalid-input`. SQLite would otherwise bind NaN
 *   as NULL and JSON would write it as null: a silent change to a quantity.
 * - A known column that is absent from the row stays absent when read back;
 *   an explicit null stays null. A key whose value is `undefined` counts as
 *   absent, which is also what the portable JSON backup does.
 * - Unknown fields are preserved verbatim in `_extra`.
 * - Text must be well-formed UTF-16 (a lone surrogate cannot be stored as
 *   UTF-8 without being replaced).
 */

import type { SQLInputValue } from "node:sqlite";
import type { StorageRow } from "../../src/lib/platform/storage";
import { TABLE_SPECS, type ColumnSpec, type DomainTable, type TableSpec } from "./schema";

/** Raised for caller data that cannot be stored exactly; maps to invalid-input. */
export class StorageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageValidationError";
  }
}

type RawJson = (text: string) => unknown;
const rawJSON: RawJson | undefined = (JSON as unknown as { rawJSON?: RawJson }).rawJSON;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function wellFormed(value: string): boolean {
  return (value as string & { isWellFormed?: () => boolean }).isWellFormed?.() ?? true;
}

interface WalkState {
  negativeZero: boolean;
}

/**
 * Validate that `value` survives JSON exactly. Returns whether a -0 was seen,
 * so serialization only pays for the -0 replacer when it is needed.
 */
function walkJson(value: unknown, where: string, state: WalkState, ancestors: Set<object>): void {
  if (value === null) return;
  switch (typeof value) {
    case "string":
      if (!wellFormed(value)) throw new StorageValidationError(`${where} contains invalid characters.`);
      return;
    case "boolean":
      return;
    case "number":
      if (!Number.isFinite(value)) {
        throw new StorageValidationError(`${where} is not a finite number.`);
      }
      if (Object.is(value, -0)) state.negativeZero = true;
      return;
    case "object": {
      if (ancestors.has(value)) throw new StorageValidationError(`${where} refers to itself.`);
      ancestors.add(value);
      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
          if (value[index] === undefined) {
            throw new StorageValidationError(`${where}[${index}] is undefined.`);
          }
          walkJson(value[index], `${where}[${index}]`, state, ancestors);
        }
      } else if (isPlainObject(value)) {
        for (const key of Object.keys(value)) {
          if (!wellFormed(key)) throw new StorageValidationError(`${where} has an invalid key.`);
          const child = value[key];
          if (child === undefined) continue; // dropped, exactly like JSON
          walkJson(child, `${where}.${key}`, state, ancestors);
        }
      } else {
        throw new StorageValidationError(`${where} is not plain data.`);
      }
      ancestors.delete(value);
      return;
    }
    default:
      throw new StorageValidationError(`${where} cannot be stored (${typeof value}).`);
  }
}

function negativeZeroReplacer(_key: string, value: unknown): unknown {
  return typeof value === "number" && Object.is(value, -0) && rawJSON ? rawJSON("-0") : value;
}

/** Serialize validated JSON data, preserving -0. */
function stringifyValidated(value: unknown, negativeZero: boolean): string {
  if (negativeZero) {
    if (!rawJSON) throw new StorageValidationError("This runtime cannot store -0 exactly.");
    return JSON.stringify(value, negativeZeroReplacer);
  }
  return JSON.stringify(value);
}

/** Validate and serialize arbitrary JSON data (used for json columns and extras). */
export function encodeJson(value: unknown, where: string): string {
  const state: WalkState = { negativeZero: false };
  walkJson(value, where, state, new Set());
  return stringifyValidated(value, state.negativeZero);
}

/**
 * Lenient serializer for journal payloads that describe an operation rather
 * than hold data (filters and patches). Values that JSON cannot represent are
 * written the way JSON.stringify writes them; -0 is still preserved.
 */
export function encodeJournal(value: unknown): string {
  try {
    return encodeJson(value, "journal");
  } catch {
    return JSON.stringify(value) ?? "null";
  }
}

function describe(table: DomainTable, column: string): string {
  return `${table}.${column}`;
}

function encodeValue(table: DomainTable, column: ColumnSpec, value: unknown): SQLInputValue {
  const where = describe(table, column.name);
  switch (column.kind) {
    case "text":
      if (typeof value !== "string") throw new StorageValidationError(`${where} must be text.`);
      if (!wellFormed(value)) throw new StorageValidationError(`${where} contains invalid characters.`);
      return value;
    case "timestamp":
      if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
        throw new StorageValidationError(`${where} must be a date and time.`);
      }
      return value;
    case "enum":
      if (typeof value !== "string" || !column.values?.includes(value)) {
        throw new StorageValidationError(
          `${where} must be one of ${column.values?.join(", ") ?? "the allowed values"}.`
        );
      }
      return value;
    case "number":
    case "integer": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new StorageValidationError(`${where} must be a finite number.`);
      }
      if (column.kind === "integer" && !Number.isSafeInteger(value)) {
        throw new StorageValidationError(`${where} must be a whole number.`);
      }
      if (column.rule && !column.rule.test(value)) {
        throw new StorageValidationError(`${where} must be ${column.rule.describe}.`);
      }
      return value;
    }
    case "boolean":
      if (typeof value !== "boolean") throw new StorageValidationError(`${where} must be true or false.`);
      return value ? 1 : 0;
    case "json":
      if (column.object && !isPlainObject(value)) {
        throw new StorageValidationError(`${where} must be an object.`);
      }
      return encodeJson(value, where);
  }
}

export interface EncodedRow {
  /** Values in `columnOrder(table)` order: id, spec columns, _absent, _extra. */
  readonly params: SQLInputValue[];
  readonly id: string;
}

/** Column order used by every INSERT/UPDATE statement for a table. */
export function columnOrder(table: DomainTable): string[] {
  return ["id", ...TABLE_SPECS[table].columns.map((column) => column.name), "_absent", "_extra"];
}

const knownColumnCache = new Map<DomainTable, Set<string>>();
function knownColumns(spec: TableSpec): Set<string> {
  let known = knownColumnCache.get(spec.name);
  if (!known) {
    known = new Set(["id", ...spec.columns.map((column) => column.name)]);
    knownColumnCache.set(spec.name, known);
  }
  return known;
}

export function encodeRow(table: DomainTable, row: unknown): EncodedRow {
  if (!isPlainObject(row)) throw new StorageValidationError(`A ${table} record must be an object.`);
  const spec = TABLE_SPECS[table];
  const id = row.id;
  if (typeof id !== "string" || id.length === 0 || !wellFormed(id)) {
    throw new StorageValidationError(`A ${table} record needs a text id.`);
  }
  const params: SQLInputValue[] = [id];
  const absent: string[] = [];
  for (const column of spec.columns) {
    const value = row[column.name];
    if (value === undefined) {
      absent.push(column.name);
      params.push(null);
    } else if (value === null) {
      params.push(null);
    } else {
      params.push(encodeValue(table, column, value));
    }
  }
  const known = knownColumns(spec);
  let extra: Record<string, unknown> | null = null;
  for (const key of Object.keys(row)) {
    if (known.has(key) || row[key] === undefined) continue;
    extra ??= {};
    Object.defineProperty(extra, key, {
      value: row[key],
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  params.push(absent.length > 0 ? JSON.stringify(absent) : null);
  params.push(extra ? encodeJson(extra, `${table} record`) : null);
  return { params, id };
}

type SqlRow = Record<string, unknown>;

function assign(target: StorageRow, key: string, value: unknown): void {
  if (key === "__proto__") {
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  } else {
    target[key] = value;
  }
}

export function decodeRow(table: DomainTable, sql: SqlRow): StorageRow {
  const spec = TABLE_SPECS[table];
  const row: StorageRow = { id: sql.id };
  const absent = typeof sql._absent === "string" ? new Set(JSON.parse(sql._absent) as string[]) : null;
  for (const column of spec.columns) {
    const value = sql[column.name];
    if (value === null || value === undefined) {
      if (!absent?.has(column.name)) row[column.name] = null;
      continue;
    }
    if (column.kind === "boolean") row[column.name] = value === 1;
    else if (column.kind === "json") row[column.name] = JSON.parse(value as string);
    else row[column.name] = value;
  }
  if (typeof sql._extra === "string") {
    const extra = JSON.parse(sql._extra) as Record<string, unknown>;
    for (const key of Object.keys(extra)) assign(row, key, extra[key]);
  }
  return row;
}
