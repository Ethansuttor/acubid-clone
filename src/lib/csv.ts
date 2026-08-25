// CSV import/export for the item and assembly database.
//
// Populating labor units is the estimator's own long-running job, so the
// database has to round-trip through a spreadsheet. Import is deliberately
// strict: a row that cannot be understood is reported, never skipped
// silently, because a quietly dropped item becomes a quietly missing cost.

import type { Assembly, AssemblyItem, Item } from "./types";

/** RFC4180-style parser: quoted fields, "" escapes, CR/LF inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  // strip a UTF-8 BOM, which Excel writes and which would corrupt the first header
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // ignore a trailing blank line
    if (!(row.length === 1 && row[0].trim() === "")) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"' && field === "") {
      quoted = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      endField();
      i += 1;
      continue;
    }
    if (c === "\r") {
      if (text[i + 1] === "\n") i += 1;
      endRow();
      i += 1;
      continue;
    }
    if (c === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

// ---------------------------------------------------------------- items ----

export const ITEM_HEADERS = [
  "code",
  "description",
  "unit",
  "material_cost",
  "labor_hours",
] as const;

export function itemsToCsv(items: Item[]): string {
  return toCsv([
    [...ITEM_HEADERS],
    ...items.map((i) => [i.code, i.description, i.unit, i.material_cost, i.labor_hours]),
  ]);
}

export interface ImportedItem {
  code: string;
  description: string;
  unit: string;
  material_cost: number;
  labor_hours: number;
}

export interface ImportResult<T> {
  rows: T[];
  /** One entry per unusable input row, quoting the line number. */
  errors: string[];
}

function headerIndex(header: string[], required: readonly string[]): Map<string, number> | string {
  const norm = header.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const idx = new Map<string, number>();
  for (const key of required) {
    const at = norm.indexOf(key);
    if (at === -1) return `Missing required column "${key}". Expected: ${required.join(", ")}`;
    idx.set(key, at);
  }
  return idx;
}

function num(raw: string): number | null {
  const cleaned = (raw ?? "").replace(/[$,\s]/g, "");
  if (cleaned === "") return 0;
  const v = Number(cleaned);
  return Number.isFinite(v) ? v : null;
}

export function parseItemsCsv(text: string): ImportResult<ImportedItem> {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], errors: ["File is empty"] };
  const idx = headerIndex(table[0], ITEM_HEADERS);
  if (typeof idx === "string") return { rows: [], errors: [idx] };

  const rows: ImportedItem[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (let r = 1; r < table.length; r++) {
    const line = r + 1;
    const cells = table[r];
    if (cells.every((c) => c.trim() === "")) continue;
    const get = (k: string) => (cells[idx.get(k)!] ?? "").trim();

    const description = get("description");
    if (description === "") {
      errors.push(`Line ${line}: description is required`);
      continue;
    }
    const material_cost = num(get("material_cost"));
    const labor_hours = num(get("labor_hours"));
    if (material_cost === null) {
      errors.push(`Line ${line}: material_cost "${get("material_cost")}" is not a number`);
      continue;
    }
    if (labor_hours === null) {
      errors.push(`Line ${line}: labor_hours "${get("labor_hours")}" is not a number`);
      continue;
    }
    if (material_cost < 0 || labor_hours < 0) {
      errors.push(`Line ${line}: cost and labor hours cannot be negative`);
      continue;
    }
    const code = get("code");
    const key = code.toLowerCase();
    if (code !== "" && seen.has(key)) {
      errors.push(`Line ${line}: duplicate code "${code}" in this file`);
      continue;
    }
    if (code !== "") seen.add(key);

    rows.push({
      code,
      description,
      unit: get("unit") || "EA",
      material_cost,
      labor_hours,
    });
  }
  return { rows, errors };
}

/**
 * Merge imported rows into the existing database, matching on code
 * (case-insensitive). Rows with no code are always added as new items.
 */
export function mergeItems(
  existing: Item[],
  imported: ImportedItem[],
  userId: string
): { upserts: Item[]; added: number; updated: number } {
  const byCode = new Map<string, Item>();
  for (const it of existing) {
    if (it.code.trim() !== "") byCode.set(it.code.trim().toLowerCase(), it);
  }
  const upserts: Item[] = [];
  let added = 0;
  let updated = 0;
  for (const row of imported) {
    const match = row.code === "" ? undefined : byCode.get(row.code.toLowerCase());
    if (match) {
      upserts.push({ ...match, ...row });
      updated += 1;
    } else {
      upserts.push({ id: crypto.randomUUID(), user_id: userId, ...row });
      added += 1;
    }
  }
  return { upserts, added, updated };
}

// ----------------------------------------------------------- assemblies ----

export const ASSEMBLY_HEADERS = [
  "assembly_code",
  "assembly_name",
  "item_code",
  "quantity",
] as const;

export function assembliesToCsv(
  assemblies: Assembly[],
  assemblyItems: AssemblyItem[],
  items: Item[]
): string {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const rows: (string | number)[][] = [[...ASSEMBLY_HEADERS]];
  for (const a of assemblies) {
    const comps = assemblyItems.filter((ai) => ai.assembly_id === a.id);
    if (comps.length === 0) {
      rows.push([a.code, a.name, "", ""]);
      continue;
    }
    for (const c of comps) {
      rows.push([a.code, a.name, itemById.get(c.item_id)?.code ?? "", c.quantity]);
    }
  }
  return toCsv(rows);
}

export interface ImportedAssemblyRow {
  assemblyCode: string;
  assemblyName: string;
  itemCode: string;
  quantity: number;
}

export function parseAssembliesCsv(text: string): ImportResult<ImportedAssemblyRow> {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], errors: ["File is empty"] };
  const idx = headerIndex(table[0], ASSEMBLY_HEADERS);
  if (typeof idx === "string") return { rows: [], errors: [idx] };

  const rows: ImportedAssemblyRow[] = [];
  const errors: string[] = [];
  for (let r = 1; r < table.length; r++) {
    const line = r + 1;
    const cells = table[r];
    if (cells.every((c) => c.trim() === "")) continue;
    const get = (k: string) => (cells[idx.get(k)!] ?? "").trim();

    const assemblyCode = get("assembly_code");
    if (assemblyCode === "") {
      errors.push(`Line ${line}: assembly_code is required`);
      continue;
    }
    const itemCode = get("item_code");
    const qtyRaw = get("quantity");
    const quantity = itemCode === "" ? 0 : num(qtyRaw);
    if (quantity === null) {
      errors.push(`Line ${line}: quantity "${qtyRaw}" is not a number`);
      continue;
    }
    rows.push({
      assemblyCode,
      assemblyName: get("assembly_name") || assemblyCode,
      itemCode,
      quantity,
    });
  }
  return { rows, errors };
}

export interface AssemblyMerge {
  assemblies: Assembly[];
  components: AssemblyItem[];
  /** Assembly codes whose component rows referenced an unknown item code. */
  errors: string[];
  added: number;
  updated: number;
}

/**
 * Build assemblies and their components from imported rows. An item_code that
 * is not in the database is an error, never a skipped component: a silently
 * incomplete assembly under-extends every takeoff that uses it.
 */
export function mergeAssemblies(
  existingAssemblies: Assembly[],
  imported: ImportedAssemblyRow[],
  items: Item[],
  userId: string
): AssemblyMerge {
  const itemByCode = new Map(
    items.filter((i) => i.code.trim() !== "").map((i) => [i.code.trim().toLowerCase(), i])
  );
  const existingByCode = new Map(
    existingAssemblies
      .filter((a) => a.code.trim() !== "")
      .map((a) => [a.code.trim().toLowerCase(), a])
  );

  const assemblies: Assembly[] = [];
  const components: AssemblyItem[] = [];
  const errors: string[] = [];
  const resolved = new Map<string, Assembly>();
  let added = 0;
  let updated = 0;

  for (const row of imported) {
    const key = row.assemblyCode.toLowerCase();
    let assembly = resolved.get(key);
    if (!assembly) {
      const match = existingByCode.get(key);
      assembly = match
        ? { ...match, name: row.assemblyName }
        : {
            id: crypto.randomUUID(),
            user_id: userId,
            code: row.assemblyCode,
            name: row.assemblyName,
            description: "",
          };
      if (match) updated += 1;
      else added += 1;
      resolved.set(key, assembly);
      assemblies.push(assembly);
    }
    if (row.itemCode === "") continue;
    const item = itemByCode.get(row.itemCode.toLowerCase());
    if (!item) {
      errors.push(
        `Assembly "${row.assemblyCode}": item code "${row.itemCode}" is not in the item database — import the items first`
      );
      continue;
    }
    components.push({
      id: crypto.randomUUID(),
      assembly_id: assembly.id,
      item_id: item.id,
      user_id: userId,
      quantity: row.quantity,
    });
  }
  return { assemblies, components, errors, added, updated };
}
