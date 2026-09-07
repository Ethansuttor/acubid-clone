"use client";

// Optional second local copy for disaster recovery. The browser's IndexedDB is
// the primary on-device store; a user-selected folder receives an append-only
// mutation journal plus a current JSON snapshot. Browser permission can lapse,
// so folder mirroring is deliberately reported separately from normal saves.

export interface RecoveryMutation {
  id: string;
  created_at: string;
  table: string;
  operation: string;
  payload: unknown;
}

export interface RecoverySnapshot {
  format: "voltline-recovery";
  schema_version: 1;
  exported_at: string;
  tables: Record<string, Record<string, unknown>[]>;
  files?: { path: string; recovery_filename: string }[];
}

export interface RecoveryFile {
  path: string;
  blob: Blob;
}

type PermissionStateValue = "granted" | "denied" | "prompt";

interface DirectoryHandleWithPermission extends FileSystemDirectoryHandle {
  queryPermission?: (options?: { mode?: "read" | "readwrite" }) => Promise<PermissionStateValue>;
  requestPermission?: (options?: { mode?: "read" | "readwrite" }) => Promise<PermissionStateValue>;
}

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: "read" | "readwrite";
      startIn?: string;
    }) => Promise<FileSystemDirectoryHandle>;
  }
}

const DB_NAME = "voltline-local-v1";
const DB_VERSION = 1;
const HANDLE_KEY = "recovery-directory";
let cachedHandle: FileSystemDirectoryHandle | null | undefined;
let mirrorQueue: Promise<void> = Promise.resolve();
let mirrorError: string | null = null;

function reportMirrorError(error: unknown): void {
  mirrorError = error instanceof Error ? error.message : "Recovery folder write failed.";
  if (typeof window !== "undefined") window.dispatchEvent(new Event("voltline-recovery-status"));
}

export function recoveryFolderError(): string | null { return mirrorError; }

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

async function saveHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").put(handle, HANDLE_KEY);
  await transactionDone(tx);
}

async function loadHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (cachedHandle !== undefined) return cachedHandle;
  if (typeof indexedDB === "undefined") return (cachedHandle = null);
  const db = await openDatabase();
  const tx = db.transaction("meta", "readonly");
  const handle = await request(tx.objectStore("meta").get(HANDLE_KEY));
  await transactionDone(tx);
  cachedHandle = (handle as FileSystemDirectoryHandle | undefined) ?? null;
  return cachedHandle;
}

async function permission(
  handle: FileSystemDirectoryHandle,
  requestIfNeeded: boolean
): Promise<PermissionStateValue> {
  const capable = handle as DirectoryHandleWithPermission;
  const current = (await capable.queryPermission?.({ mode: "readwrite" })) ?? "granted";
  if (current === "granted" || !requestIfNeeded) return current;
  return (await capable.requestPermission?.({ mode: "readwrite" })) ?? current;
}

async function writeJson(
  directory: FileSystemDirectoryHandle,
  filename: string,
  value: unknown
): Promise<void> {
  const file = await directory.getFileHandle(filename, { create: true });
  const writable = await file.createWritable();
  await writable.write(JSON.stringify(value, null, 2));
  await writable.close();
}

function mutationFilename(mutation: RecoveryMutation): string {
  const timestamp = mutation.created_at.replace(/[:.]/g, "-");
  return `${timestamp}-${mutation.id}.json`;
}

async function writeRecoveryFiles(
  handle: FileSystemDirectoryHandle,
  snapshot: RecoverySnapshot,
  mutation?: RecoveryMutation
): Promise<void> {
  const root = await handle.getDirectoryHandle("Voltline Recovery", { create: true });
  await writeJson(root, "latest.json", snapshot);
  if (mutation) {
    const journal = await root.getDirectoryHandle("journal", { create: true });
    await writeJson(journal, mutationFilename(mutation), mutation);
  } else {
    const snapshots = await root.getDirectoryHandle("snapshots", { create: true });
    await writeJson(
      snapshots,
      `baseline-${snapshot.exported_at.replace(/[:.]/g, "-")}.json`,
      snapshot
    );
  }
}

function planFilename(path: string): string {
  let hash = 2166136261;
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const base = path.split("/").at(-1)?.replace(/[^a-zA-Z0-9._-]+/g, "_") || "plan.pdf";
  return `${(hash >>> 0).toString(16).padStart(8, "0")}-${base}`;
}

async function writeRecoveryPlan(
  handle: FileSystemDirectoryHandle,
  file: RecoveryFile
): Promise<void> {
  const root = await handle.getDirectoryHandle("Voltline Recovery", { create: true });
  const plans = await root.getDirectoryHandle("plans", { create: true });
  const target = await plans.getFileHandle(planFilename(file.path), { create: true });
  const writable = await target.createWritable();
  await writable.write(file.blob);
  await writable.close();
}

export function recoveryFolderSupported(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export async function configureRecoveryFolder(
  snapshot: RecoverySnapshot,
  files: RecoveryFile[] = []
): Promise<void> {
  if (!window.showDirectoryPicker) {
    throw new Error("Folder backups require a Chromium-based browser such as Edge or Chrome.");
  }
  const handle = await window.showDirectoryPicker({
    id: "voltline-recovery",
    mode: "readwrite",
    startIn: "documents",
  });
  if ((await permission(handle, true)) !== "granted") {
    throw new Error("Write access to the recovery folder was not granted.");
  }
  await saveHandle(handle);
  cachedHandle = handle;
  await writeRecoveryFiles(handle, snapshot);
  for (const file of files) await writeRecoveryPlan(handle, file);
  mirrorError = null;
  window.dispatchEvent(new Event("voltline-recovery-status"));
}

export async function recoveryFolderStatus(): Promise<"unsupported" | "missing" | "ready" | "permission-needed" | "error"> {
  if (!recoveryFolderSupported()) return "unsupported";
  if (mirrorError) return "error";
  const handle = await loadHandle();
  if (!handle) return "missing";
  return (await permission(handle, false)) === "granted" ? "ready" : "permission-needed";
}

/** Queue a mirror only after the primary IndexedDB transaction commits. */
export function queueRecoveryMirror(snapshot: RecoverySnapshot, mutation: RecoveryMutation): void {
  mirrorQueue = mirrorQueue
    .then(async () => {
      const handle = await loadHandle();
      if (!handle || (await permission(handle, false)) !== "granted") return;
      await writeRecoveryFiles(handle, snapshot, mutation);
    })
    .catch((error) => {
      reportMirrorError(error);
      console.error("Recovery folder mirror failed", error);
    });
}

export function queueRecoveryFileMirror(path: string, blob: Blob): void {
  mirrorQueue = mirrorQueue
    .then(async () => {
      const handle = await loadHandle();
      if (!handle || (await permission(handle, false)) !== "granted") return;
      await writeRecoveryPlan(handle, { path, blob });
    })
    .catch((error) => {
      reportMirrorError(error);
      console.error("Recovery folder plan mirror failed", error);
    });
}

export function recoveryFilenameForPath(path: string): string {
  return planFilename(path);
}

export async function requestPersistentBrowserStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

export async function browserStorageIsPersistent(): Promise<boolean> {
  if (!navigator.storage?.persisted) return false;
  return navigator.storage.persisted();
}
