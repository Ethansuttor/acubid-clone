"use client";

/**
 * Browser adapter for the C1 storage port. It delegates to the existing
 * IndexedDB local client so today's browser behavior is unchanged: the same
 * lock, the same atomic mutation journal, the same recovery mirroring. This
 * file only translates shapes and error codes.
 */

import { supabase } from "../supabase";
import {
  exportLocalRecoveryBundle,
  replaceLocalAssemblyItems,
  restoreLocalBackup,
  withWorkspaceClosed,
} from "../localdb";
import type { AssemblyItem } from "../types";
import type { BackupData } from "../backup";
import {
  fail,
  failureFrom,
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

export const BROWSER_CAPABILITIES: PlatformCapabilities = {
  kind: "browser",
  contractVersion: PLATFORM_CONTRACT_VERSION,
  recordStore: "indexeddb",
  fileStore: "indexeddb",
  // Web Locks coordinate tabs within one origin and profile only. They do not
  // coordinate a second OS process, which is why the desktop adapter cannot
  // inherit this answer.
  exclusiveWorkspaceLock: typeof navigator !== "undefined" && !!navigator.locks,
  folderMirror: typeof window !== "undefined" && !!window.showDirectoryPicker,
  portableBackup: true,
  // Both API routes fail closed in production; the browser transport is only
  // useful on the local development server.
  aiTransport: "web-route",
  managedCredentials: false,
};

const BUCKET = "plans";

type QueryResult = { data: unknown; error: { message?: string } | null };

type QueryLike = {
  select: (columns?: string) => QueryLike;
  insert: (rows: StorageRow[]) => QueryLike;
  update: (patch: StorageRow) => QueryLike;
  delete: () => QueryLike;
  eq: (column: string, value: unknown) => QueryLike;
  in: (column: string, values: unknown[]) => QueryLike;
  order: (column: string, options?: { ascending?: boolean }) => QueryLike;
} & PromiseLike<QueryResult>;

function applyFilters(query: QueryLike, filters: readonly StorageFilter[]): QueryLike {
  let current = query;
  for (const filter of filters) {
    current =
      filter.kind === "eq"
        ? current.eq(filter.column, filter.value)
        : current.in(filter.column, [...filter.values]);
  }
  return current;
}

function table(name: string): QueryLike {
  return supabase().from(name) as unknown as QueryLike;
}

/** The local client reports failures as a message only; map them to codes. */
function codeFor(message: string): "conflict" | "not-found" | "occupied" | "io-failed" {
  if (/duplicate/i.test(message)) return "conflict";
  if (/not found/i.test(message)) return "not-found";
  if (/another tab|open in another/i.test(message)) return "occupied";
  return "io-failed";
}

function toFailure(message: string | undefined, fallback: string): PlatformResult<never> {
  const text = message && message.trim() ? message : fallback;
  return fail(codeFor(text), text);
}

export function createBrowserStorage(): WorkspaceStoragePort {
  return {
    capabilities: BROWSER_CAPABILITIES,

    async select(query: StorageSelect) {
      try {
        let builder = table(query.table).select("*");
        builder = applyFilters(builder, query.filters ?? []);
        if (query.order) {
          builder = builder.order(query.order.column, { ascending: query.order.ascending });
        }
        const { data, error } = await builder;
        if (error) return toFailure(error.message, "This estimate could not be read.");
        return ok((data as StorageRow[] | null) ?? []);
      } catch (error) {
        return failureFrom(error, "This estimate could not be read.");
      }
    },

    async insert(name: string, rows: readonly StorageRow[]) {
      try {
        const { data, error } = await table(name)
          .insert([...rows])
          .select("*");
        if (error) return toFailure(error.message, "This change could not be saved.");
        return ok((data as StorageRow[] | null) ?? []);
      } catch (error) {
        return failureFrom(error, "This change could not be saved.");
      }
    },

    async update(name: string, patch: StorageRow, filters: readonly StorageFilter[]) {
      try {
        const { error } = await applyFilters(table(name).update(patch), filters);
        if (error) return toFailure(error.message, "This change could not be saved.");
        return ok(undefined as void);
      } catch (error) {
        return failureFrom(error, "This change could not be saved.");
      }
    },

    async remove(name: string, filters: readonly StorageFilter[]) {
      try {
        const { error } = await applyFilters(table(name).delete(), filters);
        if (error) return toFailure(error.message, "This record could not be deleted.");
        return ok(undefined as void);
      } catch (error) {
        return failureFrom(error, "This record could not be deleted.");
      }
    },

    async replaceAssemblyItems(assemblyId: string, rows: readonly AssemblyItem[]) {
      try {
        const { error } = await replaceLocalAssemblyItems(assemblyId, [...rows]);
        if (error) {
          return fail(
            /Invalid assembly|no longer exists/i.test(error.message) ? "invalid-input" : "io-failed",
            error.message
          );
        }
        return ok(undefined as void);
      } catch (error) {
        return failureFrom(error, "Assembly components could not be saved.");
      }
    },

    async uploadFile(path: string, blob: Blob) {
      try {
        const { error } = await supabase().storage.from(BUCKET).upload(path, blob);
        if (error) return toFailure(error.message, "This plan file could not be stored.");
        return ok({ path });
      } catch (error) {
        return failureFrom(error, "This plan file could not be stored.");
      }
    },

    async downloadFile(path: string) {
      try {
        const { data, error } = await supabase().storage.from(BUCKET).download(path);
        if (error || !data) return toFailure(error?.message, "This plan file could not be read.");
        return ok(data as Blob);
      } catch (error) {
        return failureFrom(error, "This plan file could not be read.");
      }
    },

    async removeFiles(paths: readonly string[]) {
      try {
        const { error } = await supabase().storage.from(BUCKET).remove([...paths]);
        if (error) return toFailure(error.message, "Plan files could not be removed.");
        return ok(undefined as void);
      } catch (error) {
        return failureFrom(error, "Plan files could not be removed.");
      }
    },

    async exportBundle(): Promise<PlatformResult<WorkspaceBundle>> {
      try {
        return ok(await exportLocalRecoveryBundle());
      } catch (error) {
        return failureFrom(error, "This workspace could not be exported.");
      }
    },

    async restore(data: BackupData) {
      try {
        await restoreLocalBackup(data);
        return ok(undefined as void);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "This backup could not be restored.";
        if (/empty workspace/i.test(message)) return fail("occupied", message);
        if (/integrity|damaged/i.test(message)) return fail("integrity", message);
        if (/another tab|open in another/i.test(message)) return fail("occupied", message);
        if (/requires IndexedDB|cannot protect/i.test(message)) return fail("unavailable", message);
        if (/not a supported|invalid|missing|orphaned|duplicate|no name|no plan/i.test(message)) {
          return fail("invalid-input", message);
        }
        return failureFrom(error, "This backup could not be restored.");
      }
    },

    async withExclusiveWorkspace<T>(job: () => Promise<T>) {
      try {
        return ok(await withWorkspaceClosed(job));
      } catch (error) {
        const message = error instanceof Error ? error.message : "The workspace is in use.";
        if (/another tab|open in another/i.test(message)) return fail("occupied", message);
        if (/cannot protect/i.test(message)) return fail("unavailable", message);
        return failureFrom(error, "The workspace is in use.");
      }
    },

    async health(): Promise<PlatformResult<StorageHealth>> {
      try {
        const { error } = await table("projects").select("*");
        if (error) {
          return ok({
            readable: false,
            writable: false,
            pendingMirror: null,
            detail: error.message ?? "Browser storage could not be read.",
          });
        }
        return ok({ readable: true, writable: true, pendingMirror: null, detail: null });
      } catch (error) {
        return ok({
          readable: false,
          writable: false,
          pendingMirror: null,
          detail: error instanceof Error ? error.message : "Browser storage could not be read.",
        });
      }
    },
  };
}
