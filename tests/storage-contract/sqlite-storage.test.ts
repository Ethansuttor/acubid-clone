// The C1 contract suite run against the desktop SQLite adapter (track S2),
// each case in its own disposable data directory, plus the behavior that is
// specific to SQLite: pragmas, migrations, atomic failure, foreign keys,
// revision allocation, validation and reopen. Crash/lock/process cases are in
// sqlite-process.test.ts; plan-file cases in sqlite-plan-files.test.ts.

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { expect as unwrap } from "@/lib/platform/contracts";
import {
  APPLICATION_ID,
  DATABASE_FILE,
  MIGRATIONS,
  openSqliteWorkspaceStore,
  SCHEMA_VERSION,
  SQLITE_STORAGE_CAPABILITIES,
  type Migration,
} from "../../desktop/storage";
import { describeStoragePortContract } from "./port-contract";
import { countRows, inspect, openStore, tempDataDir } from "./sqlite-harness";

describeStoragePortContract("desktop SQLite adapter", () => openStore());

const byId = (id: string) => [{ kind: "eq" as const, column: "id", value: id }];
const PDF = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])]);

function failNextCommit(operation: string) {
  let armed = false;
  return {
    arm() {
      armed = true;
    },
    hooks: {
      beforeCommit(actual: string) {
        if (armed && actual === operation) {
          armed = false;
          throw new Error("injected failure before commit");
        }
      },
    },
  };
}

describe("SQLite adapter — open, pragmas and capabilities", () => {
  it("reports a desktop SQLite filesystem store with a cross-process lock", async () => {
    const store = await openStore();
    expect(store.capabilities).toBe(SQLITE_STORAGE_CAPABILITIES);
    expect(store.capabilities).toMatchObject({
      kind: "desktop",
      recordStore: "sqlite",
      fileStore: "filesystem",
      exclusiveWorkspaceLock: true,
    });
  });

  it("uses WAL, full synchronous writes and enforced foreign keys, and says so", async () => {
    const store = await openStore();
    const diagnostics = store.diagnostics();
    expect(diagnostics.journalMode).toBe("wal");
    expect(diagnostics.synchronous).toBe(2); // FULL
    expect(diagnostics.foreignKeys).toBe(true);
    expect(diagnostics.userVersion).toBe(SCHEMA_VERSION);
    expect(diagnostics.applicationId).toBe(APPLICATION_ID);
    expect(diagnostics.sqliteVersion).toMatch(/^3\.\d+\.\d+/);
  });

  it("keeps every file inside the caller-supplied directory and refuses a relative one", async () => {
    const dir = tempDataDir("layout");
    const store = await openStore(dir);
    unwrap(await store.insert("projects", [{ id: "p1", name: "One" }]));
    unwrap(await store.uploadFile("p1/plans/a.pdf", PDF));
    const names = readdirSync(dir).sort();
    expect(names).toContain(DATABASE_FILE);
    expect(names).toContain("plans");
    expect(names.filter((name) => !/^(voltline\.db(-wal|-shm)?|plans|workspace\.lock)$/.test(name))).toEqual(
      []
    );

    const relative = await openSqliteWorkspaceStore({ dataDir: "relative/workspace" });
    expect(relative.ok).toBe(false);
    if (!relative.ok) expect(relative.error.code).toBe("invalid-input");
    expect(existsSync(path.resolve("relative"))).toBe(false);
  });

  it("creates the indexes the workspace queries rely on", async () => {
    const dir = tempDataDir("indexes");
    await openStore(dir);
    const indexes = inspect(dir, (db) =>
      db
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND name NOT LIKE 'sqlite_%'")
        .all()
        .map((row) => String(row.name))
    );
    for (const expected of [
      "takeoffs_project",
      "takeoffs_sheet",
      "takeoffs_layer",
      "sheets_project",
      "layers_project",
      "documents_project",
      "assembly_items_assembly",
      "direct_costs_project",
      "proposal_entries_project",
    ]) {
      expect(indexes, expected).toContain(expected);
    }
  });

  it("refuses a file that is not a Voltline workspace, without modifying it", async () => {
    const dir = tempDataDir("foreign");
    const foreign = new DatabaseSync(path.join(dir, DATABASE_FILE));
    foreign.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT); INSERT INTO notes (body) VALUES ('mine')");
    foreign.close();
    const result = await openSqliteWorkspaceStore({ dataDir: dir });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("integrity");
    const notes = inspect(dir, (db) => db.prepare("SELECT body FROM notes").all());
    expect(notes).toEqual([{ body: "mine" }]);
    const tables = inspect(dir, (db) =>
      db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all().map((row) => row.name)
    );
    expect(tables).toEqual(["notes"]);
  });

  it("reports a damaged database file instead of opening an empty workspace", async () => {
    const dir = tempDataDir("garbage");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path.join(dir, DATABASE_FILE), Buffer.alloc(8192, 0x41));
    const result = await openSqliteWorkspaceStore({ dataDir: dir });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(["integrity", "io-failed"]).toContain(result.error.code);
  });
});

describe("SQLite adapter — migrations", () => {
  const V2: Migration = {
    version: SCHEMA_VERSION + 1,
    description: "test upgrade: add a column to items",
    sql: "ALTER TABLE items ADD COLUMN supplier TEXT;",
  };

  it("upgrades an existing workspace in place and keeps every record", async () => {
    const dir = tempDataDir("upgrade");
    const first = await openStore(dir);
    unwrap(await first.insert("items", [{ id: "i1", description: "Box", material_cost: 1.37 }]));
    await first.close();

    const upgraded = unwrap(
      await openSqliteWorkspaceStore({ dataDir: dir, migrations: [...MIGRATIONS, V2] })
    );
    expect(upgraded.diagnostics().userVersion).toBe(V2.version);
    const rows = unwrap(await upgraded.select({ table: "items" }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "i1", description: "Box", material_cost: 1.37 });
    await upgraded.close();
  });

  it("rolls a failing upgrade back whole and leaves the last good database openable", async () => {
    const dir = tempDataDir("upgrade-fails");
    const first = await openStore(dir);
    unwrap(await first.insert("items", [{ id: "i1", description: "Box" }]));
    await first.close();

    const broken: Migration = {
      version: SCHEMA_VERSION + 1,
      description: "test upgrade that fails half way",
      sql: "ALTER TABLE items ADD COLUMN supplier TEXT; ALTER TABLE no_such_table ADD COLUMN x TEXT;",
    };
    const failed = await openSqliteWorkspaceStore({ dataDir: dir, migrations: [...MIGRATIONS, broken] });
    expect(failed.ok).toBe(false);

    const columns = inspect(dir, (db) => db.prepare("PRAGMA table_info(items)").all().map((c) => c.name));
    expect(columns).not.toContain("supplier");
    expect(inspect(dir, (db) => Number(Object.values(db.prepare("PRAGMA user_version").get()!)[0]))).toBe(
      SCHEMA_VERSION
    );
    const reopened = await openStore(dir);
    expect(unwrap(await reopened.select({ table: "items" }))).toHaveLength(1);
  });

  it("refuses a workspace written by a newer version and does not change it", async () => {
    const dir = tempDataDir("newer");
    const first = await openStore(dir);
    unwrap(await first.insert("items", [{ id: "i1", description: "Box" }]));
    await first.close();
    const newer = unwrap(await openSqliteWorkspaceStore({ dataDir: dir, migrations: [...MIGRATIONS, V2] }));
    await newer.close();

    const before = statSync(path.join(dir, DATABASE_FILE)).mtimeMs;
    const result = await openSqliteWorkspaceStore({ dataDir: dir });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unavailable");
      expect(result.error.message).toMatch(/newer version/i);
    }
    expect(statSync(path.join(dir, DATABASE_FILE)).mtimeMs).toBe(before);
    expect(countRows(dir, "items")).toBe(1);
  });

  it("fails visibly when the schema on disk no longer matches the application", async () => {
    const dir = tempDataDir("tampered");
    const first = await openStore(dir);
    await first.close();
    const raw = new DatabaseSync(path.join(dir, DATABASE_FILE));
    raw.exec("DROP TABLE outbox");
    raw.close();
    const result = await openSqliteWorkspaceStore({ dataDir: dir });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("integrity");
  });

  it("is idempotent: reopening does not re-run migrations or change data", async () => {
    const dir = tempDataDir("reopen-idempotent");
    const first = await openStore(dir);
    unwrap(await first.insert("projects", [{ id: "p1", name: "One" }]));
    const outbox = first.diagnostics().outboxRows;
    await first.close();
    for (let round = 0; round < 3; round += 1) {
      const again = unwrap(await openSqliteWorkspaceStore({ dataDir: dir }));
      expect(unwrap(await again.select({ table: "projects" }))).toHaveLength(1);
      expect(again.diagnostics().outboxRows).toBe(outbox);
      await again.close();
    }
  });
});

describe("SQLite adapter — data survives closing and reopening", () => {
  it("returns identical rows, plan bytes and revision counters after reopen", async () => {
    const dir = tempDataDir("reopen");
    const first = await openStore(dir);
    unwrap(await first.insert("projects", [{ id: "p1", name: "One", labor_rate: 87.5 }]));
    unwrap(await first.uploadFile("p1/plans/a.pdf", PDF));
    unwrap(await first.insert("documents", [{ id: "d1", project_id: "p1", storage_path: "p1/plans/a.pdf" }]));
    unwrap(await first.insert("bid_snapshots", [{ project_id: "p1", bid_price: 10, payload: { schema_version: 2 } }]));
    const before = unwrap(await first.exportBundle());
    await first.close();

    const second = await openStore(dir);
    const after = unwrap(await second.exportBundle());
    expect(after.snapshot.tables).toEqual(before.snapshot.tables);
    expect(after.files.map((file) => file.path)).toEqual(["p1/plans/a.pdf"]);
    const plan = unwrap(await second.downloadFile("p1/plans/a.pdf"));
    expect(new Uint8Array(await plan.arrayBuffer())).toEqual(new Uint8Array(await PDF.arrayBuffer()));
    // The next allocated revision continues from what was committed.
    const [next] = unwrap(
      await second.insert("bid_snapshots", [{ project_id: "p1", bid_price: 11, payload: { schema_version: 2 } }])
    );
    expect(next.revision).toBe(2);
  });
});

describe("SQLite adapter — a failed write changes nothing", () => {
  it("rolls a multi-row insert back when a later row is invalid", async () => {
    const dir = tempDataDir("partial-insert");
    const store = await openStore(dir);
    unwrap(await store.insert("projects", [{ id: "p1", name: "One" }]));
    const outbox = store.diagnostics().outboxRows;
    const result = await store.insert("layers", [
      { id: "l1", project_id: "p1", name: "Fine", tool: "count" },
      { id: "l2", project_id: "p1", name: "Also fine", tool: "linear" },
      { id: "l3", project_id: "p1", name: "Bad tool", tool: "not-a-tool" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid-input");
    expect(unwrap(await store.select({ table: "layers" }))).toEqual([]);
    expect(store.diagnostics().outboxRows).toBe(outbox);
  });

  it("rolls every change and its journal record back when the commit itself fails", async () => {
    const dir = tempDataDir("commit-fails");
    const fault = failNextCommit("insert");
    const store = await openStore(dir, fault.hooks);
    unwrap(await store.insert("projects", [{ id: "p1", name: "One" }]));
    const outbox = store.diagnostics().outboxRows;

    fault.arm();
    const result = await store.insert("layers", [
      { id: "l1", project_id: "p1", name: "A" },
      { id: "l2", project_id: "p1", name: "B" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("io-failed");
    expect(countRows(dir, "layers")).toBe(0);
    expect(store.diagnostics().outboxRows).toBe(outbox);
    // The project's updated_at touch was part of the same transaction.
    const [project] = unwrap(await store.select({ table: "projects" }));
    expect(project.updated_at).toBe(project.created_at);

    // The failure is visible, and clears only once a later write commits.
    const health = unwrap(await store.health());
    expect(health.writable).toBe(false);
    expect(health.detail).toBeTruthy();
    unwrap(await store.insert("layers", [{ id: "l1", project_id: "p1", name: "A" }]));
    expect(unwrap(await store.health()).writable).toBe(true);
  });

  it("keeps every matched row unchanged when an update cannot be applied to all of them", async () => {
    const store = await openStore();
    unwrap(await store.insert("projects", [{ id: "p1", name: "One" }]));
    unwrap(
      await store.insert("layers", [
        { id: "a", project_id: "p1", name: "A", tool: "count" },
        { id: "b", project_id: "p1", name: "B", tool: "count" },
      ])
    );
    const result = await store.update("layers", { tool: "diagonal" }, [
      { kind: "eq", column: "project_id", value: "p1" },
    ]);
    expect(result.ok).toBe(false);
    expect(unwrap(await store.select({ table: "layers" })).map((row) => row.tool)).toEqual(["count", "count"]);
  });

  it("restores the whole tree when a delete is interrupted before commit", async () => {
    const dir = tempDataDir("delete-fails");
    const fault = failNextCommit("delete");
    const store = await openStore(dir, fault.hooks);
    unwrap(await store.insert("projects", [{ id: "p1", name: "One" }]));
    unwrap(await store.uploadFile("p1/plans/a.pdf", PDF));
    unwrap(await store.insert("documents", [{ id: "d1", project_id: "p1", storage_path: "p1/plans/a.pdf" }]));
    unwrap(await store.insert("sheets", [{ id: "s1", project_id: "p1", document_id: "d1", page_number: 1 }]));
    unwrap(await store.insert("layers", [{ id: "l1", project_id: "p1", name: "Recep", tool: "count" }]));
    unwrap(
      await store.insert("takeoffs", [
        { id: "t1", project_id: "p1", sheet_id: "s1", layer_id: "l1", kind: "count", geometry: { x: 1, y: 2 } },
      ])
    );
    fault.arm();
    expect((await store.remove("projects", byId("p1"))).ok).toBe(false);
    for (const table of ["projects", "documents", "sheets", "layers", "takeoffs"]) {
      expect(countRows(dir, table), table).toBe(1);
    }
    // The plan path was not retired by the rolled-back delete.
    expect(unwrap(await store.downloadFile("p1/plans/a.pdf")).size).toBe(PDF.size);
  });

  it("keeps the previously priced component list when the replacement fails at commit", async () => {
    const fault = failNextCommit("replace-assembly-items");
    const store = await openStore(undefined, fault.hooks);
    unwrap(await store.insert("items", [{ id: "i1", description: "Box" }, { id: "i2", description: "Device" }]));
    unwrap(await store.insert("assemblies", [{ id: "as1", name: "Duplex" }]));
    const original = [
      { id: "ai1", assembly_id: "as1", item_id: "i1", user_id: "u", quantity: 1 },
      { id: "ai2", assembly_id: "as1", item_id: "i2", user_id: "u", quantity: 2 },
    ];
    unwrap(await store.replaceAssemblyItems("as1", original));
    fault.arm();
    const result = await store.replaceAssemblyItems("as1", [
      { id: "ai9", assembly_id: "as1", item_id: "i1", user_id: "u", quantity: 9 },
    ]);
    expect(result.ok).toBe(false);
    const kept = unwrap(await store.select({ table: "assembly_items" }));
    expect(kept.map((row) => [row.id, row.quantity])).toEqual([["ai1", 1], ["ai2", 2]]);
  });

  it("leaves the destination empty and retryable when a restore fails at commit", async () => {
    const fault = failNextCommit("restore");
    const source = await openStore();
    unwrap(await source.insert("projects", [{ id: "p1", name: "One" }]));
    unwrap(await source.uploadFile("p1/plans/a.pdf", PDF));
    unwrap(await source.insert("documents", [{ id: "d1", project_id: "p1", storage_path: "p1/plans/a.pdf" }]));
    const bundle = unwrap(await source.exportBundle());

    const dir = tempDataDir("restore-fails");
    const destination = await openStore(dir, fault.hooks);
    fault.arm();
    const failed = await destination.restore({ snapshot: bundle.snapshot, files: [...bundle.files] });
    expect(failed.ok).toBe(false);
    for (const table of ["projects", "documents"]) expect(countRows(dir, table), table).toBe(0);
    expect(countRows(dir, "plan_files")).toBe(0);

    unwrap(await destination.restore({ snapshot: bundle.snapshot, files: [...bundle.files] }));
    expect(unwrap(await destination.select({ table: "projects" }))).toHaveLength(1);
    expect(unwrap(await destination.downloadFile("p1/plans/a.pdf")).size).toBe(PDF.size);
  });

  it("writes exactly one journal record per committed mutation, in the same transaction", async () => {
    const dir = tempDataDir("outbox");
    const store = await openStore(dir);
    unwrap(await store.insert("projects", [{ id: "p1", name: "One" }]));
    unwrap(await store.update("projects", { name: "Two" }, byId("p1")));
    unwrap(await store.remove("projects", byId("p1")));
    const journal = inspect(dir, (db) =>
      db.prepare("SELECT table_name, operation, synced_at FROM outbox ORDER BY seq").all()
    );
    expect(journal).toEqual([
      { table_name: "projects", operation: "insert", synced_at: null },
      { table_name: "projects", operation: "update", synced_at: null },
      { table_name: "projects", operation: "delete", synced_at: null },
    ]);
    // A read-only or failed operation adds nothing.
    await store.select({ table: "projects" });
    await store.insert("projects", [{ id: "dup" }, { id: "dup" }]);
    expect(countRows(dir, "outbox")).toBe(3);
  });
});

describe("SQLite adapter — relations, validation and mappings", () => {
  it("enforces foreign keys: a record cannot point at a parent that does not exist", async () => {
    const dir = tempDataDir("foreign-keys");
    const store = await openStore(dir);
    const orphan = await store.insert("layers", [{ id: "l1", project_id: "missing", name: "Orphan" }]);
    expect(orphan.ok).toBe(false);
    if (!orphan.ok) expect(orphan.error.code).toBe("invalid-input");
    expect(countRows(dir, "layers")).toBe(0);

    // The database itself refuses it too, not only the adapter's own checks.
    const raw = new DatabaseSync(path.join(dir, DATABASE_FILE));
    raw.exec("PRAGMA foreign_keys = ON");
    expect(() =>
      raw.exec("INSERT INTO layers (id, project_id, name) VALUES ('l2', 'missing', 'Orphan')")
    ).toThrow(/FOREIGN KEY/i);
    raw.close();
  });

  it("rejects values SQLite would silently change: NaN, Infinity, wrong types, lone surrogates", async () => {
    const dir = tempDataDir("validation");
    const store = await openStore(dir);
    const cases: [string, Record<string, unknown>][] = [
      ["projects", { id: "a", name: "n", labor_rate: Number.NaN }],
      ["projects", { id: "a", name: "n", labor_rate: Infinity }],
      ["projects", { id: "a", name: "n", labor_rate: "12" }],
      ["projects", { id: "a", name: "n", bond_pct: 100 }],
      ["projects", { id: "a", name: "bad \uD800 text" }],
      ["projects", { id: "a", name: 7 }],
      ["documents", { id: "a", project_id: "p", page_count: 1.5 }],
      ["layers", { id: "a", project_id: "p", typical_multiplier: 0 }],
      ["direct_costs", { id: "a", project_id: "p", ohp_applies: "yes" }],
      ["sheets", { id: "a", document_id: "d", project_id: "p", calibration: [1, 2] }],
      ["sheets", { id: "a", document_id: "d", project_id: "p", calibration: { x: Number.NaN } }],
      ["takeoffs", { id: "a", geometry: { x: () => 1 } }],
      ["items", { id: "a", description: "d", created_at: "not a date" }],
      ["items", { id: "", description: "no id" }],
      ["not_a_table", { id: "a" }],
    ];
    for (const [table, row] of cases) {
      const result = await store.insert(table, [row]);
      expect(result.ok, `${table} ${JSON.stringify(row)}`).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid-input");
    }
    for (const table of ["projects", "documents", "layers", "direct_costs", "sheets", "takeoffs", "items"]) {
      expect(countRows(dir, table), table).toBe(0);
    }
    expect(countRows(dir, "outbox")).toBe(0);
  });

  it("checks types in the database itself, independent of the adapter", async () => {
    const dir = tempDataDir("db-checks");
    await openStore(dir);
    const raw = new DatabaseSync(path.join(dir, DATABASE_FILE));
    for (const sql of [
      "INSERT INTO projects (id, labor_rate) VALUES ('a', 'twelve')",
      "INSERT INTO projects (id, bond_pct) VALUES ('a', 100)",
      "INSERT INTO layers (id, tool) VALUES ('a', 'diagonal')",
      "INSERT INTO direct_costs (id, ohp_applies) VALUES ('a', 2)",
      "INSERT INTO sheets (id, calibration) VALUES ('a', '{not json')",
      "INSERT INTO documents (id, page_count) VALUES ('a', 1.5)",
    ]) {
      expect(() => raw.exec(sql), sql).toThrow(/CHECK|constraint/i);
    }
    raw.close();
  });

  it("stores explicit column types: booleans as 0/1, geometry as JSON text, numbers as doubles", async () => {
    const dir = tempDataDir("mapping");
    const store = await openStore(dir);
    unwrap(await store.insert("projects", [{ id: "p1", name: "One", labor_rate: 0.1 + 0.2 }]));
    unwrap(await store.insert("direct_costs", [{ id: "dc1", project_id: "p1", ohp_applies: true, taxable: false }]));
    unwrap(await store.insert("layers", [{ id: "l1", project_id: "p1", tool: "linear" }]));
    unwrap(await store.uploadFile("p1/plans/a.pdf", PDF));
    unwrap(await store.insert("documents", [{ id: "d1", project_id: "p1", storage_path: "p1/plans/a.pdf" }]));
    unwrap(await store.insert("sheets", [{ id: "s1", project_id: "p1", document_id: "d1", page_number: 1 }]));
    unwrap(
      await store.insert("takeoffs", [
        { id: "t1", project_id: "p1", sheet_id: "s1", layer_id: "l1", kind: "linear", geometry: { points: [[1, 2.5]] } },
      ])
    );
    const stored = inspect(dir, (db) => ({
      cost: db.prepare("SELECT ohp_applies, taxable, typeof(ohp_applies) AS t FROM direct_costs").get(),
      rate: db.prepare("SELECT labor_rate, typeof(labor_rate) AS t FROM projects").get(),
      geometry: db.prepare("SELECT geometry, typeof(geometry) AS t FROM takeoffs").get(),
    }));
    expect(stored.cost).toEqual({ ohp_applies: 1, taxable: 0, t: "integer" });
    expect(stored.rate).toEqual({ labor_rate: 0.1 + 0.2, t: "real" });
    expect(stored.geometry).toEqual({ geometry: '{"points":[[1,2.5]]}', t: "text" });
  });

  it("answers filters on numbers, booleans and null exactly as strict equality does", async () => {
    const store = await openStore();
    unwrap(await store.insert("projects", [{ id: "p1", name: "One" }]));
    unwrap(
      await store.insert("direct_costs", [
        { id: "a", project_id: "p1", amount: 0, ohp_applies: true },
        { id: "b", project_id: "p1", amount: 12.5, ohp_applies: false },
        { id: "c", project_id: "p1", amount: null, ohp_applies: true },
      ])
    );
    const ids = async (column: string, value: unknown) =>
      unwrap(await store.select({ table: "direct_costs", filters: [{ kind: "eq", column, value }] })).map(
        (row) => row.id
      );
    expect(await ids("amount", 12.5)).toEqual(["b"]);
    expect(await ids("amount", 0)).toEqual(["a"]);
    expect(await ids("amount", null)).toEqual(["c"]);
    expect(await ids("ohp_applies", true)).toEqual(["a", "c"]);
    expect(await ids("taxable", null)).toEqual([]); // absent is not null
    expect(await ids("amount", "12.5")).toEqual([]); // no coercion
  });

  it("finds rows with a very large `in` list", async () => {
    const store = await openStore();
    const rows = Array.from({ length: 3000 }, (_, index) => ({ id: `i${index}`, description: `Item ${index}` }));
    unwrap(await store.insert("items", rows));
    const wanted = Array.from({ length: 10_000 }, (_, index) => `i${index * 2}`);
    const found = unwrap(await store.select({ table: "items", filters: [{ kind: "in", column: "id", values: wanted }] }));
    expect(found).toHaveLength(1500);
  });

  it("refuses to change a document's plan reference to bytes that were never stored", async () => {
    const store = await openStore();
    unwrap(await store.insert("projects", [{ id: "p1", name: "One" }]));
    unwrap(await store.uploadFile("p1/plans/a.pdf", PDF));
    unwrap(await store.insert("documents", [{ id: "d1", project_id: "p1", storage_path: "p1/plans/a.pdf" }]));
    const result = await store.update("documents", { storage_path: "p1/plans/never-uploaded.pdf" }, byId("d1"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid-input");
    expect(unwrap(await store.select({ table: "documents" }))[0].storage_path).toBe("p1/plans/a.pdf");
  });

  it("reports a closed store as unavailable rather than throwing", async () => {
    const store = await openStore();
    await store.close();
    const read = await store.select({ table: "projects" });
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error.code).toBe("unavailable");
    const health = unwrap(await store.health());
    expect(health.readable).toBe(false);
  });
});

describe("SQLite adapter — bid snapshot revisions", () => {
  const snapshot = (project: string, extra: Record<string, unknown> = {}) => ({
    project_id: project,
    bid_price: 100,
    payload: { schema_version: 2 },
    ...extra,
  });

  it("allocates the next revision per project when the caller does not choose one", async () => {
    const store = await openStore();
    unwrap(await store.insert("projects", [{ id: "p1", name: "One" }, { id: "p2", name: "Two" }]));
    const a1 = unwrap(await store.insert("bid_snapshots", [snapshot("p1")]));
    const a2 = unwrap(await store.insert("bid_snapshots", [snapshot("p1"), snapshot("p1")]));
    const b1 = unwrap(await store.insert("bid_snapshots", [snapshot("p2")]));
    expect([a1[0].revision, a2[0].revision, a2[1].revision, b1[0].revision]).toEqual([1, 2, 3, 1]);
  });

  it("continues after a caller-chosen revision and never reuses a deleted number's neighbours", async () => {
    const store = await openStore();
    unwrap(await store.insert("projects", [{ id: "p1", name: "One" }]));
    unwrap(await store.insert("bid_snapshots", [snapshot("p1", { revision: 5 })]));
    const [next] = unwrap(await store.insert("bid_snapshots", [snapshot("p1")]));
    expect(next.revision).toBe(6);
  });

  it("rejects a duplicate (project, revision) with conflict and writes nothing from that batch", async () => {
    const dir = tempDataDir("revision-unique");
    const store = await openStore(dir);
    unwrap(await store.insert("projects", [{ id: "p1", name: "One" }]));
    unwrap(await store.insert("bid_snapshots", [snapshot("p1", { id: "r1", revision: 1 })]));
    const result = await store.insert("bid_snapshots", [
      snapshot("p1", { id: "r2", revision: 2 }),
      snapshot("p1", { id: "r3", revision: 1 }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("conflict");
    expect(unwrap(await store.select({ table: "bid_snapshots" })).map((row) => row.id)).toEqual(["r1"]);

    // The constraint lives in the database, not only in the adapter.
    const raw = new DatabaseSync(path.join(dir, DATABASE_FILE));
    raw.exec("PRAGMA foreign_keys = ON");
    expect(() =>
      raw.exec("INSERT INTO bid_snapshots (id, project_id, revision) VALUES ('x', 'p1', 1)")
    ).toThrow(/UNIQUE/i);
    raw.close();
  });

  it("gives every concurrent creator a distinct, gap-free revision", async () => {
    const store = await openStore();
    unwrap(await store.insert("projects", [{ id: "p1", name: "One" }]));
    const results = await Promise.all(
      Array.from({ length: 30 }, () => store.insert("bid_snapshots", [snapshot("p1")]))
    );
    const revisions = results.map((result) => unwrap(result)[0].revision as number).sort((a, b) => a - b);
    expect(revisions).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
  });

  it("keeps issued revisions frozen: an update to a snapshot is refused and changes nothing", async () => {
    const store = await openStore();
    unwrap(await store.insert("projects", [{ id: "p1", name: "One" }]));
    unwrap(await store.insert("bid_snapshots", [snapshot("p1", { id: "r1", bid_price: 100 })]));
    const attempts = [
      await store.update("bid_snapshots", { bid_price: 1 }, byId("r1")),
      await store.upsert("bid_snapshots", [snapshot("p1", { id: "r1", bid_price: 2 })]),
    ];
    for (const attempt of attempts) {
      expect(attempt.ok).toBe(false);
      if (!attempt.ok) expect(attempt.error.code).toBe("conflict");
    }
    expect(unwrap(await store.select({ table: "bid_snapshots" }))[0].bid_price).toBe(100);
  });

  it("still removes snapshots with their project, as the browser store does", async () => {
    const store = await openStore();
    unwrap(await store.insert("projects", [{ id: "p1", name: "One" }]));
    unwrap(await store.insert("bid_snapshots", [snapshot("p1")]));
    unwrap(await store.remove("projects", byId("p1")));
    expect(unwrap(await store.select({ table: "bid_snapshots" }))).toEqual([]);
  });
});

describe("SQLite adapter — writes are row-level", () => {
  it("does not rewrite the workspace for a single edit", async () => {
    const dir = tempDataDir("row-level");
    const store = await openStore(dir);
    unwrap(await store.insert("projects", [{ id: "p1", name: "One" }]));
    unwrap(await store.insert("layers", [{ id: "l1", project_id: "p1", name: "L", tool: "linear" }]));
    unwrap(await store.uploadFile("p1/plans/a.pdf", PDF));
    unwrap(await store.insert("documents", [{ id: "d1", project_id: "p1", storage_path: "p1/plans/a.pdf" }]));
    unwrap(await store.insert("sheets", [{ id: "s1", project_id: "p1", document_id: "d1", page_number: 1 }]));
    const points = Array.from({ length: 40 }, (_, index) => [index * 1.5, index * 2.25]);
    const rows = Array.from({ length: 4000 }, (_, index) => ({
      id: `t${index}`,
      project_id: "p1",
      sheet_id: "s1",
      layer_id: "l1",
      kind: "linear",
      geometry: { points },
    }));
    for (let offset = 0; offset < rows.length; offset += 1000) {
      unwrap(await store.insert("takeoffs", rows.slice(offset, offset + 1000)));
    }
    const walFile = path.join(dir, `${DATABASE_FILE}-wal`);
    const dbBytes = statSync(path.join(dir, DATABASE_FILE)).size + (existsSync(walFile) ? statSync(walFile).size : 0);
    expect(dbBytes).toBeGreaterThan(2_000_000); // the workspace is large...

    const walBefore = existsSync(walFile) ? statSync(walFile).size : 0;
    unwrap(await store.update("takeoffs", { status: "confirmed" }, byId("t2000")));
    const walAfter = existsSync(walFile) ? statSync(walFile).size : 0;
    expect(walAfter - walBefore).toBeLessThan(256 * 1024); // ...and one edit touches a few pages
  });
});
