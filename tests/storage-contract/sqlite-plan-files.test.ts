// Plan PDF storage in the SQLite adapter: immutable content-addressed files,
// logical path mapping, stage -> verify -> publish before the reference, and
// no deletion by guesswork. Assertions are about outcomes on disk and through
// the port, not about statements.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { expect as unwrap } from "@/lib/platform/contracts";
import { PlanFileStore } from "../../desktop/storage/plan-files";
import { countRows, inspect, openStore, tempDataDir } from "./sqlite-harness";

const byId = (id: string) => [{ kind: "eq" as const, column: "id", value: id }];
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const blobOf = (bytes: Uint8Array) => new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
const objectFile = (dir: string, hash: string) => path.join(dir, "plans", "objects", hash.slice(0, 2), hash);
const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

function pdfBytes(seed: number, length = 4096): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) bytes[index] = (index * 31 + seed * 17) & 0xff;
  bytes.set([0x25, 0x50, 0x44, 0x46], 0);
  return bytes;
}

describe("SQLite plan files — layout and immutability", () => {
  it("stores bytes once, by content hash, and maps the logical path to them", async () => {
    const dir = tempDataDir("layout");
    const store = await openStore(dir);
    const bytes = pdfBytes(1);
    unwrap(await store.uploadFile("user/doc-a.pdf", blobOf(bytes)));
    unwrap(await store.uploadFile("user/doc-b.pdf", blobOf(bytes))); // same bytes, second name
    const hash = sha(bytes);
    expect(existsSync(objectFile(dir, hash))).toBe(true);
    expect(readdirSync(path.join(dir, "plans", "objects", hash.slice(0, 2)))).toEqual([hash]);
    const mapping = inspect(dir, (db) =>
      db.prepare("SELECT storage_path, sha256, size FROM plan_files ORDER BY storage_path").all()
    );
    expect(mapping).toEqual([
      { storage_path: "user/doc-a.pdf", sha256: hash, size: bytes.length },
      { storage_path: "user/doc-b.pdf", sha256: hash, size: bytes.length },
    ]);
    expect(await bytesOf(unwrap(await store.downloadFile("user/doc-b.pdf")))).toEqual(bytes);
  });

  it("never rebinds a path to different bytes, live or retired, and leaves the original intact", async () => {
    const dir = tempDataDir("rebind");
    const store = await openStore(dir);
    const original = pdfBytes(1);
    unwrap(await store.uploadFile("user/doc.pdf", blobOf(original)));
    const clash = await store.uploadFile("user/doc.pdf", blobOf(pdfBytes(2)));
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.error.code).toBe("conflict");
    expect(await bytesOf(unwrap(await store.downloadFile("user/doc.pdf")))).toEqual(original);

    unwrap(await store.removeFiles(["user/doc.pdf"]));
    const stillClash = await store.uploadFile("user/doc.pdf", blobOf(pdfBytes(3)));
    expect(stillClash.ok).toBe(false);
    // Re-uploading the same bytes revives the path.
    unwrap(await store.uploadFile("user/doc.pdf", blobOf(original)));
    expect(await bytesOf(unwrap(await store.downloadFile("user/doc.pdf")))).toEqual(original);
    // The database refuses a raw attempt to change the recorded hash as well.
    expect(() =>
      inspectWrite(dir, "UPDATE plan_files SET sha256 = '" + "0".repeat(64) + "' WHERE storage_path = 'user/doc.pdf'")
    ).toThrow(/plan-file-immutable/);
  });

  it("removing a path retires the mapping but never deletes bytes", async () => {
    const dir = tempDataDir("retire");
    const store = await openStore(dir);
    const bytes = pdfBytes(4);
    unwrap(await store.uploadFile("user/doc.pdf", blobOf(bytes)));
    unwrap(await store.removeFiles(["user/doc.pdf", "user/never-uploaded.pdf"]));
    const gone = await store.downloadFile("user/doc.pdf");
    expect(gone.ok).toBe(false);
    if (!gone.ok) expect(gone.error.code).toBe("not-found");
    expect(existsSync(objectFile(dir, sha(bytes)))).toBe(true);
    const row = inspect(dir, (db) => db.prepare("SELECT removed_at FROM plan_files").get());
    expect(typeof row?.removed_at).toBe("string");
  });

  it("refuses to retire a path that a document still uses", async () => {
    const dir = tempDataDir("in-use");
    const store = await openStore(dir);
    unwrap(await store.insert("projects", [{ id: "p1", name: "One" }]));
    unwrap(await store.uploadFile("user/doc.pdf", blobOf(pdfBytes(1))));
    unwrap(await store.insert("documents", [{ id: "d1", project_id: "p1", storage_path: "user/doc.pdf" }]));
    const result = await store.removeFiles(["user/doc.pdf"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("conflict");
    expect(unwrap(await store.downloadFile("user/doc.pdf")).size).toBe(4096);
    expect(countRows(dir, "documents")).toBe(1);
  });

  it("keeps hostile logical paths away from the file system", async () => {
    const dir = tempDataDir("hostile");
    const store = await openStore(dir);
    const escapes = ["../../evil.pdf", "/etc/passwd", "..\\..\\evil.pdf", "a/../../b.pdf", "C:\\Windows\\x.pdf", "name\u0000.pdf"];
    for (const [index, name] of escapes.entries()) {
      unwrap(await store.uploadFile(name, blobOf(pdfBytes(10 + index))));
      expect(await bytesOf(unwrap(await store.downloadFile(name)))).toEqual(pdfBytes(10 + index));
    }
    // Only the managed layout exists; nothing was written outside the data dir.
    const parent = path.dirname(dir);
    expect(existsSync(path.join(parent, "evil.pdf"))).toBe(false);
    expect(existsSync(path.join(dir, "evil.pdf"))).toBe(false);
    expect(readdirSync(path.join(dir, "plans")).sort()).toEqual(["objects", "staging"]);
    expect(readdirSync(path.join(dir, "plans", "staging"))).toEqual([]);
  });

  it("rejects malformed names and non-blob contents without writing anything", async () => {
    const dir = tempDataDir("bad-names");
    const store = await openStore(dir);
    for (const name of ["", "x".repeat(2000), "lone \uD800 surrogate.pdf"]) {
      const result = await store.uploadFile(name, blobOf(pdfBytes(1)));
      expect(result.ok, name.slice(0, 20)).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid-input");
    }
    const notBlob = await store.uploadFile("a.pdf", "text" as unknown as Blob);
    expect(notBlob.ok).toBe(false);
    expect(countRows(dir, "plan_files")).toBe(0);
    expect(await new PlanFileStore(path.join(dir, "plans")).listObjects()).toEqual([]);
  });

  it("stores an empty file and a multi-megabyte file byte for byte", async () => {
    const store = await openStore();
    const empty = new Uint8Array(0);
    const large = pdfBytes(7, 5 * 1024 * 1024 + 13);
    unwrap(await store.uploadFile("empty.pdf", blobOf(empty)));
    unwrap(await store.uploadFile("large.pdf", blobOf(large)));
    expect((await bytesOf(unwrap(await store.downloadFile("empty.pdf")))).length).toBe(0);
    expect(sha(await bytesOf(unwrap(await store.downloadFile("large.pdf"))))).toBe(sha(large));
  });
});

describe("SQLite plan files — file before reference", () => {
  it("has the verified bytes on disk before any reference exists, and the reference commits after", async () => {
    const dir = tempDataDir("ordering");
    const bytes = pdfBytes(1);
    const seen = { stagedFiles: [] as string[], objectAtPublish: false, mappedAtPublish: -1, stagingAtPublish: -1 };
    const store = await openStore(dir, {
      afterStage() {
        seen.stagedFiles = readdirSync(path.join(dir, "plans", "staging"));
        // Not yet published: no object and no reference.
        expect(existsSync(objectFile(dir, sha(bytes)))).toBe(false);
        expect(countRows(dir, "plan_files")).toBe(0);
      },
      afterPublish() {
        seen.objectAtPublish = existsSync(objectFile(dir, sha(bytes)));
        seen.mappedAtPublish = countRows(dir, "plan_files");
        seen.stagingAtPublish = readdirSync(path.join(dir, "plans", "staging")).length;
      },
    });
    unwrap(await store.uploadFile("user/doc.pdf", blobOf(bytes)));
    expect(seen.stagedFiles).toHaveLength(1);
    expect(seen.objectAtPublish).toBe(true); // bytes published first...
    expect(seen.mappedAtPublish).toBe(0); // ...reference not yet committed
    expect(seen.stagingAtPublish).toBe(0);
    expect(countRows(dir, "plan_files")).toBe(1); // ...and committed afterwards
  });

  it("a failure between publishing and committing leaves an unreferenced file, never a dangling reference", async () => {
    const dir = tempDataDir("orphan");
    const bytes = pdfBytes(1);
    let armed = true;
    const store = await openStore(dir, {
      afterPublish() {
        if (armed) {
          armed = false;
          throw new Error("power lost between publish and commit");
        }
      },
    });
    unwrap(await store.insert("projects", [{ id: "p1", name: "One" }]));
    const failed = await store.uploadFile("user/doc.pdf", blobOf(bytes));
    expect(failed.ok).toBe(false);
    expect(countRows(dir, "plan_files")).toBe(0);
    // A document cannot reference bytes that have no committed mapping.
    const dangling = await store.insert("documents", [{ id: "d1", project_id: "p1", storage_path: "user/doc.pdf" }]);
    expect(dangling.ok).toBe(false);
    if (!dangling.ok) expect(dangling.error.code).toBe("invalid-input");

    const inventory = unwrap(await store.planFileInventory());
    expect(inventory.unreferencedObjects).toEqual([sha(bytes)]);
    expect(inventory.missingObjects).toEqual([]);
    // Nothing deletes it by guesswork; a retry publishes into the same object.
    expect(existsSync(objectFile(dir, sha(bytes)))).toBe(true);
    unwrap(await store.uploadFile("user/doc.pdf", blobOf(bytes)));
    unwrap(await store.insert("documents", [{ id: "d1", project_id: "p1", storage_path: "user/doc.pdf" }]));
    expect(unwrap(await store.planFileInventory()).unreferencedObjects).toEqual([]);
  });

  it("a failure while staging leaves no reference and cleans its staging file", async () => {
    const dir = tempDataDir("stage-fails");
    let armed = true;
    const store = await openStore(dir, {
      afterStage() {
        if (armed) {
          armed = false;
          throw new Error("disk error while staging");
        }
      },
    });
    const failed = await store.uploadFile("user/doc.pdf", blobOf(pdfBytes(1)));
    expect(failed.ok).toBe(false);
    expect(countRows(dir, "plan_files")).toBe(0);
    expect(readdirSync(path.join(dir, "plans", "staging"))).toEqual([]);
    expect(unwrap(await store.planFileInventory()).unreferencedObjects).toEqual([]);
  });

  it("a document insert whose transaction fails leaves the file mapped but unreferenced, and reports it", async () => {
    const dir = tempDataDir("doc-fails");
    const store = await openStore(dir);
    unwrap(await store.uploadFile("user/doc.pdf", blobOf(pdfBytes(1))));
    const result = await store.insert("documents", [{ id: "d1", project_id: "no-such-project", storage_path: "user/doc.pdf" }]);
    expect(result.ok).toBe(false);
    expect(countRows(dir, "documents")).toBe(0);
    const inventory = unwrap(await store.planFileInventory());
    expect(inventory.objects).toHaveLength(1);
    expect(inventory.objects[0]).toMatchObject({ documentReferences: 0, snapshotReferences: 0 });
    expect(inventory.objects[0].livePaths).toEqual(["user/doc.pdf"]);
  });
});

describe("SQLite plan files — damage is detected, not served", () => {
  it("reports a checksum mismatch as integrity and never returns altered bytes", async () => {
    const dir = tempDataDir("tampered");
    const store = await openStore(dir);
    const bytes = pdfBytes(1);
    unwrap(await store.uploadFile("user/doc.pdf", blobOf(bytes)));
    const altered = Uint8Array.from(bytes);
    altered[100] ^= 0xff;
    writeFileSync(objectFile(dir, sha(bytes)), altered);
    const result = await store.downloadFile("user/doc.pdf");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("integrity");
    const exported = await store.exportBundle();
    expect(exported.ok).toBe(false); // a backup must not silently carry damaged bytes
    if (!exported.ok) expect(exported.error.code).toBe("integrity");
  });

  it("reports missing bytes as integrity and lists them in the integrity check", async () => {
    const dir = tempDataDir("missing");
    const store = await openStore(dir);
    const bytes = pdfBytes(1);
    unwrap(await store.uploadFile("user/doc.pdf", blobOf(bytes)));
    rmSync(objectFile(dir, sha(bytes)));
    const result = await store.downloadFile("user/doc.pdf");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("integrity");
    const report = unwrap(await store.verifyIntegrity());
    expect(report.missingObjects).toEqual([sha(bytes)]);
    expect(unwrap(await store.planFileInventory()).missingObjects).toEqual([sha(bytes)]);
  });

  it("repairs a damaged object when the same verified bytes are uploaded again", async () => {
    const dir = tempDataDir("repair");
    const store = await openStore(dir);
    const bytes = pdfBytes(1);
    unwrap(await store.uploadFile("user/doc.pdf", blobOf(bytes)));
    writeFileSync(objectFile(dir, sha(bytes)), new Uint8Array([1, 2, 3]));
    unwrap(await store.uploadFile("user/doc.pdf", blobOf(bytes)));
    expect(sha(readFileSync(objectFile(dir, sha(bytes))))).toBe(sha(bytes));
    expect(await bytesOf(unwrap(await store.downloadFile("user/doc.pdf")))).toEqual(bytes);
  });

  it("verifyIntegrity passes on a healthy workspace", async () => {
    const dir = tempDataDir("healthy");
    const store = await openStore(dir);
    unwrap(await store.insert("projects", [{ id: "p1", name: "One" }]));
    unwrap(await store.uploadFile("user/doc.pdf", blobOf(pdfBytes(1))));
    unwrap(await store.insert("documents", [{ id: "d1", project_id: "p1", storage_path: "user/doc.pdf" }]));
    expect(unwrap(await store.verifyIntegrity())).toEqual({
      integrityCheck: ["ok"],
      foreignKeyViolations: 0,
      missingObjects: [],
    });
  });
});

describe("SQLite plan files — frozen revisions and references", () => {
  async function issuedRevisionScenario() {
    const dir = tempDataDir("frozen");
    const store = await openStore(dir);
    const bytes = pdfBytes(1);
    unwrap(await store.insert("projects", [{ id: "p1", name: "One" }]));
    unwrap(await store.uploadFile("user/doc.pdf", blobOf(bytes)));
    unwrap(await store.insert("documents", [{ id: "d1", project_id: "p1", storage_path: "user/doc.pdf" }]));
    unwrap(
      await store.insert("bid_snapshots", [
        { id: "r1", project_id: "p1", revision: 1, payload: { schema_version: 2, documents: [{ id: "d1", storage_path: "user/doc.pdf" }] } },
      ])
    );
    return { dir, store, bytes };
  }

  it("keeps the bytes an issued revision refers to after the live document is deleted", async () => {
    const { dir, store, bytes } = await issuedRevisionScenario();
    unwrap(await store.remove("documents", byId("d1")));
    // The live path is gone, as in the browser store...
    expect((await store.downloadFile("user/doc.pdf")).ok).toBe(false);
    // ...but the bytes remain, and the inventory shows why.
    expect(existsSync(objectFile(dir, sha(bytes)))).toBe(true);
    const inventory = unwrap(await store.planFileInventory());
    expect(inventory.objects).toHaveLength(1);
    expect(inventory.objects[0]).toMatchObject({
      sha256: sha(bytes),
      documentReferences: 0,
      snapshotReferences: 1,
      livePaths: [],
      retiredPaths: ["user/doc.pdf"],
    });
  });

  it("carries a snapshot-referenced retired plan in exportBundle, and it restores", async () => {
    const { store, bytes } = await issuedRevisionScenario();
    unwrap(await store.remove("documents", byId("d1")));
    const bundle = unwrap(await store.exportBundle());
    expect(bundle.files.map((file) => file.path)).toEqual(["user/doc.pdf"]);
    expect(sha(await bytesOf(bundle.files[0].blob))).toBe(sha(bytes));
    const destination = await openStore();
    unwrap(await destination.restore({ snapshot: bundle.snapshot, files: [...bundle.files] }));
    const snapshots = unwrap(await destination.select({ table: "bid_snapshots" }));
    expect(snapshots).toHaveLength(1);
    // The restored workspace has the snapshot and can still read its plan bytes.
    expect(unwrap(await destination.planFileInventory()).objects[0]).toMatchObject({
      snapshotReferences: 1,
      livePaths: ["user/doc.pdf"],
    });
  });

  it("does not export a retired plan that no issued revision refers to", async () => {
    const dir = tempDataDir("unreferenced-retired");
    const store = await openStore(dir);
    unwrap(await store.insert("projects", [{ id: "p1", name: "One" }]));
    unwrap(await store.uploadFile("user/doc.pdf", blobOf(pdfBytes(1))));
    unwrap(await store.insert("documents", [{ id: "d1", project_id: "p1", storage_path: "user/doc.pdf" }]));
    unwrap(await store.remove("documents", byId("d1")));
    expect(unwrap(await store.exportBundle()).files).toEqual([]);
    // Bytes stay on disk until a reference-aware garbage collector (S3) decides.
    expect(readdirSync(path.join(dir, "plans", "objects")).length).toBe(1);
  });

  it("two documents on identical bytes share one object and both stay referenced", async () => {
    const dir = tempDataDir("shared");
    const store = await openStore(dir);
    const bytes = pdfBytes(1);
    unwrap(await store.insert("projects", [{ id: "p1", name: "One" }]));
    unwrap(await store.uploadFile("user/a.pdf", blobOf(bytes)));
    unwrap(await store.uploadFile("user/b.pdf", blobOf(bytes)));
    unwrap(
      await store.insert("documents", [
        { id: "d1", project_id: "p1", storage_path: "user/a.pdf" },
        { id: "d2", project_id: "p1", storage_path: "user/b.pdf" },
      ])
    );
    unwrap(await store.remove("documents", byId("d1")));
    expect(await bytesOf(unwrap(await store.downloadFile("user/b.pdf")))).toEqual(bytes);
    const inventory = unwrap(await store.planFileInventory());
    expect(inventory.objects).toHaveLength(1);
    expect(inventory.objects[0]).toMatchObject({ documentReferences: 1, livePaths: ["user/b.pdf"], retiredPaths: ["user/a.pdf"] });
  });

  it("reports staging leftovers from an interrupted upload without deleting them", async () => {
    const dir = tempDataDir("staging-leftover");
    const store = await openStore(dir);
    writeFileSync(path.join(dir, "plans", "staging", "interrupted.part"), "half a pdf");
    const inventory = unwrap(await store.planFileInventory());
    expect(inventory.stagingFiles).toEqual(["interrupted.part"]);
    expect(statSync(path.join(dir, "plans", "staging", "interrupted.part")).size).toBe(10);
  });
});

function inspectWrite(dir: string, sql: string): void {
  // A separate read/write connection, as anything outside the adapter would use.
  const db = new DatabaseSync(path.join(dir, "voltline.db"));
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}
