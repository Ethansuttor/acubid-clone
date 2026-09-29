// The C1 storage contract run against the real browser adapter — the actual
// IndexedDB code path, the real mutation journal, the real Web Locks
// workspace lock — rather than against a stub.
//
// Only two things are substituted, and neither is part of the adapter:
// IndexedDB itself (fake-indexeddb, an in-memory implementation of the same
// spec) and localStorage, which the legacy-migration path reads on first open.
// Web Locks are Node's own implementation, so `withWorkspaceClosed` and the
// per-mutation database lock run for real.

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { PlatformResult } from "@/lib/platform/contracts";
import { describeStoragePortContract } from "./port-contract";

const DB_NAME = "voltline-local-v1";

class MemoryStorage {
  private entries = new Map<string, string>();
  get length() {
    return this.entries.size;
  }
  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.entries.set(key, String(value));
  }
  removeItem(key: string): void {
    this.entries.delete(key);
  }
  clear(): void {
    this.entries.clear();
  }
}

const memoryStorage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", {
  value: memoryStorage,
  configurable: true,
});

function openRaw(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(DB_NAME, 1);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      // Must match the local client's own schema exactly, including the
      // journal's keyPath, or whichever connection opens first wins.
      for (const store of ["state", "files", "meta"]) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
      if (!db.objectStoreNames.contains("journal")) {
        db.createObjectStore("journal", { keyPath: "id" });
      }
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
}

/**
 * Empty every store rather than deleting the database: the local client keeps
 * its connections open, and a delete would block behind them.
 */
async function resetWorkspace(): Promise<void> {
  memoryStorage.clear();
  const db = await openRaw();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([...db.objectStoreNames], "readwrite");
    for (const name of db.objectStoreNames) tx.objectStore(name).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

const { createBrowserStorage } = await import("@/lib/platform/browser-storage");

describeStoragePortContract("browser IndexedDB adapter", async () => {
  await resetWorkspace();
  return createBrowserStorage();
});

describe("browser adapter against live IndexedDB", () => {
  beforeEach(async () => {
    await resetWorkspace();
  });

  it("reports IndexedDB and a working workspace lock as capabilities", () => {
    const store = createBrowserStorage();
    expect(store.capabilities.recordStore).toBe("indexeddb");
    expect(store.capabilities.exclusiveWorkspaceLock).toBe(true);
  });

  it("journals every committed mutation", async () => {
    const store = createBrowserStorage();
    const before = await journalSize();
    await store.insert("projects", [{ name: "Warehouse lighting" }]);
    await store.insert("layers", [{ project_id: "p1", name: "Receptacles" }]);
    expect(await journalSize()).toBe(before + 2);
  });

  it("refuses a second maintenance job while the workspace is held", async () => {
    const store = createBrowserStorage();
    const nested: PlatformResult<string>[] = [];
    const outer = await store.withExclusiveWorkspace(async () => {
      nested.push(await store.withExclusiveWorkspace(async () => "second"));
      return "first";
    });
    expect(outer.ok).toBe(true);
    expect(nested).toHaveLength(1);
    expect(nested[0].ok).toBe(false);
    if (!nested[0].ok) expect(nested[0].error.code).toBe("occupied");
  });

  it("keeps plan bytes byte-for-byte through a store and reload", async () => {
    const store = createBrowserStorage();
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    await store.uploadFile("p1/plans/e101.pdf", new Blob([bytes]));
    const reopened = createBrowserStorage();
    const result = await reopened.downloadFile("p1/plans/e101.pdf");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new Uint8Array(await result.value.arrayBuffer())).toEqual(bytes);
    }
  });

  it("survives a reopened adapter: committed rows are still there", async () => {
    await createBrowserStorage().insert("projects", [{ id: "p1", name: "Clinic fit-out" }]);
    const result = await createBrowserStorage().select({
      table: "projects",
      filters: [{ kind: "eq", column: "id", value: "p1" }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0].name).toBe("Clinic fit-out");
  });
});

async function journalSize(): Promise<number> {
  const db = await openRaw();
  const count = await new Promise<number>((resolve, reject) => {
    const request = db.transaction("journal", "readonly").objectStore("journal").count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return count;
}
