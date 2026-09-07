// The browser adapter is a translation layer over the existing IndexedDB local
// client: it must pass filters through unchanged and turn the local client's
// message-only failures into the contract's error codes. IndexedDB itself is
// not available under Node, so the local client is stubbed here and the
// adapter's real storage behavior is covered by the browser E2E suite.

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Recorded {
  table: string;
  op: string;
  filters: { kind: string; column?: string; col?: string; value?: unknown }[];
  patch?: Record<string, unknown>;
}

const recorded: Recorded[] = [];
let nextError: { message: string } | null = null;
let nextData: unknown = [];

function builder(table: string) {
  const entry: Recorded = { table, op: "select", filters: [] };
  const query = {
    select() {
      return query;
    },
    insert(rows: unknown) {
      entry.op = "insert";
      entry.patch = { rows } as Record<string, unknown>;
      return query;
    },
    update(patch: Record<string, unknown>) {
      entry.op = "update";
      entry.patch = patch;
      return query;
    },
    delete() {
      entry.op = "delete";
      return query;
    },
    eq(column: string, value: unknown) {
      entry.filters.push({ kind: "eq", column, value });
      return query;
    },
    in(column: string, values: unknown[]) {
      entry.filters.push({ kind: "in", column, value: values });
      return query;
    },
    order() {
      return query;
    },
    then(resolve: (value: { data: unknown; error: unknown }) => unknown) {
      recorded.push(entry);
      return Promise.resolve(resolve({ data: nextData, error: nextError }));
    },
  };
  return query;
}

vi.mock("@/lib/supabase", () => ({
  supabase: () => ({
    from: (table: string) => builder(table),
    storage: {
      from: () => ({
        async upload(path: string) {
          return nextError ? { data: null, error: nextError } : { data: { path }, error: null };
        },
        async download() {
          return nextError
            ? { data: null, error: nextError }
            : { data: new Blob([new Uint8Array([1])]), error: null };
        },
        async remove(paths: string[]) {
          return nextError ? { data: null, error: nextError } : { data: paths, error: null };
        },
      }),
    },
  }),
}));

vi.mock("@/lib/localdb", () => ({
  exportLocalRecoveryBundle: async () => ({
    snapshot: {
      format: "voltline-recovery",
      schema_version: 1,
      exported_at: "2026-09-07T00:00:00.000Z",
      tables: {},
    },
    files: [],
  }),
  replaceLocalAssemblyItems: async () => ({ error: replaceError }),
  restoreLocalBackup: async () => {
    if (restoreError) throw new Error(restoreError);
  },
  withWorkspaceClosed: async <T>(job: () => Promise<T>) => {
    if (closedError) throw new Error(closedError);
    return job();
  },
}));

let replaceError: { message: string } | null = null;
let restoreError: string | null = null;
let closedError: string | null = null;

const { createBrowserStorage } = await import("@/lib/platform/browser-storage");

beforeEach(() => {
  recorded.length = 0;
  nextError = null;
  nextData = [];
  replaceError = null;
  restoreError = null;
  closedError = null;
});

describe("browser adapter query translation", () => {
  it("passes eq and in filters through in order", async () => {
    const store = createBrowserStorage();
    await store.select({
      table: "takeoffs",
      filters: [
        { kind: "eq", column: "project_id", value: "p1" },
        { kind: "in", column: "layer_id", values: ["l1", "l2"] },
      ],
    });
    expect(recorded[0]).toMatchObject({
      table: "takeoffs",
      op: "select",
      filters: [
        { kind: "eq", column: "project_id", value: "p1" },
        { kind: "in", column: "layer_id", value: ["l1", "l2"] },
      ],
    });
  });

  it("applies filters to an update rather than the whole table", async () => {
    const store = createBrowserStorage();
    await store.update("layers", { name: "New" }, [{ kind: "eq", column: "id", value: "l1" }]);
    expect(recorded[0].op).toBe("update");
    expect(recorded[0].filters).toEqual([{ kind: "eq", column: "id", value: "l1" }]);
  });
});

describe("browser adapter error mapping", () => {
  it("maps a duplicate id to conflict", async () => {
    nextError = { message: "duplicate id" };
    const result = await createBrowserStorage().insert("items", [{ id: "i1" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("conflict");
  });

  it("maps a missing plan file to not-found", async () => {
    nextError = { message: "file not found" };
    const result = await createBrowserStorage().downloadFile("p1/plans/x.pdf");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not-found");
  });

  it("maps an invalid component list to invalid-input and keeps its message", async () => {
    replaceError = {
      message: "Invalid assembly component list. The saved components have been preserved.",
    };
    const result = await createBrowserStorage().replaceAssemblyItems("as1", []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid-input");
      expect(result.error.message).toMatch(/preserved/);
    }
  });

  it("maps a non-empty restore destination to occupied", async () => {
    restoreError =
      "Restore requires an empty workspace. Open Voltline in a new browser profile to recover this backup without replacing existing work.";
    const result = await createBrowserStorage().restore({
      snapshot: {
        format: "voltline-recovery",
        schema_version: 1,
        exported_at: "2026-09-07T00:00:00.000Z",
        tables: {},
      },
      files: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("occupied");
  });

  it("maps a damaged backup to integrity", async () => {
    restoreError = "Backup integrity check failed. The file is damaged or has been changed.";
    const result = await createBrowserStorage().restore({
      snapshot: {
        format: "voltline-recovery",
        schema_version: 1,
        exported_at: "2026-09-07T00:00:00.000Z",
        tables: {},
      },
      files: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("integrity");
  });

  it("maps a second open tab to occupied", async () => {
    closedError =
      "An estimate is open in another tab. Finish saving and return to Projects in that tab before backing up or restoring.";
    const result = await createBrowserStorage().withExclusiveWorkspace(async () => "done");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("occupied");
  });

  it("reports an unreadable store through health instead of throwing", async () => {
    nextError = { message: "Could not open browser storage." };
    const result = await createBrowserStorage().health();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.readable).toBe(false);
      expect(result.value.detail).toMatch(/browser storage/i);
    }
  });
});
