/**
 * The C1 storage contract, expressed as an executable suite.
 *
 * Any adapter claiming to implement `WorkspaceStoragePort` — the in-memory
 * fake, the IndexedDB browser adapter, a future SQLite desktop adapter — runs
 * this same suite. A rule that matters to an estimator's data belongs here
 * rather than in one adapter's own tests.
 */

import { describe, expect, it } from "vitest";
import type { BackupData } from "@/lib/backup";
import { expect as unwrap } from "@/lib/platform/contracts";
import type { WorkspaceStoragePort } from "@/lib/platform/storage";

const TABLES = [
  "projects",
  "documents",
  "sheets",
  "layers",
  "takeoffs",
  "items",
  "assemblies",
  "assembly_items",
  "direct_costs",
  "proposal_entries",
  "bid_snapshots",
] as const;

function emptyTables(): Record<string, Record<string, unknown>[]> {
  return Object.fromEntries(TABLES.map((name) => [name, []]));
}

/** A minimal but structurally valid workspace: one project, plan, sheet, count. */
export function sampleBackup(): BackupData {
  const tables = emptyTables();
  tables.projects = [{ id: "p1", name: "Warehouse lighting" }];
  tables.documents = [{ id: "d1", project_id: "p1", storage_path: "p1/plans/e101.pdf" }];
  tables.sheets = [{ id: "s1", project_id: "p1", document_id: "d1", page: 1 }];
  tables.layers = [{ id: "l1", project_id: "p1", name: "Receptacles" }];
  tables.takeoffs = [{ id: "t1", project_id: "p1", sheet_id: "s1", layer_id: "l1", quantity: 12 }];
  return {
    snapshot: {
      format: "voltline-recovery",
      schema_version: 1,
      exported_at: new Date().toISOString(),
      tables,
    },
    files: [{ path: "p1/plans/e101.pdf", blob: new Blob([new Uint8Array([1, 2, 3])]) }],
  };
}

export function describeStoragePortContract(
  name: string,
  makePort: () => WorkspaceStoragePort | Promise<WorkspaceStoragePort>
): void {
  const port = async () => await makePort();

  describe(`${name} — storage port contract`, () => {
    it("reports the contract version it was built against", async () => {
      const store = await port();
      expect(store.capabilities.contractVersion).toBe(1);
    });

    it("returns inserted rows and finds them again", async () => {
      const store = await port();
      const inserted = unwrap(await store.insert("projects", [{ name: "Clinic fit-out" }]));
      expect(inserted).toHaveLength(1);
      expect(typeof inserted[0].id).toBe("string");
      const found = unwrap(await store.select({ table: "projects" }));
      expect(found.map((row) => row.name)).toEqual(["Clinic fit-out"]);
    });

    it("filters and orders selects", async () => {
      const store = await port();
      unwrap(
        await store.insert("layers", [
          { id: "a", project_id: "p1", name: "B" },
          { id: "b", project_id: "p1", name: "A" },
          { id: "c", project_id: "p2", name: "C" },
        ])
      );
      const forProject = unwrap(
        await store.select({
          table: "layers",
          filters: [{ kind: "eq", column: "project_id", value: "p1" }],
          order: { column: "name", ascending: true },
        })
      );
      expect(forProject.map((row) => row.id)).toEqual(["b", "a"]);

      const byIds = unwrap(
        await store.select({
          table: "layers",
          filters: [{ kind: "in", column: "id", values: ["a", "c"] }],
        })
      );
      expect(byIds.map((row) => row.id).sort()).toEqual(["a", "c"]);
    });

    it("rejects a duplicate id as a conflict without writing the batch", async () => {
      const store = await port();
      unwrap(await store.insert("items", [{ id: "i1", description: "1G box" }]));
      const result = await store.insert("items", [
        { id: "i2", description: "2G box" },
        { id: "i1", description: "duplicate" },
      ]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("conflict");
      const rows = unwrap(await store.select({ table: "items" }));
      expect(rows.map((row) => row.id)).toEqual(["i1"]);
    });

    it("updates only matching rows", async () => {
      const store = await port();
      unwrap(
        await store.insert("layers", [
          { id: "a", project_id: "p1", name: "Old" },
          { id: "b", project_id: "p2", name: "Keep" },
        ])
      );
      unwrap(
        await store.update("layers", { name: "New" }, [{ kind: "eq", column: "id", value: "a" }])
      );
      const rows = unwrap(await store.select({ table: "layers" }));
      expect(rows.find((row) => row.id === "a")?.name).toBe("New");
      expect(rows.find((row) => row.id === "b")?.name).toBe("Keep");
    });

    it("cascades a delete to dependent records", async () => {
      const store = await port();
      unwrap(await store.insert("projects", [{ id: "p1", name: "Warehouse" }]));
      unwrap(await store.insert("layers", [{ id: "l1", project_id: "p1", name: "Recep" }]));
      unwrap(await store.insert("sheets", [{ id: "s1", project_id: "p1", document_id: "d1" }]));
      unwrap(
        await store.insert("takeoffs", [
          { id: "t1", project_id: "p1", sheet_id: "s1", layer_id: "l1" },
        ])
      );
      unwrap(await store.remove("projects", [{ kind: "eq", column: "id", value: "p1" }]));
      expect(unwrap(await store.select({ table: "takeoffs" }))).toHaveLength(0);
      expect(unwrap(await store.select({ table: "layers" }))).toHaveLength(0);
    });

    it("replaces an assembly's components atomically", async () => {
      const store = await port();
      unwrap(await store.insert("assemblies", [{ id: "as1", name: "Duplex receptacle" }]));
      unwrap(
        await store.insert("items", [
          { id: "i1", description: "Device box" },
          { id: "i2", description: "Duplex" },
        ])
      );
      unwrap(
        await store.replaceAssemblyItems("as1", [
          { id: "ai1", assembly_id: "as1", item_id: "i1", user_id: "u", quantity: 1 },
          { id: "ai2", assembly_id: "as1", item_id: "i2", user_id: "u", quantity: 1 },
        ])
      );
      expect(unwrap(await store.select({ table: "assembly_items" }))).toHaveLength(2);

      // One bad component must not remove the previously priced list.
      const rejected = await store.replaceAssemblyItems("as1", [
        { id: "ai3", assembly_id: "as1", item_id: "i1", user_id: "u", quantity: 1 },
        { id: "ai4", assembly_id: "as1", item_id: "missing", user_id: "u", quantity: 1 },
      ]);
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) expect(rejected.error.code).toBe("invalid-input");
      const kept = unwrap(await store.select({ table: "assembly_items" }));
      expect(kept.map((row) => row.id).sort()).toEqual(["ai1", "ai2"]);
    });

    it("refuses components for an assembly that no longer exists", async () => {
      const store = await port();
      const result = await store.replaceAssemblyItems("gone", []);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid-input");
    });

    it("stores and returns plan bytes, and reports a missing file", async () => {
      const store = await port();
      const bytes = new Uint8Array([37, 80, 68, 70]);
      unwrap(await store.uploadFile("p1/plans/e101.pdf", new Blob([bytes])));
      const blob = unwrap(await store.downloadFile("p1/plans/e101.pdf"));
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);

      const missing = await store.downloadFile("p1/plans/nothing.pdf");
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.error.code).toBe("not-found");
    });

    it("exports a bundle containing every table and every plan file", async () => {
      const store = await port();
      unwrap(await store.insert("projects", [{ id: "p1", name: "Warehouse" }]));
      unwrap(await store.uploadFile("p1/plans/e101.pdf", new Blob([new Uint8Array([1])])));
      const bundle = unwrap(await store.exportBundle());
      expect(bundle.snapshot.format).toBe("voltline-recovery");
      expect(bundle.snapshot.tables.projects).toHaveLength(1);
      expect(bundle.files.map((file) => file.path)).toEqual(["p1/plans/e101.pdf"]);
    });

    it("restores a validated backup into an empty workspace", async () => {
      const store = await port();
      unwrap(await store.restore(sampleBackup()));
      expect(unwrap(await store.select({ table: "projects" }))).toHaveLength(1);
      const blob = unwrap(await store.downloadFile("p1/plans/e101.pdf"));
      expect(blob.size).toBe(3);
    });

    it("refuses to restore over existing work", async () => {
      const store = await port();
      unwrap(await store.insert("projects", [{ name: "In progress" }]));
      const result = await store.restore(sampleBackup());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("occupied");
      expect(unwrap(await store.select({ table: "projects" }))[0].name).toBe("In progress");
    });

    it("rejects a backup whose plan file is missing before writing anything", async () => {
      const store = await port();
      const backup = sampleBackup();
      const result = await store.restore({ ...backup, files: [] });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid-input");
      expect(unwrap(await store.select({ table: "projects" }))).toHaveLength(0);
    });

    it("runs a maintenance job with the workspace held", async () => {
      const store = await port();
      const result = await store.withExclusiveWorkspace(async () => "done");
      expect(result).toEqual({ ok: true, value: "done" });
    });

    it("reports health rather than throwing", async () => {
      const store = await port();
      const health = unwrap(await store.health());
      expect(typeof health.readable).toBe("boolean");
      expect(typeof health.writable).toBe("boolean");
    });
  });
}
