// The C1 contract suite run against the reference in-memory adapter, plus the
// failure cases that only a fault-injecting fake can exercise. When the SQLite
// adapter lands it calls describeStoragePortContract with its own factory.

import { describe, expect, it } from "vitest";
import { createFakeStorage } from "@/lib/platform/fake-storage";
import { expect as unwrap } from "@/lib/platform/contracts";
import { describeStoragePortContract, sampleBackup } from "./port-contract";

describeStoragePortContract("fake in-memory adapter", () => createFakeStorage());

describe("fake adapter fault injection", () => {
  it("keeps a failed save visible instead of reporting success", async () => {
    const store = createFakeStorage({ readOnly: true });
    const result = await store.insert("projects", [{ name: "Warehouse" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("io-failed");
    expect(store.tables().projects ?? []).toHaveLength(0);
    expect(unwrap(await store.health()).writable).toBe(false);
  });

  it("reports an unreadable store rather than an empty workspace", async () => {
    const store = createFakeStorage({ unreadable: true });
    const result = await store.select({ table: "projects" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("io-failed");
  });

  it("refuses maintenance and restore while another editor holds the workspace", async () => {
    const store = createFakeStorage({ occupied: true });
    const held = await store.withExclusiveWorkspace(async () => "done");
    expect(held.ok).toBe(false);
    if (!held.ok) expect(held.error.code).toBe("occupied");
    const restored = await store.restore(sampleBackup());
    expect(restored.ok).toBe(false);
    if (!restored.ok) expect(restored.error.code).toBe("occupied");
  });

  it("does not leave the workspace held after a maintenance job throws", async () => {
    const store = createFakeStorage();
    const failed = await store.withExclusiveWorkspace(async () => {
      throw new Error("backup write failed");
    });
    expect(failed.ok).toBe(false);
    const after = await store.withExclusiveWorkspace(async () => "done");
    expect(after.ok).toBe(true);
  });

  it("drops plan files when their document is deleted", async () => {
    const store = createFakeStorage();
    unwrap(await store.insert("projects", [{ id: "p1", name: "Warehouse" }]));
    unwrap(
      await store.insert("documents", [
        { id: "d1", project_id: "p1", storage_path: "p1/plans/e101.pdf" },
      ])
    );
    unwrap(await store.uploadFile("p1/plans/e101.pdf", new Blob([new Uint8Array([1])])));
    expect(store.fileCount()).toBe(1);
    unwrap(await store.remove("projects", [{ kind: "eq", column: "id", value: "p1" }]));
    expect(store.fileCount()).toBe(0);
  });
});
