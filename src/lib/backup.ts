import type { RecoveryFile, RecoverySnapshot } from "./recovery-folder";

export const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
const TABLES = ["projects", "documents", "sheets", "layers", "takeoffs", "items", "assemblies", "assembly_items", "direct_costs", "proposal_entries", "bid_snapshots"] as const;
type Row = Record<string, unknown>;
export interface BackupData {
  snapshot: RecoverySnapshot;
  files: RecoveryFile[];
}

function record(value: unknown): value is Row {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Validate the graph before any write. Never guess missing tables or plan bytes. */
export function validateBackupSnapshot(value: unknown, paths: string[]): asserts value is RecoverySnapshot {
  if (!record(value) || value.format !== "voltline-recovery" || value.schema_version !== 1 ||
      typeof value.exported_at !== "string" || !Number.isFinite(Date.parse(value.exported_at)) || !record(value.tables)) {
    throw new Error("This is not a supported Voltline backup.");
  }
  const tables = value.tables;
  for (const name of Object.keys(tables)) {
    if (!(TABLES as readonly string[]).includes(name)) throw new Error(`Unknown backup table: ${name}. Update Voltline before restoring.`);
  }
  const ids = new Map<string, Set<unknown>>();
  for (const name of TABLES) {
    const rows = tables[name];
    if (!Array.isArray(rows)) throw new Error(`Backup is missing the ${name} table.`);
    const seen = new Set<unknown>();
    for (const row of rows) {
      if (!record(row) || typeof row.id !== "string" || !row.id || seen.has(row.id)) {
        throw new Error(`Backup has an invalid or duplicate record in ${name}.`);
      }
      seen.add(row.id);
    }
    ids.set(name, seen);
  }
  const has = (table: string, id: unknown) => ids.get(table)!.has(id);
  for (const name of ["documents", "sheets", "layers", "takeoffs", "direct_costs", "proposal_entries", "bid_snapshots"]) {
    for (const row of tables[name] as Row[]) {
      if (!has("projects", row.project_id)) throw new Error(`Backup has an orphaned ${name} record.`);
    }
  }
  for (const row of tables.projects as Row[]) {
    if (typeof row.name !== "string" || !row.name.trim()) throw new Error("A backup project has no name.");
  }
  const indexes = new Map(TABLES.map(table => [table as string, new Map((tables[table] as Row[]).map(row => [row.id, row]))]));
  const byId = (table: string, id: unknown) => indexes.get(table)?.get(id);
  for (const row of tables.sheets as Row[]) {
    if (byId("documents", row.document_id)?.project_id !== row.project_id) throw new Error("A backup sheet has no matching document.");
  }
  for (const row of tables.takeoffs as Row[]) {
    if (byId("sheets", row.sheet_id)?.project_id !== row.project_id || byId("layers", row.layer_id)?.project_id !== row.project_id) {
      throw new Error("A backup takeoff has no matching sheet or layer.");
    }
  }
  if (new Set(paths).size !== paths.length) throw new Error("Backup has duplicate plan files.");
  for (const row of tables.documents as Row[]) {
    if (typeof row.storage_path !== "string" || !paths.includes(row.storage_path)) throw new Error("Backup is missing a plan PDF. No data has been restored.");
  }
}

function encode(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += 32768) result += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(result);
}

async function digest(payload: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function encodeBackup(data: BackupData): Promise<Blob> {
  const snapshot = { ...data.snapshot, tables: { ...data.snapshot.tables, ...Object.fromEntries(TABLES.map(name => [name, data.snapshot.tables[name] ?? []])) } };
  validateBackupSnapshot(snapshot, data.files.map(file => file.path));
  if (data.files.reduce((sum, file) => sum + file.blob.size, 0) > MAX_BACKUP_BYTES / 2) {
    throw new Error("This workspace is too large for a portable backup. Use the recovery folder instead.");
  }
  const files = [];
  for (const file of data.files) files.push({ path: file.path, data: encode(new Uint8Array(await file.blob.arrayBuffer())) });
  const payload = JSON.stringify({ snapshot, files });
  const blob = new Blob([JSON.stringify({ format: "voltline-backup", version: 1, sha256: await digest(payload), payload })], { type: "application/json" });
  if (blob.size > MAX_BACKUP_BYTES) throw new Error("This backup exceeds 256 MB. Use the recovery folder instead.");
  return blob;
}

export async function decodeBackup(file: Blob): Promise<BackupData> {
  if (file.size > MAX_BACKUP_BYTES) throw new Error("Portable backups must be smaller than 256 MB.");
  let envelope;
  try { envelope = JSON.parse(await file.text()); } catch { throw new Error("The selected file is not valid backup JSON."); }
  if (!record(envelope) || envelope.format !== "voltline-backup" || envelope.version !== 1 || typeof envelope.payload !== "string") {
    throw new Error("Choose a .voltline.json file created with Download backup.");
  }
  if (envelope.sha256 !== await digest(envelope.payload)) throw new Error("Backup integrity check failed. The file is damaged or has been changed.");
  const payload: unknown = JSON.parse(envelope.payload);
  if (!record(payload) || !Array.isArray(payload.files)) throw new Error("Backup has no plan file list.");
  const files: RecoveryFile[] = payload.files.map((file: unknown) => {
    if (!record(file) || typeof file.path !== "string" || !file.path || typeof file.data !== "string" ||
        file.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)) throw new Error("Backup contains invalid plan data.");
    const binary = atob(file.data);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return { path: file.path, blob: new Blob([bytes], { type: "application/pdf" }) };
  });
  validateBackupSnapshot(payload.snapshot, files.map(file => file.path));
  return { snapshot: payload.snapshot, files };
}
