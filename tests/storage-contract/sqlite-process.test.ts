// Cross-process behavior of the SQLite adapter: forced termination (SIGKILL)
// at chosen boundaries, the cross-process workspace lock, and concurrent
// writers in separate OS processes. A SIGKILL test shows that committed data
// survives process death and that an interrupted transaction is all-or-nothing.
// It is NOT proof of survival across power loss or a failing disk.

import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expect as unwrap } from "@/lib/platform/contracts";
import { sampleBackup } from "./port-contract";
import { countRows, inspect, openStore, startChild, tempDataDir } from "./sqlite-harness";

const LONG = 90_000;
const PER_BATCH = 25;

function batchCounts(dir: string): Map<string, number> {
  const rows = inspect(dir, (db) =>
    db.prepare("SELECT name, count(*) AS n FROM layers GROUP BY name").all()
  );
  return new Map(rows.map((row) => [String(row.name), Number(row.n)]));
}

describe("SQLite adapter — forced termination", () => {
  it(
    "keeps every acknowledged write after SIGKILL, and each batch is all-or-nothing",
    async () => {
      for (const acknowledgedBeforeKill of [1, 4, 9]) {
        const dir = tempDataDir("kill-acked");
        const child = startChild(["stream-inserts", dir, String(PER_BATCH)]);
        const last = await child.waitFor(`ACK ${acknowledgedBeforeKill}`);
        // Killed while it is (very likely) part-way through a later batch.
        await child.kill();
        const acked = Number(last.split(" ")[1]);

        const counts = batchCounts(dir);
        for (let batch = 1; batch <= acked; batch += 1) {
          expect(counts.get(`batch-${batch}`), `acknowledged batch ${batch}`).toBe(PER_BATCH);
        }
        for (const [name, n] of counts) expect(n, name).toBe(PER_BATCH); // never a partial batch
        // Every committed batch has exactly one journal record, and vice versa.
        expect(countRows(dir, "outbox")).toBe(1 + counts.size);

        const reopened = await openStore(dir);
        expect(unwrap(await reopened.verifyIntegrity())).toMatchObject({
          integrityCheck: ["ok"],
          foreignKeyViolations: 0,
        });
        const health = unwrap(await reopened.health());
        expect(health).toMatchObject({ readable: true, writable: true });
      }
    },
    LONG
  );

  it(
    "leaves nothing of a transaction that was killed just before COMMIT",
    async () => {
      const dir = tempDataDir("kill-in-tx");
      const child = startChild(["block-before-commit", dir, "2000"]);
      await child.waitFor("IN_TX");
      await child.kill();
      expect(countRows(dir, "layers")).toBe(0);
      expect(countRows(dir, "projects")).toBe(1);
      expect(countRows(dir, "outbox")).toBe(1); // only the earlier, acknowledged project insert
      const reopened = await openStore(dir);
      expect(unwrap(await reopened.select({ table: "layers" }))).toEqual([]);
      unwrap(await reopened.insert("layers", [{ id: "after", project_id: "p1", name: "usable after crash" }]));
    },
    LONG
  );

  it(
    "killed after publishing a plan file but before its reference commits: file kept, no reference",
    async () => {
      const dir = tempDataDir("kill-after-publish");
      const child = startChild(["block-after-publish", dir]);
      await child.waitFor("PUBLISHED");
      await child.kill();
      expect(countRows(dir, "plan_files")).toBe(0);
      const objects = readdirSync(path.join(dir, "plans", "objects"));
      expect(objects).toHaveLength(1);
      const reopened = await openStore(dir);
      const inventory = unwrap(await reopened.planFileInventory());
      expect(inventory.unreferencedObjects).toHaveLength(1);
      expect(inventory.missingObjects).toEqual([]);
      const missing = await reopened.downloadFile("p1/plans/e101.pdf");
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.error.code).toBe("not-found");
    },
    LONG
  );

  it(
    "killed while staging: an orphan staging file at most, never published or referenced",
    async () => {
      const dir = tempDataDir("kill-after-stage");
      const child = startChild(["block-after-stage", dir]);
      await child.waitFor("STAGED");
      await child.kill();
      expect(countRows(dir, "plan_files")).toBe(0);
      expect(readdirSync(path.join(dir, "plans", "objects"))).toEqual([]);
      const reopened = await openStore(dir);
      const inventory = unwrap(await reopened.planFileInventory());
      expect(inventory.stagingFiles).toHaveLength(1); // reported, not deleted by guesswork
      expect(inventory.unreferencedObjects).toEqual([]);
    },
    LONG
  );
});

describe("SQLite adapter — cross-process exclusive access", () => {
  it(
    "refuses maintenance, editing and restore while another process holds the workspace, and frees it when that process dies",
    async () => {
      const dir = tempDataDir("lock");
      const holder = startChild(["hold-lock", dir, "editing"]);
      await holder.waitFor("HELD");

      const store = await openStore(dir);
      const maintenance = await store.withExclusiveWorkspace(async () => "ran");
      expect(maintenance.ok).toBe(false);
      if (!maintenance.ok) expect(maintenance.error.code).toBe("occupied");
      const editing = store.acquireEditingLease();
      expect(editing.ok).toBe(false);
      if (!editing.ok) expect(editing.error.code).toBe("occupied");
      const restore = await store.restore(sampleBackup());
      expect(restore.ok).toBe(false);
      if (!restore.ok) expect(restore.error.code).toBe("occupied");
      expect(countRows(dir, "projects")).toBe(0); // the refused restore wrote nothing

      // Killing the holder releases the OS lock: no stale lock file to clean up.
      await holder.kill();
      const after = await store.withExclusiveWorkspace(async () => "ran");
      expect(after).toEqual({ ok: true, value: "ran" });
    },
    LONG
  );

  it(
    "a maintenance job in another process also excludes this one",
    async () => {
      const dir = tempDataDir("lock-maintenance");
      const holder = startChild(["hold-lock", dir, "maintenance"]);
      await holder.waitFor("HELD");
      const store = await openStore(dir);
      const lease = store.acquireEditingLease();
      expect(lease.ok).toBe(false);
      if (!lease.ok) expect(lease.error.code).toBe("occupied");
      await holder.kill();
      const released = store.acquireEditingLease();
      expect(released.ok).toBe(true);
      if (released.ok) released.value.release();
    },
    LONG
  );

  it("two stores in one process exclude each other too", async () => {
    const dir = tempDataDir("lock-same-process");
    const first = await openStore(dir);
    const second = await openStore(dir);
    const lease = unwrap(first.acquireEditingLease());
    const blocked = await second.withExclusiveWorkspace(async () => "ran");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe("occupied");
    lease.release();
    expect((await second.withExclusiveWorkspace(async () => "ran")).ok).toBe(true);
  });
});

describe("SQLite adapter — concurrent writers in separate processes", () => {
  it(
    "acknowledges every write from two processes and loses none",
    async () => {
      const dir = tempDataDir("two-writers");
      await openStore(dir);
      const a = startChild(["write-many", dir, "60", "a"]);
      const b = startChild(["write-many", dir, "60", "b"]);
      await Promise.all([a.waitFor("DONE"), b.waitFor("DONE")]);
      expect(countRows(dir, "items")).toBe(120);
      expect(countRows(dir, "outbox")).toBe(120);
    },
    LONG
  );

  it(
    "allocates distinct, gap-free bid revisions across processes",
    async () => {
      const dir = tempDataDir("revisions-across-processes");
      const store = await openStore(dir);
      unwrap(await store.insert("projects", [{ id: "p1", name: "One" }]));
      const a = startChild(["insert-snapshots", dir, "p1", "20", "a"]);
      const b = startChild(["insert-snapshots", dir, "p1", "20", "b"]);
      await Promise.all([a.waitFor("DONE"), b.waitFor("DONE")]);
      // Also from this process, while the others may still be finishing.
      for (let index = 0; index < 5; index += 1) {
        unwrap(await store.insert("bid_snapshots", [{ project_id: "p1", bid_price: 1, payload: { schema_version: 2 } }]));
      }
      const revisions = inspect(dir, (db) =>
        db.prepare("SELECT revision FROM bid_snapshots ORDER BY revision").all().map((row) => Number(row.revision))
      );
      expect(revisions).toEqual(Array.from({ length: 45 }, (_, index) => index + 1));
    },
    LONG
  );
});
