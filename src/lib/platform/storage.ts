/**
 * C1 storage seam. One port covering the query subset Voltline actually uses
 * plus the compound operations that must not be expressible as a sequence of
 * smaller calls: replacing an assembly's components, exporting a consistent
 * workspace snapshot with its PDFs, restoring a validated backup, and holding
 * the workspace exclusively while maintenance runs.
 *
 * Environment-neutral: no IndexedDB, Electron, or `next/*` import belongs
 * here. Concrete adapters live in `./browser-storage` (IndexedDB, today's
 * behavior), `./fake-storage` (in-memory, used by the contract suite), and
 * later a desktop adapter owned by track S.
 */

import type { AssemblyItem } from "../types";
import type { BackupData } from "../backup";
import type { RecoveryFile, RecoverySnapshot } from "../recovery-folder";
import type { PlatformCapabilities, PlatformResult } from "./contracts";

export type StorageRow = Record<string, unknown>;

export type StorageFilter =
  | { readonly kind: "eq"; readonly column: string; readonly value: unknown }
  | { readonly kind: "in"; readonly column: string; readonly values: readonly unknown[] };

export interface StorageOrder {
  readonly column: string;
  readonly ascending: boolean;
}

export interface StorageSelect {
  readonly table: string;
  readonly filters?: readonly StorageFilter[];
  readonly order?: StorageOrder;
}

/** Everything needed to rebuild a workspace elsewhere: rows plus plan bytes. */
export interface WorkspaceBundle {
  readonly snapshot: RecoverySnapshot;
  readonly files: readonly RecoveryFile[];
}

export interface StorageHealth {
  /** False when the store could not be opened or read at all. */
  readonly readable: boolean;
  /** False when a write was rejected; issued outputs stay blocked. */
  readonly writable: boolean;
  /** Rows in the mutation journal that have not been mirrored, when known. */
  readonly pendingMirror: number | null;
  /** Human-readable reason when `readable` or `writable` is false. */
  readonly detail: string | null;
}

/**
 * Error semantics every adapter must honor:
 *
 * - A rejected write leaves the store exactly as it was. Partial entities are
 *   never observable — `replaceAssemblyItems` in particular either installs
 *   the whole component list or keeps the previously priced one.
 * - `restore` refuses a non-empty destination with `occupied` rather than
 *   replacing the estimator's work, and validates every record and plan file
 *   before the first write (`integrity` / `invalid-input`).
 * - `withExclusiveWorkspace` returns `occupied` when another editor holds the
 *   workspace; it never proceeds "best effort".
 * - Cancellation surfaces as `aborted`, never as `io-failed`, so a cancelled
 *   job is not mistaken for a failed save.
 */
export interface WorkspaceStoragePort {
  readonly capabilities: PlatformCapabilities;

  select(query: StorageSelect): Promise<PlatformResult<StorageRow[]>>;
  insert(table: string, rows: readonly StorageRow[]): Promise<PlatformResult<StorageRow[]>>;
  update(
    table: string,
    patch: StorageRow,
    filters: readonly StorageFilter[]
  ): Promise<PlatformResult<void>>;
  remove(table: string, filters: readonly StorageFilter[]): Promise<PlatformResult<void>>;

  /** Atomic whole-list replacement for one assembly's components. */
  replaceAssemblyItems(
    assemblyId: string,
    rows: readonly AssemblyItem[]
  ): Promise<PlatformResult<void>>;

  uploadFile(path: string, blob: Blob): Promise<PlatformResult<{ path: string }>>;
  downloadFile(path: string): Promise<PlatformResult<Blob>>;
  removeFiles(paths: readonly string[]): Promise<PlatformResult<void>>;

  /** A consistent snapshot of every table with all referenced plan files. */
  exportBundle(): Promise<PlatformResult<WorkspaceBundle>>;
  /** Restore a validated backup into an empty workspace. */
  restore(data: BackupData): Promise<PlatformResult<void>>;

  /** Run `job` with no other editor holding the workspace. */
  withExclusiveWorkspace<T>(job: () => Promise<T>): Promise<PlatformResult<T>>;

  health(): Promise<PlatformResult<StorageHealth>>;
}

/**
 * Adapter selection. The browser adapter is registered by the client bootstrap
 * rather than imported here, so a Node test or the Electron main process can
 * load this module without pulling in IndexedDB code.
 */
let active: WorkspaceStoragePort | null = null;

export function setWorkspaceStorage(port: WorkspaceStoragePort | null): void {
  active = port;
}

export function workspaceStorage(): WorkspaceStoragePort {
  if (!active) {
    throw new Error(
      "No workspace storage adapter is registered. The application bootstrap must call setWorkspaceStorage() before any save or load."
    );
  }
  return active;
}

export function workspaceStorageIfPresent(): WorkspaceStoragePort | null {
  return active;
}
