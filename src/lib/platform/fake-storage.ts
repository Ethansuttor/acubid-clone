/**
 * Runnable in-memory adapter for the C1 storage port.
 *
 * Its purpose is to make the contract executable: every rule stated in
 * `./storage` is implemented here, and the contract suite runs against it. A
 * real adapter (IndexedDB today, SQLite next) must pass the same suite.
 *
 * It is a fake, not a stub — it enforces the rules rather than returning
 * canned answers — but it is not durable and must never back a real workspace.
 * `faults` lets a test force a specific failure without corrupting anything.
 */

import { validateBackupSnapshot, type BackupData } from "../backup";
import type { RecoveryFile } from "../recovery-folder";
import type { AssemblyItem } from "../types";
import {
  fail,
  ok,
  PLATFORM_CONTRACT_VERSION,
  type PlatformCapabilities,
  type PlatformResult,
} from "./contracts";
import type {
  StorageFilter,
  StorageHealth,
  StorageRow,
  StorageSelect,
  WorkspaceBundle,
  WorkspaceStoragePort,
} from "./storage";

export interface FakeStorageFaults {
  /** Every write fails with io-failed and changes nothing. */
  readOnly?: boolean;
  /** Reads fail; used to prove a failed load is visible rather than empty. */
  unreadable?: boolean;
  /** Another editor holds the workspace. */
  occupied?: boolean;
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

function matches(row: StorageRow, filters: readonly StorageFilter[]): boolean {
  return filters.every((filter) =>
    filter.kind === "eq"
      ? row[filter.column] === filter.value
      : filter.values.includes(row[filter.column])
  );
}

export interface FakeStorage extends WorkspaceStoragePort {
  readonly faults: FakeStorageFaults;
  /** Direct table access for arranging a test fixture. */
  seed(tables: Record<string, StorageRow[]>): void;
  tables(): Record<string, StorageRow[]>;
  fileCount(): number;
}

export function createFakeStorage(faults: FakeStorageFaults = {}): FakeStorage {
  let tables: Record<string, StorageRow[]> = {};
  const files = new Map<string, Blob>();
  let held = false;

  const capabilities: PlatformCapabilities = {
    kind: "browser",
    contractVersion: PLATFORM_CONTRACT_VERSION,
    recordStore: "memory",
    fileStore: "memory",
    exclusiveWorkspaceLock: true,
    folderMirror: false,
    portableBackup: true,
    aiTransport: "unavailable",
    managedCredentials: false,
  };

  const rowsOf = (table: string): StorageRow[] => tables[table] ?? [];

  const copyOfTables = (): Record<string, StorageRow[]> =>
    Object.fromEntries(
      Object.entries(tables).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))])
    );

  function guardWrite(): PlatformResult<never> | null {
    if (faults.readOnly) return fail("io-failed", "This change could not be saved.");
    return null;
  }

  function cascade(table: string, doomed: StorageRow[], removedPaths: string[]): void {
    const ids = new Set(doomed.map((row) => row.id));
    if (ids.size === 0) return;
    if (table === "documents") {
      for (const row of doomed) {
        if (typeof row.storage_path === "string") removedPaths.push(row.storage_path);
      }
    }
    for (const { child, fk } of CASCADES[table] ?? []) {
      const rows = rowsOf(child);
      const dead = rows.filter((row) => ids.has(row[fk]));
      if (dead.length === 0) continue;
      tables[child] = rows.filter((row) => !ids.has(row[fk]));
      cascade(child, dead, removedPaths);
    }
  }

  return {
    capabilities,
    faults,

    seed(seeded) {
      tables = Object.fromEntries(
        Object.entries(seeded).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))])
      );
    },
    tables: copyOfTables,
    fileCount() {
      return files.size;
    },

    async select(query: StorageSelect) {
      if (faults.unreadable) return fail("io-failed", "This estimate could not be read.");
      let output = rowsOf(query.table).filter((row) => matches(row, query.filters ?? []));
      if (query.order) {
        const { column, ascending } = query.order;
        output = [...output].sort((a, b) => {
          const left = a[column] as string | number;
          const right = b[column] as string | number;
          return (left < right ? -1 : left > right ? 1 : 0) * (ascending ? 1 : -1);
        });
      }
      return ok(output.map((row) => ({ ...row })));
    },

    async insert(table: string, rows: readonly StorageRow[]) {
      const blocked = guardWrite();
      if (blocked) return blocked;
      const existing = rowsOf(table);
      const ids = new Set(existing.map((row) => row.id));
      const now = new Date().toISOString();
      const prepared: StorageRow[] = [];
      for (const raw of rows) {
        const row = { id: crypto.randomUUID(), created_at: now, updated_at: now, ...raw };
        // Nothing is written until the whole batch validates: a rejected insert
        // cannot leave half a takeoff behind.
        if (ids.has(row.id)) return fail("conflict", "That record already exists.");
        ids.add(row.id);
        prepared.push(row);
      }
      tables[table] = [...existing, ...prepared];
      return ok(prepared.map((row) => ({ ...row })));
    },

    async update(table: string, patch: StorageRow, filters: readonly StorageFilter[]) {
      const blocked = guardWrite();
      if (blocked) return blocked;
      tables[table] = rowsOf(table).map((row) =>
        matches(row, filters) ? { ...row, ...patch, updated_at: new Date().toISOString() } : row
      );
      return ok(undefined as void);
    },

    async remove(table: string, filters: readonly StorageFilter[]) {
      const blocked = guardWrite();
      if (blocked) return blocked;
      const rows = rowsOf(table);
      const doomed = rows.filter((row) => matches(row, filters));
      tables[table] = rows.filter((row) => !matches(row, filters));
      const removedPaths: string[] = [];
      cascade(table, doomed, removedPaths);
      for (const path of removedPaths) files.delete(path);
      return ok(undefined as void);
    },

    async replaceAssemblyItems(assemblyId: string, rows: readonly AssemblyItem[]) {
      const blocked = guardWrite();
      if (blocked) return blocked;
      if (!rowsOf("assemblies").some((row) => row.id === assemblyId)) {
        return fail("invalid-input", "Assembly no longer exists.");
      }
      const items = new Set(rowsOf("items").map((row) => row.id));
      const retained = rowsOf("assembly_items").filter((row) => row.assembly_id !== assemblyId);
      const ids = new Set(retained.map((row) => row.id));
      for (const row of rows) {
        if (
          !row.id ||
          ids.has(row.id) ||
          row.assembly_id !== assemblyId ||
          !items.has(row.item_id) ||
          !Number.isFinite(row.quantity) ||
          row.quantity < 0
        ) {
          return fail(
            "invalid-input",
            "Invalid assembly component list. The saved components have been preserved."
          );
        }
        ids.add(row.id);
      }
      tables.assembly_items = [...retained, ...rows.map((row) => ({ ...row }) as StorageRow)];
      return ok(undefined as void);
    },

    async uploadFile(path: string, blob: Blob) {
      const blocked = guardWrite();
      if (blocked) return blocked;
      files.set(path, blob);
      return ok({ path });
    },

    async downloadFile(path: string) {
      if (faults.unreadable) return fail("io-failed", "This plan file could not be read.");
      const blob = files.get(path);
      return blob ? ok(blob) : fail("not-found", "That plan file is not in this workspace.");
    },

    async removeFiles(paths: readonly string[]) {
      const blocked = guardWrite();
      if (blocked) return blocked;
      for (const path of paths) files.delete(path);
      return ok(undefined as void);
    },

    async exportBundle(): Promise<PlatformResult<WorkspaceBundle>> {
      if (faults.unreadable) return fail("io-failed", "This workspace could not be exported.");
      const bundleFiles: RecoveryFile[] = [...files.entries()].map(([path, blob]) => ({
        path,
        blob,
      }));
      return ok({
        snapshot: {
          format: "voltline-recovery",
          schema_version: 1,
          exported_at: new Date().toISOString(),
          tables: copyOfTables(),
          files: bundleFiles.map(({ path }) => ({ path, recovery_filename: path })),
        },
        files: bundleFiles,
      });
    },

    async restore(data: BackupData) {
      const blocked = guardWrite();
      if (blocked) return blocked;
      if (faults.occupied) {
        return fail("occupied", "An estimate is open in another window.");
      }
      if (Object.values(tables).some((rows) => rows.length > 0)) {
        return fail(
          "occupied",
          "Restore requires an empty workspace. Nothing has been replaced."
        );
      }
      try {
        validateBackupSnapshot(
          data.snapshot,
          data.files.map((file) => file.path)
        );
      } catch (error) {
        return fail(
          "invalid-input",
          error instanceof Error ? error.message : "This backup could not be restored."
        );
      }
      tables = Object.fromEntries(
        Object.entries(data.snapshot.tables).map(([name, rows]) => [
          name,
          rows.map((row) => ({ ...row })),
        ])
      );
      files.clear();
      for (const file of data.files) files.set(file.path, file.blob);
      return ok(undefined as void);
    },

    async withExclusiveWorkspace<T>(job: () => Promise<T>) {
      if (faults.occupied || held) {
        return fail("occupied", "An estimate is open in another window.");
      }
      held = true;
      try {
        return ok(await job());
      } catch (error) {
        return fail(
          "io-failed",
          error instanceof Error ? error.message : "The maintenance job failed."
        );
      } finally {
        held = false;
      }
    },

    async health(): Promise<PlatformResult<StorageHealth>> {
      return ok({
        readable: !faults.unreadable,
        writable: !faults.readOnly,
        pendingMirror: null,
        detail: faults.unreadable
          ? "Storage could not be read."
          : faults.readOnly
            ? "Storage is not accepting writes."
            : null,
      });
    },
  };
}
