/**
 * Desktop SQLite adapter for the C1 `WorkspaceStoragePort` (track S2).
 *
 * Runs in a plain Node / Electron-main process: no DOM, IndexedDB, or Next.js
 * import. Driver: the runtime's built-in `node:sqlite` (`DatabaseSync`).
 *
 * Durability model
 * - WAL journal, `synchronous = FULL`: a commit is fsynced before the call
 *   resolves, so an acknowledged save survives a process kill (tested) and is
 *   intended to survive power loss to the extent the OS and disk honor fsync
 *   (not tested — see the handoff).
 * - Every mutation and its outbox row are written in ONE transaction
 *   (`BEGIN IMMEDIATE ... COMMIT`). The promise resolves only after COMMIT.
 *   There is no second, independent journal file.
 * - Row-level statements with indexes; no whole-workspace rewrite.
 * - Plan PDFs: content-addressed immutable files, published before the
 *   database reference is committed (see `plan-files.ts`).
 * - Foreign keys are enabled and verified at open.
 *
 * Behavior follows the browser store (`src/lib/localdb.ts`) wherever the port
 * contract is silent: insertion order, stable ordering, id/created_at/updated_at
 * defaults, the project `updated_at` touch, cascade set, and the journal
 * payload shapes. Stricter validation is intentional and listed in the S1-S2
 * handoff.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { accessSync, constants as fsConstants, mkdirSync, promises as fs } from "node:fs";
import path from "node:path";
import {
  backup as sqliteBackup,
  DatabaseSync,
  type SQLInputValue,
  type SQLOutputValue,
  type StatementSync,
} from "node:sqlite";

import { validateBackupSnapshot, type BackupData } from "../../src/lib/backup";
import {
  fail,
  failureFrom,
  ok,
  PLATFORM_CONTRACT_VERSION,
  type PlatformCapabilities,
  type PlatformResult,
} from "../../src/lib/platform/contracts";
import type {
  StorageFilter,
  StorageHealth,
  StorageOrder,
  StorageRow,
  StorageSelect,
  WorkspaceBundle,
  WorkspaceStoragePort,
} from "../../src/lib/platform/storage";
import type { RecoveryFile } from "../../src/lib/recovery-folder";
import { recoveryFilenameForPath } from "../../src/lib/recovery-folder";
import type { AssemblyItem } from "../../src/lib/types";
import { columnOrder, decodeRow, encodeJournal, encodeRow, StorageValidationError } from "./codec";
import { describeFailure, storageFailure, StoreError } from "./errors";
import { WorkspaceLockFile } from "./lock";
import { PlanFileStore, type StagedFile } from "./plan-files";
import {
  APPLICATION_ID,
  DOMAIN_TABLES,
  INSERT_ORDER,
  isDomainTable,
  MIGRATIONS,
  TABLE_SPECS,
  type DomainTable,
  type Migration,
} from "./schema";

export const DATABASE_FILE = "voltline.db";
export const LOCK_FILE = "workspace.lock";
export const PLANS_DIR = "plans";
export const DEFAULT_BUSY_TIMEOUT_MS = 5000;
const MAX_STORAGE_PATH = 1024;

export const SQLITE_STORAGE_CAPABILITIES: PlatformCapabilities = {
  kind: "desktop",
  contractVersion: PLATFORM_CONTRACT_VERSION,
  recordStore: "sqlite",
  fileStore: "filesystem",
  // A cross-process OS file lock (see lock.ts), not Web Locks.
  exclusiveWorkspaceLock: true,
  folderMirror: false,
  portableBackup: true,
  // The storage adapter does not provide AI or credentials; the integration
  // step composes the final runtime capabilities.
  aiTransport: "unavailable",
  managedCredentials: false,
};

/**
 * Test-only fault injection. Production callers never pass hooks. Each hook
 * runs at a precise durability boundary so tests can fail or kill the process
 * there and prove what survives.
 */
export interface SqliteStoreHooks {
  /** Inside every write transaction, immediately before COMMIT. Throwing rolls back. */
  beforeCommit?(operation: string): void;
  /** After plan bytes are staged and verified, before they are published. */
  afterStage?(storagePath: string): void | Promise<void>;
  /** After plan bytes are published, before the reference is committed. */
  afterPublish?(storagePath: string): void | Promise<void>;
}

export interface SqliteStoreOptions {
  /** Absolute, app-managed directory (e.g. Electron `app.getPath("userData")`
   * plus a workspace folder). Never the install directory or repository. */
  readonly dataDir: string;
  /** How long a write waits for another process's transaction. */
  readonly busyTimeoutMs?: number;
  readonly hooks?: SqliteStoreHooks;
  /**
   * Test seam: the ordered migration list. Production callers omit it and get
   * the shipped `MIGRATIONS`. Tests pass a longer list to prove that an
   * upgrade preserves data and that a failing upgrade rolls back whole.
   */
  readonly migrations?: readonly Migration[];
}

export interface EditingLease {
  release(): void;
}

export interface SqliteDiagnostics {
  readonly sqliteVersion: string;
  readonly journalMode: string;
  readonly synchronous: number;
  readonly foreignKeys: boolean;
  readonly userVersion: number;
  readonly applicationId: number;
  readonly busyTimeoutMs: number;
  readonly outboxRows: number;
}

export interface PlanObjectReference {
  readonly sha256: string;
  readonly size: number;
  /** Logical paths currently mapped to these bytes. */
  readonly livePaths: readonly string[];
  /** Logical paths that were removed but still record these bytes. */
  readonly retiredPaths: readonly string[];
  /** Live documents whose storage_path maps to these bytes. */
  readonly documentReferences: number;
  /** Frozen bid snapshots whose payload documents map to these bytes. */
  readonly snapshotReferences: number;
}

export interface PlanFileInventory {
  readonly objects: readonly PlanObjectReference[];
  /** Objects on disk that no path (live or retired) records. */
  readonly unreferencedObjects: readonly string[];
  /** Hashes recorded in the database whose bytes are not on disk. */
  readonly missingObjects: readonly string[];
  /** Staging files left by an interrupted upload. */
  readonly stagingFiles: readonly string[];
}

export interface DatabaseBackupResult {
  readonly pages: number;
  readonly bytes: number;
  readonly userVersion: number;
  readonly integrity: "ok";
}

export interface IntegrityReport {
  readonly integrityCheck: readonly string[];
  readonly foreignKeyViolations: number;
  readonly missingObjects: readonly string[];
}

type SqlRow = Record<string, SQLOutputValue>;

function nowIso(): string {
  return new Date().toISOString();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function requireTable(name: unknown): DomainTable {
  if (!isDomainTable(name)) throw new StorageValidationError("Unknown table.");
  return name;
}

function checkFilters(filters: unknown): asserts filters is readonly StorageFilter[] {
  if (!Array.isArray(filters)) throw new StorageValidationError("Filters must be a list.");
  for (const filter of filters) {
    const valid =
      isPlainObject(filter) &&
      typeof filter.column === "string" &&
      ((filter.kind === "eq" && "value" in filter) ||
        (filter.kind === "in" && Array.isArray(filter.values)));
    if (!valid) throw new StorageValidationError("A filter is not understood.");
  }
}

function checkOrder(order: unknown): asserts order is StorageOrder | undefined {
  if (order === undefined) return;
  if (!isPlainObject(order) || typeof order.column !== "string" || typeof order.ascending !== "boolean") {
    throw new StorageValidationError("The sort order is not understood.");
  }
}

/** Same semantics as the browser store: strict equality / SameValueZero. */
function matches(row: StorageRow, filters: readonly StorageFilter[]): boolean {
  return filters.every((filter) =>
    filter.kind === "eq"
      ? row[filter.column] === filter.value
      : new Set(filter.values).has(row[filter.column])
  );
}

/** Same comparator as the browser store, applied as a stable sort. */
function sortRows(rows: StorageRow[], order: StorageOrder): StorageRow[] {
  const { column, ascending } = order;
  return [...rows].sort((a, b) => {
    const left = a[column] as string | number;
    const right = b[column] as string | number;
    return (left < right ? -1 : left > right ? 1 : 0) * (ascending ? 1 : -1);
  });
}

const TEXT_KINDS = new Set(["text", "timestamp", "enum"]);

function pushdownColumn(table: DomainTable, column: string): boolean {
  if (column === "id") return true;
  const spec = TABLE_SPECS[table].columns.find((candidate) => candidate.name === column);
  return !!spec && TEXT_KINDS.has(spec.kind);
}

function quoted(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function pragmaValue(db: DatabaseSync, pragma: string): SQLOutputValue {
  const row = db.prepare(`PRAGMA ${pragma}`).get();
  return row ? Object.values(row)[0] : null;
}

function configure(db: DatabaseSync, busyTimeoutMs: number): void {
  db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(busyTimeoutMs))}`);
  const journal = db.prepare("PRAGMA journal_mode = WAL").get();
  if (!journal || String(Object.values(journal)[0]).toLowerCase() !== "wal") {
    throw new StoreError("unavailable", "The workspace database could not enable write-ahead logging.");
  }
  db.exec("PRAGMA synchronous = FULL");
  if (pragmaValue(db, "synchronous") !== 2) {
    throw new StoreError("unavailable", "The workspace database could not enable full synchronous writes.");
  }
  db.exec("PRAGMA foreign_keys = ON");
  if (pragmaValue(db, "foreign_keys") !== 1) {
    throw new StoreError("unavailable", "The workspace database could not enforce record relationships.");
  }
  // Refuse schema-corrupting statements even if SQL were ever injected.
  db.enableDefensive(true);
}

function migrate(db: DatabaseSync, migrations: readonly Migration[]): void {
  const target = migrations[migrations.length - 1].version;
  const applicationId = Number(pragmaValue(db, "application_id"));
  const version = Number(pragmaValue(db, "user_version"));
  if (applicationId !== 0 && applicationId !== APPLICATION_ID) {
    throw new StoreError("integrity", "This file is not a Voltline workspace.");
  }
  if (version > target) {
    throw new StoreError(
      "unavailable",
      "This workspace was saved by a newer version of Voltline. Update Voltline to open it. Nothing was changed."
    );
  }
  if (version === target) {
    if (applicationId !== APPLICATION_ID) throw new StoreError("integrity", "This file is not a Voltline workspace.");
    return;
  }
  if (version === 0) {
    // A brand-new file is empty; anything else with no version is foreign.
    const objects = Number(db.prepare("SELECT count(*) AS n FROM sqlite_schema").get()?.n ?? 0);
    if (objects > 0) throw new StoreError("integrity", "This file is not a Voltline workspace.");
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    // Another process may have migrated while this one waited for the lock.
    const current = Number(pragmaValue(db, "user_version"));
    for (const migration of migrations) {
      if (migration.version <= current) continue;
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${migration.version}`);
    }
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

function verifySchema(db: DatabaseSync): void {
  for (const table of DOMAIN_TABLES) {
    const columns = new Set(
      db.prepare(`PRAGMA table_info(${quoted(table)})`).all().map((column) => String(column.name))
    );
    const expected = ["_seq", ...columnOrder(table)];
    if (!expected.every((name) => columns.has(name))) {
      throw new StoreError("integrity", "The workspace schema does not match this version of Voltline.");
    }
  }
  for (const table of ["outbox", "plan_files"]) {
    if (db.prepare(`PRAGMA table_info(${quoted(table)})`).all().length === 0) {
      throw new StoreError("integrity", "The workspace schema does not match this version of Voltline.");
    }
  }
}

/** Relations the SQLite schema enforces beyond `validateBackupSnapshot`. */
function validateRestoreGraph(tables: Record<string, StorageRow[]>): void {
  const ids = (table: DomainTable) => new Set((tables[table] ?? []).map((row) => row.id));
  const assemblies = ids("assemblies");
  const items = ids("items");
  for (const row of tables.assembly_items ?? []) {
    if (
      (row.assembly_id != null && !assemblies.has(row.assembly_id)) ||
      (row.item_id != null && !items.has(row.item_id))
    ) {
      throw new StorageValidationError("Backup has an assembly component without its assembly or item.");
    }
  }
  const unique = (table: DomainTable, columns: [string, string], message: string) => {
    const seen = new Set<string>();
    for (const row of tables[table] ?? []) {
      const [a, b] = columns.map((column) => row[column]);
      if (a == null || b == null) continue;
      const key = JSON.stringify([a, b]);
      if (seen.has(key)) throw new StorageValidationError(message);
      seen.add(key);
    }
  };
  unique("sheets", ["document_id", "page_number"], "Backup has two sheets for the same document page.");
  unique("bid_snapshots", ["project_id", "revision"], "Backup has two bid snapshots with the same revision.");
}

function closedFailure<T>(): PlatformResult<T> {
  return fail("unavailable", "This workspace store has been closed.");
}

export class SqliteWorkspaceStore implements WorkspaceStoragePort {
  readonly capabilities = SQLITE_STORAGE_CAPABILITIES;
  readonly dataDir: string;

  private queue: Promise<unknown> = Promise.resolve();
  private readonly statements = new Map<string, StatementSync>();
  private holder: { kind: "maintenance" | "editing"; token: symbol } | null = null;
  private readonly maintenanceContext = new AsyncLocalStorage<symbol>();
  private lastWriteFailure: string | null = null;
  private closed = false;

  private constructor(
    private readonly db: DatabaseSync,
    private readonly files: PlanFileStore,
    private readonly lockFile: WorkspaceLockFile,
    dataDir: string,
    private readonly busyTimeoutMs: number,
    private readonly hooks: SqliteStoreHooks | undefined,
    private readonly schemaVersion: number
  ) {
    this.dataDir = dataDir;
  }

  /** Open (creating and migrating when needed) the workspace in `dataDir`. */
  static async open(options: SqliteStoreOptions): Promise<PlatformResult<SqliteWorkspaceStore>> {
    const dataDir = options?.dataDir;
    if (typeof dataDir !== "string" || !path.isAbsolute(dataDir)) {
      return fail("invalid-input", "The workspace location must be an absolute, app-managed folder.");
    }
    const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
    const migrations = options.migrations ?? MIGRATIONS;
    let db: DatabaseSync | null = null;
    try {
      mkdirSync(dataDir, { recursive: true });
      const files = new PlanFileStore(path.join(dataDir, PLANS_DIR));
      await files.ensureDirectories();
      db = new DatabaseSync(path.join(dataDir, DATABASE_FILE), {
        timeout: busyTimeoutMs,
        enableForeignKeyConstraints: true,
      });
      configure(db, busyTimeoutMs);
      migrate(db, migrations);
      verifySchema(db);
      const lockFile = new WorkspaceLockFile(path.join(dataDir, LOCK_FILE));
      return ok(
        new SqliteWorkspaceStore(
          db,
          files,
          lockFile,
          dataDir,
          busyTimeoutMs,
          options.hooks,
          migrations[migrations.length - 1].version
        )
      );
    } catch (error) {
      try {
        db?.close();
      } catch {
        // The open failure is the error worth reporting.
      }
      return storageFailure(error, "The workspace could not be opened.");
    }
  }

  // ------------------------------------------------------------ plumbing

  private serial<T>(job: () => Promise<T> | T): Promise<T> {
    const run = async () => job();
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async read<T>(fallback: string, job: () => Promise<T> | T): Promise<PlatformResult<T>> {
    if (this.closed) return closedFailure();
    try {
      return ok(await this.serial(job));
    } catch (error) {
      return storageFailure(error, fallback);
    }
  }

  private async mutate<T>(fallback: string, job: () => Promise<T> | T): Promise<PlatformResult<T>> {
    if (this.closed) return closedFailure();
    try {
      const value = await this.serial(job);
      this.lastWriteFailure = null;
      return ok(value);
    } catch (error) {
      const failure = describeFailure(error, fallback);
      if (failure.code === "io-failed" || failure.code === "integrity") {
        this.lastWriteFailure = failure.message;
      }
      return fail(failure.code, failure.message);
    }
  }

  private stmt(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  /** One write transaction. The caller's promise resolves only after COMMIT. */
  private transaction<T>(operation: string, body: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = body();
      this.hooks?.beforeCommit?.(operation);
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      if (this.db.isTransaction) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
          this.lastWriteFailure = "The workspace database could not roll back a failed change.";
        }
      }
      throw error;
    }
  }

  /** A consistent read snapshot across several statements. */
  private readTransaction<T>(body: () => T): T {
    this.db.exec("BEGIN");
    try {
      const value = body();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private journal(table: string, operation: string, payload: unknown, at: string): void {
    this.stmt(
      "INSERT INTO outbox (id, created_at, table_name, operation, payload) VALUES (?, ?, ?, ?, ?)"
    ).run(randomUUID(), at, table, operation, encodeJournal(payload));
  }

  private readRows(table: DomainTable, filters: readonly StorageFilter[]): { seq: number; row: StorageRow }[] {
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];
    for (const filter of filters) {
      if (!pushdownColumn(table, filter.column)) continue;
      if (filter.kind === "eq") {
        if (typeof filter.value !== "string") continue;
        clauses.push(`${quoted(filter.column)} = ?`);
        params.push(filter.value);
      } else if (filter.values.every((value) => typeof value === "string")) {
        clauses.push(`${quoted(filter.column)} IN (SELECT value FROM json_each(?))`);
        params.push(JSON.stringify(filter.values));
      }
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.stmt(`SELECT * FROM ${quoted(table)}${where} ORDER BY _seq`).all(...params);
    const output: { seq: number; row: StorageRow }[] = [];
    for (const sql of rows) {
      const row = decodeRow(table, sql);
      // SQL narrows by index; the JS check is the authority, so filter
      // semantics are identical to the browser store for every value type.
      if (matches(row, filters)) output.push({ seq: Number(sql._seq), row });
    }
    return output;
  }

  private insertSql(table: DomainTable): string {
    const columns = columnOrder(table);
    return `INSERT INTO ${quoted(table)} (${columns.map(quoted).join(", ")}) VALUES (${columns
      .map(() => "?")
      .join(", ")})`;
  }

  private updateSql(table: DomainTable): string {
    return `UPDATE ${quoted(table)} SET ${columnOrder(table)
      .map((column) => `${quoted(column)} = ?`)
      .join(", ")} WHERE _seq = ?`;
  }

  /** Validate, write one row (insert or in-place update), return it as stored. */
  private writeRow(table: DomainTable, row: StorageRow, seq?: number): StorageRow {
    const { params } = encodeRow(table, row);
    if (seq === undefined) this.stmt(this.insertSql(table)).run(...params);
    else this.stmt(this.updateSql(table)).run(...params, seq);
    const columns = columnOrder(table);
    const stored: SqlRow = {};
    columns.forEach((column, index) => {
      stored[column] = params[index] as SQLOutputValue;
    });
    return decodeRow(table, stored);
  }

  private rowById(table: DomainTable, id: unknown): SqlRow | undefined {
    if (typeof id !== "string") return undefined;
    return this.stmt(`SELECT * FROM ${quoted(table)} WHERE id = ?`).get(id);
  }

  /** Mirrors the browser store: a change to a project's records bumps it. */
  private touchProjects(rows: readonly StorageRow[], at: string): void {
    const ids = new Set<string>();
    for (const row of rows) if (typeof row.project_id === "string") ids.add(row.project_id);
    for (const id of ids) {
      const found = this.rowById("projects", id);
      if (!found) continue;
      this.writeRow("projects", { ...decodeRow("projects", found), updated_at: at }, Number(found._seq));
    }
  }

  /** Transactional revision allocation when the caller did not choose one. */
  private withAllocatedRevision(row: StorageRow): StorageRow {
    if (row.revision !== undefined && row.revision !== null) return row;
    if (typeof row.project_id !== "string") return row;
    const next = this.stmt(
      "SELECT COALESCE(MAX(revision), 0) + 1 AS next FROM bid_snapshots WHERE project_id = ?"
    ).get(row.project_id);
    return { ...row, revision: Number(next?.next ?? 1) };
  }

  private workspaceIsEmpty(): boolean {
    return DOMAIN_TABLES.every(
      (table) => !this.stmt(`SELECT EXISTS (SELECT 1 FROM ${quoted(table)}) AS present`).get()?.present
    );
  }

  private acquire(kind: "maintenance" | "editing"): symbol | null {
    if (this.holder) return null;
    if (!this.lockFile.tryAcquire()) return null;
    const token = Symbol(kind);
    this.holder = { kind, token };
    return token;
  }

  private releaseHolder(token: symbol): void {
    if (this.holder?.token !== token) return;
    this.holder = null;
    this.lockFile.release();
  }

  // ------------------------------------------------------------ records

  async select(query: StorageSelect): Promise<PlatformResult<StorageRow[]>> {
    return this.read("This estimate could not be read.", () => {
      const table = requireTable(query?.table);
      const filters = query.filters ?? [];
      checkFilters(filters);
      checkOrder(query.order);
      const rows = this.readRows(table, filters).map((entry) => entry.row);
      return query.order ? sortRows(rows, query.order) : rows;
    });
  }

  async insert(table: string, rows: readonly StorageRow[]): Promise<PlatformResult<StorageRow[]>> {
    return this.mutate("This change could not be saved.", () => {
      const name = requireTable(table);
      if (!Array.isArray(rows) || !rows.every(isPlainObject)) {
        throw new StorageValidationError("Records to save must be a list of objects.");
      }
      const at = nowIso();
      return this.transaction("insert", () => {
        const stored: StorageRow[] = [];
        for (const raw of rows) {
          let row: StorageRow = { id: randomUUID(), created_at: at, updated_at: at, ...raw };
          if (name === "bid_snapshots") row = this.withAllocatedRevision(row);
          stored.push(this.writeRow(name, row));
        }
        this.touchProjects(stored, at);
        this.journal(name, "insert", stored, at);
        return stored;
      });
    });
  }

  /**
   * Insert-or-merge by id, with the browser store's semantics. Not part of the
   * frozen C1 port (the app's `.upsert()` call sites need it; see the S1-S2
   * handoff contract request).
   */
  async upsert(table: string, rows: readonly StorageRow[]): Promise<PlatformResult<StorageRow[]>> {
    return this.mutate("This change could not be saved.", () => {
      const name = requireTable(table);
      if (!Array.isArray(rows) || !rows.every(isPlainObject)) {
        throw new StorageValidationError("Records to save must be a list of objects.");
      }
      const at = nowIso();
      return this.transaction("upsert", () => {
        const stored: StorageRow[] = [];
        const touched: StorageRow[] = [];
        for (const raw of rows) {
          const row: StorageRow = { id: randomUUID(), created_at: at, updated_at: at, ...raw };
          const existing = this.rowById(name, row.id);
          if (existing) {
            stored.push(
              this.writeRow(name, { ...decodeRow(name, existing), ...row }, Number(existing._seq))
            );
          } else {
            stored.push(this.writeRow(name, name === "bid_snapshots" ? this.withAllocatedRevision(row) : row));
          }
          touched.push(row);
        }
        this.touchProjects(touched, at);
        this.journal(name, "upsert", stored, at);
        return stored;
      });
    });
  }

  async update(
    table: string,
    patch: StorageRow,
    filters: readonly StorageFilter[]
  ): Promise<PlatformResult<void>> {
    return this.mutate("This change could not be saved.", () => {
      const name = requireTable(table);
      if (!isPlainObject(patch)) throw new StorageValidationError("A change must be an object.");
      checkFilters(filters);
      const at = nowIso();
      this.transaction("update", () => {
        const touched: StorageRow[] = [];
        for (const { seq, row } of this.readRows(name, filters)) {
          const next: StorageRow = {
            ...row,
            ...patch,
            ...(name === "projects" ? { updated_at: at } : {}),
          };
          const stored = this.writeRow(name, next, seq);
          if (matches(stored, filters)) touched.push(stored);
        }
        this.touchProjects(touched, at);
        this.journal(name, "update", { filters, patch }, at);
      });
    });
  }

  async remove(table: string, filters: readonly StorageFilter[]): Promise<PlatformResult<void>> {
    return this.mutate("This record could not be deleted.", () => {
      const name = requireTable(table);
      checkFilters(filters);
      const at = nowIso();
      this.transaction("delete", () => {
        const doomed = this.readRows(name, filters);
        if (doomed.length > 0) {
          // Foreign-key cascades remove dependents in the same statement; the
          // document trigger retires the logical plan path of any document
          // removed directly or by cascade.
          this.stmt(`DELETE FROM ${quoted(name)} WHERE _seq IN (SELECT value FROM json_each(?))`).run(
            JSON.stringify(doomed.map((entry) => entry.seq))
          );
        }
        const rows = doomed.map((entry) => entry.row);
        this.touchProjects(rows, at);
        this.journal(name, "delete", { filters, deleted: rows }, at);
      });
    });
  }

  async replaceAssemblyItems(
    assemblyId: string,
    rows: readonly AssemblyItem[]
  ): Promise<PlatformResult<void>> {
    return this.mutate("Assembly components could not be saved.", () => {
      if (!Array.isArray(rows)) throw new StorageValidationError("Assembly components must be a list.");
      const invalid = () =>
        new StorageValidationError(
          "Invalid assembly component list. The saved components have been preserved."
        );
      const at = nowIso();
      this.transaction("replace-assembly-items", () => {
        if (!this.rowById("assemblies", assemblyId)) {
          throw new StorageValidationError("Assembly no longer exists.");
        }
        const seen = new Set<unknown>();
        for (const row of rows as readonly StorageRow[]) {
          const quantity = row?.quantity;
          const takenElsewhere =
            typeof row?.id === "string" &&
            !!this.stmt("SELECT 1 AS hit FROM assembly_items WHERE id = ? AND assembly_id IS NOT ?").get(
              row.id,
              assemblyId
            );
          if (
            !isPlainObject(row) ||
            !row.id ||
            seen.has(row.id) ||
            takenElsewhere ||
            row.assembly_id !== assemblyId ||
            !this.rowById("items", row.item_id) ||
            typeof quantity !== "number" ||
            !Number.isFinite(quantity) ||
            quantity < 0
          ) {
            throw invalid();
          }
          seen.add(row.id);
        }
        this.stmt("DELETE FROM assembly_items WHERE assembly_id = ?").run(assemblyId);
        for (const row of rows) this.writeRow("assembly_items", { ...row });
        this.journal("assembly_items", "replace", { assemblyId, rows }, at);
      });
    });
  }

  // ------------------------------------------------------------ plan files

  async uploadFile(storagePath: string, blob: Blob): Promise<PlatformResult<{ path: string }>> {
    return this.mutate("This plan file could not be stored.", async () => {
      if (
        typeof storagePath !== "string" ||
        storagePath.length === 0 ||
        storagePath.length > MAX_STORAGE_PATH ||
        !storagePath.isWellFormed()
      ) {
        throw new StorageValidationError("The plan file name is not valid.");
      }
      if (!(blob instanceof Blob)) throw new StorageValidationError("Plan file contents are missing.");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const staged: StagedFile = await this.files.stage(bytes);
      let published = false;
      try {
        await this.hooks?.afterStage?.(storagePath);
        await this.files.publish(staged);
        published = true;
        await this.hooks?.afterPublish?.(storagePath);
      } catch (error) {
        // A thrown failure cleans its staging file; a crash may leave it
        // behind, which is harmless because nothing references it.
        if (!published) await fs.rm(staged.stagedPath, { force: true }).catch(() => undefined);
        throw error;
      }
      const sha256 = staged.sha256;
      const at = nowIso();
      this.transaction("upload", () => {
        const existing = this.stmt(
          "SELECT sha256, removed_at FROM plan_files WHERE storage_path = ?"
        ).get(storagePath);
        if (existing && existing.sha256 !== sha256) {
          throw new StoreError(
            "conflict",
            "A different plan file is already stored under this name. Nothing was replaced."
          );
        }
        if (!existing) {
          this.stmt(
            "INSERT INTO plan_files (storage_path, sha256, size, content_type, created_at) VALUES (?, ?, ?, ?, ?)"
          ).run(storagePath, sha256, bytes.byteLength, blob.type, at);
        } else if (existing.removed_at !== null) {
          this.stmt("UPDATE plan_files SET removed_at = NULL WHERE storage_path = ?").run(storagePath);
        }
        this.journal(
          "storage.objects",
          "upload",
          { path: storagePath, size: bytes.byteLength, type: blob.type, sha256 },
          at
        );
      });
      return { path: storagePath };
    });
  }

  async downloadFile(storagePath: string): Promise<PlatformResult<Blob>> {
    return this.read("This plan file could not be read.", async () => {
      const row = this.stmt(
        "SELECT sha256, size, content_type FROM plan_files WHERE storage_path = ? AND removed_at IS NULL"
      ).get(typeof storagePath === "string" ? storagePath : "");
      if (!row) throw new StoreError("not-found", "That plan file is not in this workspace.");
      const bytes = await this.files.read(String(row.sha256), Number(row.size));
      return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: String(row.content_type) });
    });
  }

  async removeFiles(paths: readonly string[]): Promise<PlatformResult<void>> {
    return this.mutate("Plan files could not be removed.", () => {
      if (!Array.isArray(paths) || !paths.every((entry) => typeof entry === "string")) {
        throw new StorageValidationError("Plan file names must be a list of text.");
      }
      const at = nowIso();
      this.transaction("remove-files", () => {
        for (const storagePath of paths) {
          // Bytes are retained on disk: frozen snapshots and backups may still
          // refer to them. Only the logical path is retired.
          this.stmt(
            "UPDATE plan_files SET removed_at = ? WHERE storage_path = ? AND removed_at IS NULL"
          ).run(at, storagePath);
        }
        this.journal("storage.objects", "delete", { paths }, at);
      });
    });
  }

  // ------------------------------------------------------------ whole workspace

  async exportBundle(): Promise<PlatformResult<WorkspaceBundle>> {
    return this.read("This workspace could not be exported.", async () => {
      const exportedAt = nowIso();
      const { tables, planRows } = this.readTransaction(() => {
        const tables: Record<string, StorageRow[]> = {};
        for (const table of DOMAIN_TABLES) {
          tables[table] = this.stmt(`SELECT * FROM ${quoted(table)} ORDER BY _seq`)
            .all()
            .map((row) => decodeRow(table, row));
        }
        const planRows = this.stmt(
          "SELECT storage_path, sha256, size, content_type, removed_at FROM plan_files ORDER BY rowid"
        ).all();
        return { tables, planRows };
      });
      // Live paths, plus retired paths a frozen snapshot still refers to, so an
      // issued revision's drawings travel with the backup.
      const snapshotPaths = new Set<string>();
      for (const snapshot of tables.bid_snapshots) {
        const documents = (snapshot.payload as { documents?: unknown } | null)?.documents;
        if (!Array.isArray(documents)) continue;
        for (const document of documents) {
          const storagePath = (document as { storage_path?: unknown } | null)?.storage_path;
          if (typeof storagePath === "string") snapshotPaths.add(storagePath);
        }
      }
      const files: RecoveryFile[] = [];
      for (const row of planRows) {
        const storagePath = String(row.storage_path);
        if (row.removed_at !== null && !snapshotPaths.has(storagePath)) continue;
        // Published objects are immutable and never deleted, so reading them
        // after the snapshot transaction still yields the snapshot's bytes.
        const bytes = await this.files.read(String(row.sha256), Number(row.size));
        files.push({
          path: storagePath,
          blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: String(row.content_type) }),
        });
      }
      return {
        snapshot: {
          format: "voltline-recovery" as const,
          schema_version: 1 as const,
          exported_at: exportedAt,
          tables,
          files: files.map(({ path: filePath }) => ({
            path: filePath,
            recovery_filename: recoveryFilenameForPath(filePath),
          })),
        },
        files,
      };
    });
  }

  async restore(data: BackupData): Promise<PlatformResult<void>> {
    if (this.closed) return closedFailure();
    // 1. Validate everything without touching storage.
    let encoded: { table: DomainTable; rows: StorageRow[] }[];
    try {
      validateBackupSnapshot(
        data?.snapshot,
        Array.isArray(data?.files) ? data.files.map((file) => file.path) : []
      );
      validateRestoreGraph(data.snapshot.tables);
      encoded = INSERT_ORDER.map((table) => {
        const rows = (data.snapshot.tables[table] ?? []) as StorageRow[];
        rows.forEach((row) => encodeRow(table, row));
        return { table, rows };
      });
      for (const file of data.files) {
        if (!(file.blob instanceof Blob) || typeof file.path !== "string" || !file.path.isWellFormed()) {
          throw new StorageValidationError("Backup contains invalid plan data.");
        }
      }
    } catch (error) {
      return fail(
        "invalid-input",
        error instanceof Error && error.message ? error.message : "This backup could not be restored."
      );
    }
    // 2. Exclusive access. A restore issued from inside this store's own
    //    maintenance job already holds it.
    const insideOwnJob =
      this.holder?.kind === "maintenance" && this.maintenanceContext.getStore() === this.holder.token;
    let token: symbol | null = null;
    if (!insideOwnJob) {
      try {
        token = this.acquire("maintenance");
      } catch (error) {
        return storageFailure(error, "The workspace lock could not be taken.");
      }
      if (!token) {
        return fail("occupied", "The workspace is open in another window or process. Nothing was replaced.");
      }
    }
    try {
      return await this.mutate("This backup could not be restored.", async () => {
        const occupied = () =>
          new StoreError("occupied", "Restore requires an empty workspace. Nothing has been replaced.");
        if (!this.workspaceIsEmpty()) throw occupied();
        // 3. Stage, verify and publish every plan file before any reference.
        const published: { path: string; sha256: string; size: number; type: string }[] = [];
        for (const file of data.files) {
          const bytes = new Uint8Array(await file.blob.arrayBuffer());
          const staged = await this.files.stage(bytes);
          await this.files.publish(staged);
          published.push({ path: file.path, sha256: staged.sha256, size: staged.size, type: file.blob.type });
        }
        // 4. One transaction for every record, path and the journal entry.
        const at = nowIso();
        this.transaction("restore", () => {
          if (!this.workspaceIsEmpty()) throw occupied();
          this.db.exec("PRAGMA defer_foreign_keys = ON");
          // No record exists, so no current path is referenced; the retired
          // bytes stay on disk untouched.
          this.stmt("DELETE FROM plan_files").run();
          for (const file of published) {
            this.stmt(
              "INSERT INTO plan_files (storage_path, sha256, size, content_type, created_at) VALUES (?, ?, ?, ?, ?)"
            ).run(file.path, file.sha256, file.size, file.type, at);
          }
          for (const { table, rows } of encoded) {
            for (const row of rows) this.writeRow(table, row);
          }
          this.journal("workspace", "restore", { exported_at: data.snapshot.exported_at }, at);
        });
      });
    } finally {
      if (token) this.releaseHolder(token);
    }
  }

  async withExclusiveWorkspace<T>(job: () => Promise<T>): Promise<PlatformResult<T>> {
    if (this.closed) return closedFailure();
    let token: symbol | null;
    try {
      token = this.acquire("maintenance");
    } catch (error) {
      return storageFailure(error, "The workspace lock could not be taken.");
    }
    if (!token) {
      return fail("occupied", "The workspace is open in another window or process. Close it and try again.");
    }
    try {
      return ok(await this.maintenanceContext.run(token, job));
    } catch (error) {
      return failureFrom(error, "The maintenance job failed.");
    } finally {
      this.releaseHolder(token);
    }
  }

  /**
   * Hold the workspace for an editing session (the desktop equivalent of the
   * browser's WorkspaceAccess Web Lock). Maintenance and restore return
   * `occupied` until it is released or the process exits.
   */
  acquireEditingLease(): PlatformResult<EditingLease> {
    if (this.closed) return closedFailure();
    let token: symbol | null;
    try {
      token = this.acquire("editing");
    } catch (error) {
      return storageFailure(error, "The workspace lock could not be taken.");
    }
    if (!token) return fail("occupied", "The workspace is open in another window or process.");
    const held = token;
    return ok({ release: () => this.releaseHolder(held) });
  }

  async health(): Promise<PlatformResult<StorageHealth>> {
    if (this.closed) {
      return ok({ readable: false, writable: false, pendingMirror: null, detail: "The workspace store is closed." });
    }
    try {
      await this.serial(() => this.stmt("SELECT count(*) AS n FROM projects").get());
    } catch (error) {
      return ok({
        readable: false,
        writable: false,
        pendingMirror: null,
        detail: describeFailure(error, "The workspace database could not be read.").message,
      });
    }
    let folderWritable = true;
    try {
      accessSync(this.dataDir, fsConstants.W_OK);
    } catch {
      folderWritable = false;
    }
    return ok({
      readable: true,
      writable: folderWritable && this.lastWriteFailure === null,
      // No folder mirror or cloud replication exists for the desktop store.
      pendingMirror: null,
      detail: !folderWritable ? "The workspace folder is not writable." : this.lastWriteFailure,
    });
  }

  // ------------------------------------------------------------ extensions

  diagnostics(): SqliteDiagnostics {
    return {
      sqliteVersion: String(this.db.prepare("SELECT sqlite_version() AS v").get()?.v),
      journalMode: String(pragmaValue(this.db, "journal_mode")),
      synchronous: Number(pragmaValue(this.db, "synchronous")),
      foreignKeys: pragmaValue(this.db, "foreign_keys") === 1,
      userVersion: Number(pragmaValue(this.db, "user_version")),
      applicationId: Number(pragmaValue(this.db, "application_id")),
      busyTimeoutMs: this.busyTimeoutMs,
      outboxRows: Number(this.db.prepare("SELECT count(*) AS n FROM outbox").get()?.n ?? 0),
    };
  }

  /** Full database integrity, foreign-key and plan-object presence check. */
  async verifyIntegrity(): Promise<PlatformResult<IntegrityReport>> {
    return this.read("The workspace could not be checked.", async () => {
      const integrityCheck = this.db
        .prepare("PRAGMA integrity_check")
        .all()
        .map((row) => String(Object.values(row)[0]));
      const foreignKeyViolations = this.db.prepare("PRAGMA foreign_key_check").all().length;
      const hashes = this.db
        .prepare("SELECT DISTINCT sha256 FROM plan_files ORDER BY sha256")
        .all()
        .map((row) => String(row.sha256));
      const missingObjects: string[] = [];
      for (const hash of hashes) if (!(await this.files.hasObject(hash))) missingObjects.push(hash);
      return { integrityCheck, foreignKeyViolations, missingObjects };
    });
  }

  /**
   * Which published plan objects are referenced, and by what. Reports only;
   * nothing is deleted (garbage collection needs a grace period and backup
   * manifests, which are S3 work).
   */
  async planFileInventory(): Promise<PlatformResult<PlanFileInventory>> {
    return this.read("The plan file inventory could not be read.", async () => {
      const { mappings, documentPaths, snapshots } = this.readTransaction(() => ({
        mappings: this.db
          .prepare("SELECT storage_path, sha256, size, removed_at FROM plan_files ORDER BY rowid")
          .all(),
        documentPaths: this.db
          .prepare("SELECT storage_path FROM documents WHERE storage_path IS NOT NULL")
          .all()
          .map((row) => String(row.storage_path)),
        snapshots: this.db
          .prepare("SELECT * FROM bid_snapshots ORDER BY _seq")
          .all()
          .map((row) => decodeRow("bid_snapshots", row)),
      }));
      const byHash = new Map<
        string,
        { size: number; live: string[]; retired: string[]; documents: number; snapshots: number }
      >();
      const hashOfPath = new Map<string, string>();
      for (const row of mappings) {
        const hash = String(row.sha256);
        hashOfPath.set(String(row.storage_path), hash);
        const entry = byHash.get(hash) ?? { size: Number(row.size), live: [], retired: [], documents: 0, snapshots: 0 };
        (row.removed_at === null ? entry.live : entry.retired).push(String(row.storage_path));
        byHash.set(hash, entry);
      }
      for (const storagePath of documentPaths) {
        const hash = hashOfPath.get(storagePath);
        if (hash) byHash.get(hash)!.documents += 1;
      }
      for (const snapshot of snapshots) {
        const documents = (snapshot.payload as { documents?: unknown } | null)?.documents;
        if (!Array.isArray(documents)) continue;
        for (const document of documents) {
          const storagePath = (document as { storage_path?: unknown } | null)?.storage_path;
          const hash = typeof storagePath === "string" ? hashOfPath.get(storagePath) : undefined;
          if (hash) byHash.get(hash)!.snapshots += 1;
        }
      }
      const onDisk = new Set(await this.files.listObjects());
      return {
        objects: [...byHash.entries()].map(([sha256, entry]) => ({
          sha256,
          size: entry.size,
          livePaths: entry.live,
          retiredPaths: entry.retired,
          documentReferences: entry.documents,
          snapshotReferences: entry.snapshots,
        })),
        unreferencedObjects: [...onDisk].filter((hash) => !byHash.has(hash)),
        missingObjects: [...byHash.keys()].filter((hash) => !onDisk.has(hash)),
        stagingFiles: await this.files.listStaging(),
      };
    });
  }

  /**
   * Consistent online copy of the record database (SQLite backup API, so
   * committed WAL content is included), verified and then published by
   * rename. Plan PDFs are NOT included; `exportBundle` is the complete
   * records-plus-PDF snapshot.
   */
  async backupDatabaseTo(targetFile: string): Promise<PlatformResult<DatabaseBackupResult>> {
    if (typeof targetFile !== "string" || !path.isAbsolute(targetFile)) {
      return fail("invalid-input", "The backup destination must be an absolute path.");
    }
    return this.read("The workspace database could not be backed up.", async () => {
      const temporary = `${targetFile}.partial-${randomUUID()}`;
      try {
        const pages = await sqliteBackup(this.db, temporary);
        const copy = new DatabaseSync(temporary);
        let userVersion: number;
        try {
          // Make the copy a self-contained single file, then check it.
          copy.exec("PRAGMA journal_mode = DELETE");
          const integrity = copy.prepare("PRAGMA integrity_check").all().map((row) => String(Object.values(row)[0]));
          const orphans = copy.prepare("PRAGMA foreign_key_check").all().length;
          userVersion = Number(pragmaValue(copy, "user_version"));
          const applicationId = Number(pragmaValue(copy, "application_id"));
          if (integrity.join() !== "ok" || orphans !== 0 || applicationId !== APPLICATION_ID || userVersion !== this.schemaVersion) {
            throw new StoreError("integrity", "The database backup failed verification. No backup was published.");
          }
        } finally {
          copy.close();
        }
        const handle = await fs.open(temporary, "r+");
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
        await fs.rename(temporary, targetFile);
        const { size } = await fs.stat(targetFile);
        return { pages, bytes: size, userVersion, integrity: "ok" as const };
      } catch (error) {
        await fs.rm(temporary, { force: true }).catch(() => undefined);
        throw error;
      }
    });
  }

  /** Wait for queued work, release any lock, and close the database. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.queue.catch(() => undefined);
    this.holder = null;
    this.lockFile.close();
    this.statements.clear();
    this.db.close();
  }
}

export function openSqliteWorkspaceStore(
  options: SqliteStoreOptions
): Promise<PlatformResult<SqliteWorkspaceStore>> {
  return SqliteWorkspaceStore.open(options);
}
