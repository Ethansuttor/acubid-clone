/**
 * The C1 storage contract, expressed as an executable suite.
 *
 * Any adapter claiming to implement `WorkspaceStoragePort` — the in-memory
 * fake, the IndexedDB browser adapter, a future SQLite desktop adapter — runs
 * this same suite. A rule that matters to an estimator's data belongs here
 * rather than in one adapter's own tests.
 */

import { describe, expect, it } from "vitest";
import {
  decodeBackup,
  encodeBackup,
  validateBackupSnapshot,
  type BackupData,
} from "@/lib/backup";
import { expect as unwrap } from "@/lib/platform/contracts";
import type { StorageRow, WorkspaceStoragePort } from "@/lib/platform/storage";
import type { AssemblyItem } from "@/lib/types";

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
      // Parents first: an adapter that enforces relations (SQLite) must be
      // able to run the same fixture as one that does not.
      unwrap(await store.insert("projects", [{ id: "p1", name: "One" }, { id: "p2", name: "Two" }]));
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
      unwrap(await store.insert("projects", [{ id: "p1", name: "One" }, { id: "p2", name: "Two" }]));
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
      // The plan file is stored before the document that references it.
      unwrap(await store.uploadFile("p1/plans/e101.pdf", new Blob([new Uint8Array([1])])));
      unwrap(
        await store.insert("documents", [
          { id: "d1", project_id: "p1", storage_path: "p1/plans/e101.pdf" },
        ])
      );
      unwrap(await store.insert("sheets", [{ id: "s1", project_id: "p1", document_id: "d1" }]));
      unwrap(
        await store.insert("takeoffs", [
          { id: "t1", project_id: "p1", sheet_id: "s1", layer_id: "l1" },
        ])
      );
      unwrap(await store.remove("projects", [{ kind: "eq", column: "id", value: "p1" }]));
      expect(unwrap(await store.select({ table: "takeoffs" }))).toHaveLength(0);
      expect(unwrap(await store.select({ table: "layers" }))).toHaveLength(0);
      expect(unwrap(await store.select({ table: "sheets" }))).toHaveLength(0);
      expect(unwrap(await store.select({ table: "documents" }))).toHaveLength(0);
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

  describeCharacterization(name, port);
}

// ---------------------------------------------------------------------------
// S1 characterization: behavior every adapter already shares. Fixtures are
// structurally valid (parents before children, plan bytes before the document
// that references them) so an adapter that enforces relations runs them too.
// ---------------------------------------------------------------------------

const PLAN_PATH = "p1/plans/e101.pdf";
const PLAN_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37];
const byId = (id: string) => [{ kind: "eq" as const, column: "id", value: id }];
const ids = (rows: StorageRow[]) => rows.map((row) => row.id);

async function seedProjectWithSheets(
  store: WorkspaceStoragePort,
  pages: number[] = [1]
): Promise<void> {
  unwrap(await store.insert("projects", [{ id: "p1", name: "Warehouse" }]));
  unwrap(await store.uploadFile(PLAN_PATH, new Blob([new Uint8Array(PLAN_BYTES)])));
  unwrap(
    await store.insert("documents", [
      {
        id: "d1",
        project_id: "p1",
        filename: "E-101.pdf",
        storage_path: PLAN_PATH,
        page_count: pages.length,
      },
    ])
  );
  unwrap(
    await store.insert(
      "sheets",
      pages.map((page) => ({
        id: `s${page}`,
        project_id: "p1",
        document_id: "d1",
        page_number: page,
        name: `E-101 p${page}`,
      }))
    )
  );
}

function component(id: string, assemblyId: string, itemId: string, quantity = 1): AssemblyItem {
  return { id, assembly_id: assemblyId, item_id: itemId, user_id: "u", quantity };
}

async function expectRejectedPreservingList(
  store: WorkspaceStoragePort,
  rows: AssemblyItem[],
  expected: string[]
): Promise<void> {
  const result = await store.replaceAssemblyItems("as1", rows);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe("invalid-input");
  const kept = unwrap(await store.select({ table: "assembly_items" }));
  expect(ids(kept).sort()).toEqual(expected);
}

type Filters = Parameters<WorkspaceStoragePort["select"]>[0]["filters"];

function describeCharacterization(
  name: string,
  port: () => Promise<WorkspaceStoragePort>
): void {
  describe(`${name} — storage port characterization (S1)`, () => {
    it("applies operations issued without awaiting in call order", async () => {
      const store = await port();
      const inserted = store.insert("projects", [{ id: "p1", name: "First" }]);
      const updated = store.update("projects", { name: "Second" }, byId("p1"));
      const read = store.select({ table: "projects" });
      const [insertResult, updateResult, readResult] = await Promise.all([inserted, updated, read]);
      expect(insertResult.ok && updateResult.ok).toBe(true);
      expect(unwrap(readResult).map((row) => row.name)).toEqual(["Second"]);
    });

    it("fills id and timestamps on insert and keeps caller-supplied values", async () => {
      const store = await port();
      const generated = unwrap(
        await store.insert("projects", [{ name: "Generated A" }, { name: "Generated B" }])
      );
      expect(generated.every((row) => typeof row.id === "string" && row.id !== "")).toBe(true);
      expect(generated[0].id).not.toBe(generated[1].id);
      expect(Number.isFinite(Date.parse(String(generated[0].created_at)))).toBe(true);
      const [given] = unwrap(
        await store.insert("projects", [
          { id: "given", name: "Given", created_at: "2026-01-02T03:04:05.000Z" },
        ])
      );
      expect(given.id).toBe("given");
      expect(given.created_at).toBe("2026-01-02T03:04:05.000Z");
    });

    it("round-trips numbers, geometry, booleans and nulls exactly", async () => {
      const store = await port();
      const project = {
        id: "p1",
        name: "Exact",
        labor_rate: 0.1 + 0.2,
        overhead_pct: 1 / 3,
        profit_pct: -0,
        waste_pct: 5e-324,
        tax_pct: 1.7976931348623157e308,
        bond_pct: 99.99999999999999,
        archived_at: null,
      };
      unwrap(await store.insert("projects", [project]));
      unwrap(await store.uploadFile(PLAN_PATH, new Blob([new Uint8Array(PLAN_BYTES)])));
      unwrap(
        await store.insert("documents", [{ id: "d1", project_id: "p1", storage_path: PLAN_PATH }])
      );
      const calibration = { p1: [12.5, -0], p2: [612.000001, 1e-9], distance_ft: 10.125 };
      unwrap(
        await store.insert("sheets", [
          {
            id: "s1",
            project_id: "p1",
            document_id: "d1",
            page_number: 1,
            scale_ft_per_unit: 0.0138888,
            calibration,
          },
        ])
      );
      unwrap(
        await store.insert("layers", [{ id: "l1", project_id: "p1", name: "Feeders", tool: "linear" }])
      );
      const geometry = {
        points: [
          [0.1, -0],
          [1e-7, 123456.789],
          [-5e-324, 2 ** 53],
        ],
      };
      unwrap(
        await store.insert("takeoffs", [
          {
            id: "t1",
            project_id: "p1",
            sheet_id: "s1",
            layer_id: "l1",
            kind: "linear",
            geometry,
            source: "ai",
            status: "pending",
            ai_confidence: 0.87654321,
            detection_review: "local",
          },
        ])
      );
      unwrap(
        await store.insert("direct_costs", [
          { id: "dc1", project_id: "p1", amount: 12000.005, ohp_applies: true, taxable: false },
        ])
      );

      const [storedProject] = unwrap(await store.select({ table: "projects", filters: byId("p1") }));
      for (const [key, value] of Object.entries(project)) {
        expect(Object.is(storedProject[key], value), key).toBe(true);
      }
      const [sheet] = unwrap(await store.select({ table: "sheets" }));
      expect(sheet.calibration).toEqual(calibration);
      expect(Object.is((sheet.calibration as typeof calibration).p1[1], -0)).toBe(true);
      const [takeoff] = unwrap(await store.select({ table: "takeoffs" }));
      expect(takeoff.geometry).toEqual(geometry);
      expect(Object.is((takeoff.geometry as typeof geometry).points[0][1], -0)).toBe(true);
      expect(takeoff.status).toBe("pending");
      expect(takeoff.ai_confidence).toBe(0.87654321);
      const [cost] = unwrap(await store.select({ table: "direct_costs" }));
      expect(cost.ohp_applies).toBe(true);
      expect(cost.taxable).toBe(false);
      expect(cost.amount).toBe(12000.005);
    });

    it("keeps absent fields absent, explicit nulls null, and unknown fields intact", async () => {
      const store = await port();
      unwrap(
        await store.insert("projects", [
          { id: "legacy", name: "Written before archiving existed" },
          { id: "active", name: "Active", archived_at: null },
        ])
      );
      unwrap(
        await store.insert("layers", [
          {
            id: "l1",
            project_id: "legacy",
            name: "Old",
            legacy_note: "kept",
            nested: { x: [1, { y: 2 }] },
          },
        ])
      );
      const projects = unwrap(await store.select({ table: "projects" }));
      const legacy = projects.find((row) => row.id === "legacy")!;
      const active = projects.find((row) => row.id === "active")!;
      expect("archived_at" in legacy).toBe(false);
      expect(active.archived_at).toBeNull();
      const [layer] = unwrap(await store.select({ table: "layers" }));
      expect(layer.legacy_note).toBe("kept");
      expect(layer.nested).toEqual({ x: [1, { y: 2 }] });
      expect("tool" in layer).toBe(false);
    });

    it("combines filters with AND; `in` with no values matches nothing", async () => {
      const store = await port();
      unwrap(await store.insert("projects", [{ id: "p1", name: "One" }, { id: "p2", name: "Two" }]));
      unwrap(
        await store.insert("layers", [
          { id: "a", project_id: "p1", name: "A", tool: "count" },
          { id: "b", project_id: "p1", name: "B", tool: "linear" },
          { id: "c", project_id: "p2", name: "C", tool: "count" },
        ])
      );
      const select = async (filters: Filters) =>
        ids(unwrap(await store.select({ table: "layers", filters })));
      expect(
        await select([
          { kind: "eq", column: "project_id", value: "p1" },
          { kind: "eq", column: "tool", value: "count" },
        ])
      ).toEqual(["a"]);
      expect(
        await select([
          { kind: "eq", column: "project_id", value: "p1" },
          { kind: "in", column: "id", values: ["b", "c"] },
        ])
      ).toEqual(["b"]);
      expect(await select([{ kind: "in", column: "id", values: [] }])).toEqual([]);
    });

    it("finds exactly one row by id and an empty list for a missing id (single() builds on this)", async () => {
      const store = await port();
      unwrap(await store.insert("projects", [{ id: "p1", name: "One" }, { id: "p2", name: "Two" }]));
      const one = unwrap(await store.select({ table: "projects", filters: byId("p2") }));
      expect(ids(one)).toEqual(["p2"]);
      const none = await store.select({ table: "projects", filters: byId("missing") });
      expect(none).toEqual({ ok: true, value: [] });
    });

    it("returns rows in insertion order and sorts stably in both directions", async () => {
      const store = await port();
      unwrap(await store.insert("projects", [{ id: "p1", name: "One" }]));
      unwrap(
        await store.insert("layers", [
          { id: "w", project_id: "p1", name: "W", sort_order: 2 },
          { id: "x", project_id: "p1", name: "X", sort_order: 1 },
          { id: "y", project_id: "p1", name: "Y", sort_order: 2 },
          { id: "z", project_id: "p1", name: "Z", sort_order: 0 },
        ])
      );
      expect(ids(unwrap(await store.select({ table: "layers" })))).toEqual(["w", "x", "y", "z"]);
      const ordered = async (ascending: boolean) =>
        ids(
          unwrap(
            await store.select({ table: "layers", order: { column: "sort_order", ascending } })
          )
        );
      expect(await ordered(true)).toEqual(["z", "x", "w", "y"]);
      expect(await ordered(false)).toEqual(["w", "y", "x", "z"]);
    });

    it("returns copies: editing a returned or submitted row does not edit the store", async () => {
      const store = await port();
      const submitted = { id: "p1", name: "Original" };
      const [returned] = unwrap(await store.insert("projects", [submitted]));
      submitted.name = "Edited after insert";
      returned.name = "Edited return value";
      const [selected] = unwrap(await store.select({ table: "projects" }));
      selected.name = "Edited selection";
      const [again] = unwrap(await store.select({ table: "projects" }));
      expect(again.name).toBe("Original");
    });

    it("merges an update patch; null clears a field; a patch matching nothing is not an error", async () => {
      const store = await port();
      unwrap(await store.insert("projects", [{ id: "p1", name: "One" }]));
      unwrap(
        await store.insert("layers", [
          { id: "a", project_id: "p1", name: "Old", color: "#ffffff", item_id: "i1" },
          { id: "b", project_id: "p1", name: "Other", color: "#000000", item_id: "i1" },
        ])
      );
      unwrap(
        await store.update("layers", { name: "New", item_id: null }, [
          { kind: "eq", column: "project_id", value: "p1" },
          { kind: "eq", column: "id", value: "a" },
        ])
      );
      unwrap(await store.update("layers", { name: "Nobody" }, byId("missing")));
      const rows = unwrap(await store.select({ table: "layers" }));
      const a = rows.find((row) => row.id === "a")!;
      const b = rows.find((row) => row.id === "b")!;
      expect([a.name, a.color, a.item_id]).toEqual(["New", "#ffffff", null]);
      expect([b.name, b.color, b.item_id]).toEqual(["Other", "#000000", "i1"]);
    });

    it("removes only matching rows; removing nothing is not an error", async () => {
      const store = await port();
      unwrap(
        await store.insert("items", [
          { id: "a", description: "A" },
          { id: "b", description: "B" },
          { id: "c", description: "C" },
        ])
      );
      unwrap(await store.remove("items", [{ kind: "in", column: "id", values: ["a", "c"] }]));
      unwrap(await store.remove("items", byId("missing")));
      expect(ids(unwrap(await store.select({ table: "items" })))).toEqual(["b"]);
    });

    it("permanently deleting a project removes all of its records and its plan file, not the catalog", async () => {
      const store = await port();
      await seedProjectWithSheets(store);
      unwrap(await store.insert("projects", [{ id: "p2", name: "Neighbour" }]));
      unwrap(
        await store.insert("layers", [
          { id: "l1", project_id: "p1", name: "Recep", tool: "count" },
          { id: "l2", project_id: "p2", name: "Kept", tool: "count" },
        ])
      );
      unwrap(
        await store.insert("takeoffs", [
          {
            id: "t1",
            project_id: "p1",
            sheet_id: "s1",
            layer_id: "l1",
            kind: "count",
            geometry: { x: 1, y: 2 },
          },
        ])
      );
      unwrap(await store.insert("direct_costs", [{ id: "dc1", project_id: "p1", amount: 100 }]));
      unwrap(
        await store.insert("proposal_entries", [{ id: "pe1", project_id: "p1", kind: "exclusion" }])
      );
      unwrap(
        await store.insert("bid_snapshots", [
          { id: "bs1", project_id: "p1", revision: 1, bid_price: 1, payload: { schema_version: 2 } },
        ])
      );
      unwrap(await store.insert("items", [{ id: "i1", description: "Box" }]));
      unwrap(await store.insert("assemblies", [{ id: "as1", name: "Duplex" }]));
      unwrap(await store.replaceAssemblyItems("as1", [component("ai1", "as1", "i1")]));

      unwrap(await store.remove("projects", byId("p1")));

      for (const table of [
        "documents",
        "sheets",
        "takeoffs",
        "direct_costs",
        "proposal_entries",
        "bid_snapshots",
      ]) {
        expect(unwrap(await store.select({ table })), table).toHaveLength(0);
      }
      expect(ids(unwrap(await store.select({ table: "projects" })))).toEqual(["p2"]);
      expect(ids(unwrap(await store.select({ table: "layers" })))).toEqual(["l2"]);
      expect(ids(unwrap(await store.select({ table: "items" })))).toEqual(["i1"]);
      expect(ids(unwrap(await store.select({ table: "assembly_items" })))).toEqual(["ai1"]);
      const plan = await store.downloadFile(PLAN_PATH);
      expect(plan.ok).toBe(false);
      if (!plan.ok) expect(plan.error.code).toBe("not-found");
    });

    it("deleting a layer removes its takeoffs; deleting a document removes its sheets, takeoffs and plan file", async () => {
      const store = await port();
      await seedProjectWithSheets(store, [1, 2]);
      unwrap(
        await store.insert("layers", [
          { id: "l1", project_id: "p1", name: "One", tool: "count" },
          { id: "l2", project_id: "p1", name: "Two", tool: "count" },
        ])
      );
      const at = { x: 0, y: 0 };
      unwrap(
        await store.insert("takeoffs", [
          { id: "t1", project_id: "p1", sheet_id: "s1", layer_id: "l1", kind: "count", geometry: at },
          { id: "t2", project_id: "p1", sheet_id: "s2", layer_id: "l2", kind: "count", geometry: at },
          { id: "t3", project_id: "p1", sheet_id: "s1", layer_id: "l2", kind: "count", geometry: at },
        ])
      );
      unwrap(await store.remove("layers", byId("l1")));
      expect(ids(unwrap(await store.select({ table: "takeoffs" })))).toEqual(["t2", "t3"]);
      expect(unwrap(await store.select({ table: "sheets" }))).toHaveLength(2);

      unwrap(await store.remove("documents", byId("d1")));
      expect(unwrap(await store.select({ table: "sheets" }))).toHaveLength(0);
      expect(unwrap(await store.select({ table: "takeoffs" }))).toHaveLength(0);
      expect(ids(unwrap(await store.select({ table: "layers" })))).toEqual(["l2"]);
      const plan = await store.downloadFile(PLAN_PATH);
      expect(plan.ok).toBe(false);
      if (!plan.ok) expect(plan.error.code).toBe("not-found");
    });

    it("deleting a catalog item removes its components but keeps a layer's link visible", async () => {
      const store = await port();
      unwrap(await store.insert("projects", [{ id: "p1", name: "One" }]));
      unwrap(
        await store.insert("items", [
          { id: "i1", description: "Box" },
          { id: "i2", description: "Device" },
        ])
      );
      unwrap(
        await store.insert("assemblies", [
          { id: "as1", name: "Duplex" },
          { id: "as2", name: "Spare" },
        ])
      );
      unwrap(
        await store.replaceAssemblyItems("as1", [
          component("ai1", "as1", "i1"),
          component("ai2", "as1", "i2"),
        ])
      );
      unwrap(await store.replaceAssemblyItems("as2", [component("bi1", "as2", "i2")]));
      unwrap(
        await store.insert("layers", [
          {
            id: "l1",
            project_id: "p1",
            name: "Boxes",
            tool: "count",
            item_id: "i1",
            assembly_id: "as2",
          },
        ])
      );
      unwrap(await store.remove("items", byId("i1")));
      expect(ids(unwrap(await store.select({ table: "assembly_items" })))).toEqual(["ai2", "bi1"]);
      // The dangling link stays so the estimate reports a missing item rather
      // than silently treating the layer as unlinked.
      const [layer] = unwrap(await store.select({ table: "layers" }));
      expect(layer.item_id).toBe("i1");

      unwrap(await store.remove("assemblies", byId("as2")));
      expect(ids(unwrap(await store.select({ table: "assembly_items" })))).toEqual(["ai2"]);
      expect(unwrap(await store.select({ table: "layers" }))[0].assembly_id).toBe("as2");
    });

    it("archiving a project keeps it and all of its records; unarchiving clears the mark", async () => {
      const store = await port();
      await seedProjectWithSheets(store);
      unwrap(
        await store.insert("layers", [{ id: "l1", project_id: "p1", name: "Recep", tool: "count" }])
      );
      unwrap(
        await store.update("projects", { archived_at: "2026-09-01T00:00:00.000Z" }, byId("p1"))
      );
      const [archived] = unwrap(await store.select({ table: "projects", filters: byId("p1") }));
      expect(archived.archived_at).toBe("2026-09-01T00:00:00.000Z");
      expect(unwrap(await store.select({ table: "layers" }))).toHaveLength(1);
      expect(unwrap(await store.select({ table: "sheets" }))).toHaveLength(1);
      expect(unwrap(await store.downloadFile(PLAN_PATH)).size).toBe(PLAN_BYTES.length);
      unwrap(await store.update("projects", { archived_at: null }, byId("p1")));
      const [restored] = unwrap(await store.select({ table: "projects", filters: byId("p1") }));
      expect(restored.archived_at).toBeNull();
    });

    it("stores a plan file idempotently, returns a Blob, and ignores unknown names on removal", async () => {
      const store = await port();
      const bytes = new Uint8Array(PLAN_BYTES);
      expect(unwrap(await store.uploadFile(PLAN_PATH, new Blob([bytes])))).toEqual({
        path: PLAN_PATH,
      });
      expect(unwrap(await store.uploadFile(PLAN_PATH, new Blob([bytes])))).toEqual({
        path: PLAN_PATH,
      });
      const blob = unwrap(await store.downloadFile(PLAN_PATH));
      expect(blob).toBeInstanceOf(Blob);
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
      unwrap(await store.removeFiles([PLAN_PATH, "p1/plans/never-stored.pdf"]));
      const gone = await store.downloadFile(PLAN_PATH);
      expect(gone.ok).toBe(false);
      if (!gone.ok) expect(gone.error.code).toBe("not-found");
    });

    it("keeps the previously priced component list for every kind of invalid replacement", async () => {
      const store = await port();
      unwrap(
        await store.insert("items", [
          { id: "i1", description: "Box" },
          { id: "i2", description: "Device" },
        ])
      );
      unwrap(
        await store.insert("assemblies", [
          { id: "as1", name: "Duplex" },
          { id: "as2", name: "Other" },
        ])
      );
      unwrap(
        await store.replaceAssemblyItems("as1", [
          component("ai1", "as1", "i1"),
          component("ai2", "as1", "i2"),
        ])
      );
      unwrap(await store.replaceAssemblyItems("as2", [component("bi1", "as2", "i1")]));
      const kept = ["ai1", "ai2", "bi1"];
      await expectRejectedPreservingList(store, [component("n1", "as2", "i1")], kept);
      await expectRejectedPreservingList(store, [component("n1", "as1", "i1", -1)], kept);
      await expectRejectedPreservingList(store, [component("n1", "as1", "i1", Number.NaN)], kept);
      await expectRejectedPreservingList(
        store,
        [component("n1", "as1", "i1"), component("n1", "as1", "i2")],
        kept
      );
      await expectRejectedPreservingList(store, [component("bi1", "as1", "i1")], kept);
      await expectRejectedPreservingList(store, [component("", "as1", "i1")], kept);

      unwrap(await store.replaceAssemblyItems("as1", [component("ai3", "as1", "i2", 2.5)]));
      expect(ids(unwrap(await store.select({ table: "assembly_items" }))).sort()).toEqual([
        "ai3",
        "bi1",
      ]);
      unwrap(await store.replaceAssemblyItems("as1", []));
      expect(ids(unwrap(await store.select({ table: "assembly_items" })))).toEqual(["bi1"]);
    });

    it("stores bid snapshots with the caller's revision, per project, newest first", async () => {
      const store = await port();
      unwrap(await store.insert("projects", [{ id: "p1", name: "One" }, { id: "p2", name: "Two" }]));
      const payload = {
        schema_version: 2,
        summary: { bid_price: 123456.78901234, overhead: 0.1 + 0.2 },
      };
      unwrap(
        await store.insert("bid_snapshots", [
          { id: "r1", project_id: "p1", revision: 1, label: "Rev 1", bid_price: 100, payload },
          { id: "r2", project_id: "p1", revision: 2, label: "Rev 2", bid_price: 200, payload },
          { id: "q1", project_id: "p2", revision: 1, label: "Other", bid_price: 50, payload },
        ])
      );
      const snapshots = unwrap(
        await store.select({
          table: "bid_snapshots",
          filters: [{ kind: "eq", column: "project_id", value: "p1" }],
          order: { column: "revision", ascending: false },
        })
      );
      expect(snapshots.map((row) => row.revision)).toEqual([2, 1]);
      expect(snapshots[0].payload).toEqual(payload);
    });

    it("exports a bundle that restores into an empty workspace with identical records and plan bytes", async () => {
      const source = await port();
      await seedProjectWithSheets(source);
      unwrap(
        await source.insert("layers", [
          { id: "l1", project_id: "p1", name: "Recep", tool: "count", sort_order: 0 },
        ])
      );
      unwrap(
        await source.insert("takeoffs", [
          {
            id: "t1",
            project_id: "p1",
            sheet_id: "s1",
            layer_id: "l1",
            kind: "count",
            geometry: { x: 10.25, y: 0.1 + 0.2 },
            status: "pending",
            source: "ai",
          },
        ])
      );
      unwrap(
        await source.insert("items", [
          { id: "i1", description: "Box", material_cost: 1.37, labor_hours: 0.15 },
        ])
      );
      unwrap(await source.insert("assemblies", [{ id: "as1", name: "Duplex" }]));
      unwrap(await source.replaceAssemblyItems("as1", [component("ai1", "as1", "i1", 2)]));
      unwrap(
        await source.insert("direct_costs", [
          { id: "dc1", project_id: "p1", amount: 1250.5, ohp_applies: false },
        ])
      );
      unwrap(
        await source.insert("proposal_entries", [
          { id: "pe1", project_id: "p1", kind: "allowance", amount: 500 },
        ])
      );
      unwrap(
        await source.insert("bid_snapshots", [
          {
            id: "bs1",
            project_id: "p1",
            revision: 1,
            bid_price: 4321.0987,
            payload: { schema_version: 2, documents: [{ id: "d1", storage_path: PLAN_PATH }] },
          },
        ])
      );
      const bundle = unwrap(await source.exportBundle());
      const paths = bundle.files.map((file) => file.path);
      expect(paths).toEqual([PLAN_PATH]);
      const tables = Object.fromEntries(
        TABLES.map((table) => [table, bundle.snapshot.tables[table] ?? []])
      );
      validateBackupSnapshot({ ...bundle.snapshot, tables }, paths);

      // Through the real portable format, as a user's download would travel.
      const decoded = await decodeBackup(
        await encodeBackup({ snapshot: bundle.snapshot, files: [...bundle.files] })
      );
      const destination = await port();
      unwrap(await destination.restore(decoded));
      for (const table of TABLES) {
        expect(unwrap(await destination.select({ table })), table).toEqual(tables[table]);
      }
      const plan = unwrap(await destination.downloadFile(PLAN_PATH));
      expect(new Uint8Array(await plan.arrayBuffer())).toEqual(new Uint8Array(PLAN_BYTES));

      // A second restore of the same backup cannot duplicate anything.
      const again = await destination.restore(decoded);
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.error.code).toBe("occupied");
    });

    it("treats a workspace holding only catalog records as occupied", async () => {
      const store = await port();
      unwrap(await store.insert("items", [{ id: "i1", description: "Shared catalog item" }]));
      const result = await store.restore(sampleBackup());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("occupied");
      expect(unwrap(await store.select({ table: "projects" }))).toHaveLength(0);
      expect(ids(unwrap(await store.select({ table: "items" })))).toEqual(["i1"]);
    });

    it("rejects an orphaned record or an unsupported version before writing anything", async () => {
      const store = await port();
      const orphan = sampleBackup();
      orphan.snapshot.tables.layers = [{ id: "l9", project_id: "no-such-project", name: "Orphan" }];
      const unsupported = sampleBackup();
      (unsupported.snapshot as { schema_version: number }).schema_version = 2;
      for (const backup of [orphan, unsupported]) {
        const result = await store.restore(backup);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("invalid-input");
      }
      expect(unwrap(await store.select({ table: "projects" }))).toHaveLength(0);
      const plan = await store.downloadFile("p1/plans/e101.pdf");
      expect(plan.ok).toBe(false);
    });

    it("refuses a second maintenance job and releases the workspace after a job fails", async () => {
      const store = await port();
      const nested: string[] = [];
      const outer = await store.withExclusiveWorkspace(async () => {
        const inner = await store.withExclusiveWorkspace(async () => "second");
        nested.push(inner.ok ? "ran" : inner.error.code);
        return "first";
      });
      expect(outer).toEqual({ ok: true, value: "first" });
      expect(nested).toEqual(["occupied"]);
      const failed = await store.withExclusiveWorkspace(async () => {
        throw new Error("backup write failed");
      });
      expect(failed.ok).toBe(false);
      if (!failed.ok) expect(failed.error.code).toBe("io-failed");
      expect((await store.withExclusiveWorkspace(async () => "after")).ok).toBe(true);
    });
  });
}
