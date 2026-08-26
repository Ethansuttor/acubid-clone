"use client";

// Local-first data layer implementing the narrow supabase-js subset used by
// Voltline. Data and plan files live in IndexedDB, each mutation is committed
// atomically with an append-only outbox entry, and an optional user-selected
// folder receives a second copy.

import { LOCAL_PASSWORD, LOCAL_USERNAME } from "./local-config";
import {
  queueRecoveryMirror,
  queueRecoveryFileMirror,
  recoveryFilenameForPath,
  type RecoveryFile,
  type RecoveryMutation,
  type RecoverySnapshot,
} from "./recovery-folder";

const LOCAL_USER = {
  id: "00000000-0000-4000-8000-00000000cafe",
  email: LOCAL_USERNAME,
};

const DB_NAME = "voltline-local-v1";
const DB_VERSION = 1;
const STATE_KEY = "tables";
const TABLE_PREFIX = "voltline.local.";
const FILE_PREFIX = "voltline.local.file.";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
type Filter =
  | { kind: "eq"; col: string; value: unknown }
  | { kind: "in"; col: string; values: unknown[] };

interface Mutation extends RecoveryMutation {
  synced_at: string | null;
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("Browser storage request failed."));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Browser storage transaction failed."));
    tx.onabort = () => reject(tx.error ?? new Error("Browser storage transaction was aborted."));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(DB_NAME, DB_VERSION);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      if (!db.objectStoreNames.contains("state")) db.createObjectStore("state");
      if (!db.objectStoreNames.contains("files")) db.createObjectStore("files");
      if (!db.objectStoreNames.contains("journal")) {
        db.createObjectStore("journal", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? new Error("Could not open browser storage."));
  });
}

function usesIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function loadLegacyTable(table: string): Row[] {
  const raw = localStorage.getItem(`${TABLE_PREFIX}${table}`);
  if (raw === null) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`Local ${table} data is corrupted.`);
  return parsed as Row[];
}

function saveLegacyTable(table: string, rows: Row[]): void {
  localStorage.setItem(`${TABLE_PREFIX}${table}`, JSON.stringify(rows));
}

function legacyTables(): Tables {
  const tables: Tables = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(TABLE_PREFIX) || key.startsWith(FILE_PREFIX)) continue;
    const table = key.slice(TABLE_PREFIX.length);
    if (table === "signedin") continue;
    tables[table] = loadLegacyTable(table);
  }
  return tables;
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function ensureMigrated(): Promise<void> {
  if (!usesIndexedDb()) return;
  const db = await openDatabase();
  const currentTx = db.transaction("state", "readonly");
  const current = await request(currentTx.objectStore("state").get(STATE_KEY));
  await transactionDone(currentTx);
  if (current !== undefined) return;

  const tables = legacyTables();
  const tx = db.transaction(["state", "files"], "readwrite");
  tx.objectStore("state").put(tables, STATE_KEY);
  const files = tx.objectStore("files");
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(FILE_PREFIX)) continue;
    const value = localStorage.getItem(key);
    if (value !== null) {
      files.put(
        new Blob([bytesFromBase64(value)], { type: "application/pdf" }),
        key.slice(FILE_PREFIX.length)
      );
    }
  }
  await transactionDone(tx);
}

async function readTables(): Promise<Tables> {
  if (!usesIndexedDb()) return legacyTables();
  await ensureMigrated();
  const db = await openDatabase();
  const tx = db.transaction("state", "readonly");
  const tables =
    ((await request(tx.objectStore("state").get(STATE_KEY))) as Tables | undefined) ?? {};
  await transactionDone(tx);
  return tables;
}

function snapshotFor(tables: Tables): RecoverySnapshot {
  return {
    format: "voltline-recovery",
    schema_version: 1,
    exported_at: new Date().toISOString(),
    tables,
  };
}

function makeMutation(table: string, operation: string, payload: unknown): Mutation {
  return {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    table,
    operation,
    payload,
    synced_at: null,
  };
}

async function commitTables(
  tables: Tables,
  mutation: Mutation,
  fileDeletes: string[] = []
): Promise<void> {
  if (!usesIndexedDb()) {
    for (const [table, rows] of Object.entries(tables)) saveLegacyTable(table, rows);
    for (const path of fileDeletes) localStorage.removeItem(`${FILE_PREFIX}${path}`);
    return;
  }
  const db = await openDatabase();
  const tx = db.transaction(["state", "journal", "files"], "readwrite");
  tx.objectStore("state").put(tables, STATE_KEY);
  tx.objectStore("journal").put(mutation);
  for (const path of fileDeletes) tx.objectStore("files").delete(path);
  await transactionDone(tx);
  queueRecoveryMirror(snapshotFor(tables), mutation);
}

const CASCADES: Record<string, { child: string; fk: string }[]> = {
  projects: [
    { child: "documents", fk: "project_id" },
    { child: "sheets", fk: "project_id" },
    { child: "layers", fk: "project_id" },
    { child: "takeoffs", fk: "project_id" },
    { child: "direct_costs", fk: "project_id" },
    { child: "proposal_entries", fk: "project_id" },
    { child: "bid_snapshots", fk: "project_id" },
  ],
  documents: [{ child: "sheets", fk: "document_id" }],
  sheets: [{ child: "takeoffs", fk: "sheet_id" }],
  layers: [{ child: "takeoffs", fk: "layer_id" }],
  items: [{ child: "assembly_items", fk: "item_id" }],
  assemblies: [{ child: "assembly_items", fk: "assembly_id" }],
};

function cascadeDelete(tables: Tables, table: string, doomed: Row[], fileDeletes: string[]): void {
  const ids = new Set(doomed.map((row) => row.id));
  if (ids.size === 0) return;
  if (table === "documents") {
    for (const row of doomed) {
      if (typeof row.storage_path === "string") fileDeletes.push(row.storage_path);
    }
  }
  for (const { child, fk } of CASCADES[table] ?? []) {
    const rows = tables[child] ?? [];
    const dead = rows.filter((row) => ids.has(row[fk]));
    if (dead.length === 0) continue;
    tables[child] = rows.filter((row) => !ids.has(row[fk]));
    cascadeDelete(tables, child, dead, fileDeletes);
  }
}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((filter) =>
    filter.kind === "eq"
      ? row[filter.col] === filter.value
      : new Set(filter.values).has(row[filter.col])
  );
}

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private rows: Row[] = [];
  private patch: Row = {};
  private filters: Filter[] = [];
  private orderBy: { col: string; asc: boolean } | null = null;
  private wantSingle = false;

  constructor(private table: string) {}

  select(_cols?: string) {
    void _cols;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.rows = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(rows: Row | Row[]) {
    this.op = "upsert";
    this.rows = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.patch = patch;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push({ kind: "eq", col, value });
    return this;
  }
  in(col: string, values: unknown[]) {
    this.filters.push({ kind: "in", col, values });
    return this;
  }
  order(col: string, options?: { ascending?: boolean }) {
    this.orderBy = { col, asc: options?.ascending !== false };
    return this;
  }
  single() {
    this.wantSingle = true;
    return this;
  }

  private async run(): Promise<{ data: unknown; error: unknown }> {
    const tables = await readTables();
    let all = [...(tables[this.table] ?? [])];
    if (this.op === "insert" || this.op === "upsert") {
      const inserted: Row[] = [];
      for (const raw of this.rows) {
        const row = {
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...raw,
        };
        const index = all.findIndex((candidate) => candidate.id === row.id);
        if (index >= 0 && this.op === "upsert") all[index] = { ...all[index], ...row };
        else if (index >= 0) return { data: null, error: { message: "duplicate id" } };
        else all.push(row);
        inserted.push(row);
      }
      tables[this.table] = all;
      await commitTables(tables, makeMutation(this.table, this.op, inserted));
      return { data: this.wantSingle ? inserted[0] : inserted, error: null };
    }
    if (this.op === "update") {
      all = all.map((row) => (matches(row, this.filters) ? { ...row, ...this.patch } : row));
      tables[this.table] = all;
      await commitTables(
        tables,
        makeMutation(this.table, "update", { filters: this.filters, patch: this.patch })
      );
      return { data: null, error: null };
    }
    if (this.op === "delete") {
      const doomed = all.filter((row) => matches(row, this.filters));
      tables[this.table] = all.filter((row) => !matches(row, this.filters));
      const fileDeletes: string[] = [];
      cascadeDelete(tables, this.table, doomed, fileDeletes);
      await commitTables(
        tables,
        makeMutation(this.table, "delete", { filters: this.filters, deleted: doomed }),
        fileDeletes
      );
      return { data: null, error: null };
    }

    let output = all.filter((row) => matches(row, this.filters));
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      output = [...output].sort((a, b) => {
        const av = a[col] as string | number;
        const bv = b[col] as string | number;
        return (av < bv ? -1 : av > bv ? 1 : 0) * (asc ? 1 : -1);
      });
    }
    if (this.wantSingle) {
      return output.length === 1
        ? { data: output[0], error: null }
        : { data: null, error: { message: `expected 1 row, got ${output.length}` } };
    }
    return { data: output, error: null };
  }

  then<T1 = { data: unknown; error: unknown }, T2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
  ): Promise<T1 | T2> {
    return this.run()
      .catch((error: unknown) => ({
        data: null,
        error: {
          message:
            error instanceof Error ? error.message : "Local storage could not save this change.",
        },
      }))
      .then(onfulfilled, onrejected);
  }
}

function base64(bytes: Uint8Array): string {
  let value = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    value += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(value);
}

async function writeFile(path: string, blob: Blob): Promise<void> {
  if (!usesIndexedDb()) {
    localStorage.setItem(`${FILE_PREFIX}${path}`, base64(new Uint8Array(await blob.arrayBuffer())));
    queueRecoveryFileMirror(path, blob);
    return;
  }
  await ensureMigrated();
  const db = await openDatabase();
  const mutation = makeMutation("storage.objects", "upload", {
    path,
    size: blob.size,
    type: blob.type,
  });
  const tx = db.transaction(["files", "journal"], "readwrite");
  tx.objectStore("files").put(blob, path);
  tx.objectStore("journal").put(mutation);
  await transactionDone(tx);
  queueRecoveryFileMirror(path, blob);
}

async function readFile(path: string): Promise<Blob | null> {
  if (!usesIndexedDb()) {
    const value = localStorage.getItem(`${FILE_PREFIX}${path}`);
    return value ? new Blob([bytesFromBase64(value)], { type: "application/pdf" }) : null;
  }
  await ensureMigrated();
  const db = await openDatabase();
  const tx = db.transaction("files", "readonly");
  const blob = (await request(tx.objectStore("files").get(path))) as Blob | undefined;
  await transactionDone(tx);
  return blob ?? null;
}

async function removeFiles(paths: string[]): Promise<void> {
  if (!usesIndexedDb()) {
    for (const path of paths) localStorage.removeItem(`${FILE_PREFIX}${path}`);
    return;
  }
  await ensureMigrated();
  const db = await openDatabase();
  const mutation = makeMutation("storage.objects", "delete", { paths });
  const tx = db.transaction(["files", "journal"], "readwrite");
  for (const path of paths) tx.objectStore("files").delete(path);
  tx.objectStore("journal").put(mutation);
  await transactionDone(tx);
}

export async function exportLocalRecoverySnapshot(): Promise<RecoverySnapshot> {
  const { snapshot } = await exportLocalRecoveryBundle();
  return snapshot;
}

export async function exportLocalRecoveryBundle(): Promise<{
  snapshot: RecoverySnapshot;
  files: RecoveryFile[];
}> {
  const tables = await readTables();
  const files: RecoveryFile[] = [];
  if (!usesIndexedDb()) {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(FILE_PREFIX)) continue;
      const value = localStorage.getItem(key);
      if (value !== null) {
        files.push({
          path: key.slice(FILE_PREFIX.length),
          blob: new Blob([bytesFromBase64(value)], { type: "application/pdf" }),
        });
      }
    }
  } else {
    await ensureMigrated();
    const db = await openDatabase();
    const tx = db.transaction("files", "readonly");
    const store = tx.objectStore("files");
    const [keys, blobs] = await Promise.all([request(store.getAllKeys()), request(store.getAll())]);
    await transactionDone(tx);
    keys.forEach((key, index) => {
      const blob = blobs[index];
      if (typeof key === "string" && blob instanceof Blob) files.push({ path: key, blob });
    });
  }
  const snapshot = snapshotFor(tables);
  snapshot.files = files.map(({ path }) => ({
    path,
    recovery_filename: recoveryFilenameForPath(path),
  }));
  return { snapshot, files };
}

export function createLocalClient() {
  return {
    auth: {
      async getUser() {
        const signedIn = localStorage.getItem("voltline.local.signedin") === "1";
        return { data: { user: signedIn ? LOCAL_USER : null }, error: null };
      },
      async signInWithPassword(credentials: { email: string; password: string }) {
        if (credentials.email !== LOCAL_USERNAME || credentials.password !== LOCAL_PASSWORD) {
          return {
            data: { user: null },
            error: { message: "Use username 1. No password is required." },
          };
        }
        localStorage.setItem("voltline.local.signedin", "1");
        return { data: { user: LOCAL_USER }, error: null };
      },
      async signOut() {
        localStorage.removeItem("voltline.local.signedin");
        return { error: null };
      },
      async getSession() {
        const signedIn = localStorage.getItem("voltline.local.signedin") === "1";
        return { data: { session: signedIn ? { access_token: "local" } : null }, error: null };
      },
    },
    from(table: string) {
      return new Query(table);
    },
    storage: {
      from(_bucket: string) {
        void _bucket;
        return {
          async upload(path: string, bytes: ArrayBuffer | Uint8Array | Blob) {
            try {
              const blob =
                bytes instanceof Blob
                  ? bytes
                  : new Blob([bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)], {
                      type: "application/pdf",
                    });
              await writeFile(path, blob);
              return { data: { path }, error: null };
            } catch (error) {
              return {
                data: null,
                error: { message: error instanceof Error ? error.message : String(error) },
              };
            }
          },
          async download(path: string) {
            try {
              const blob = await readFile(path);
              return blob
                ? { data: blob, error: null }
                : { data: null, error: { message: "file not found" } };
            } catch (error) {
              return {
                data: null,
                error: { message: error instanceof Error ? error.message : String(error) },
              };
            }
          },
          async remove(paths: string[]) {
            try {
              await removeFiles(paths);
              return { data: paths.map((path) => ({ name: path })), error: null };
            } catch (error) {
              return {
                data: null,
                error: { message: error instanceof Error ? error.message : String(error) },
              };
            }
          },
        };
      },
    },
  };
}
