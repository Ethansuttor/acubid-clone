import { describe, expect, it } from "vitest";
import { decodeBackup, encodeBackup, validateBackupSnapshot } from "@/lib/backup";
import type { RecoverySnapshot } from "@/lib/recovery-folder";

function snapshot(): RecoverySnapshot {
  return { format: "voltline-recovery", schema_version: 1, exported_at: "2026-09-06T12:00:00Z", tables: {
    projects: [{ id: "p", name: "Bid", labor_rate: 95 }],
    documents: [{ id: "d", project_id: "p", storage_path: "plans/p.pdf" }],
    sheets: [{ id: "s", project_id: "p", document_id: "d" }],
    layers: [{ id: "l", project_id: "p" }],
    takeoffs: [{ id: "t", project_id: "p", sheet_id: "s", layer_id: "l", status: "pending", geometry: { points: [[1.25, 2.5]] } }],
    items: [], assemblies: [], assembly_items: [], direct_costs: [], proposal_entries: [], bid_snapshots: [],
  } };
}

describe("portable backup", () => {
  it("round-trips geometry, pending AI status, rates and exact plan bytes", async () => {
    const original = snapshot();
    const bytes = new Uint8Array([0, 255, 1, 128, 37, 80, 68, 70]);
    const backup = await encodeBackup({ snapshot: original, files: [{ path: "plans/p.pdf", blob: new Blob([bytes]) }] });
    const restored = await decodeBackup(backup);
    expect(restored.snapshot).toEqual(original);
    expect(new Uint8Array(await restored.files[0].blob.arrayBuffer())).toEqual(bytes);
  });
  it("rejects a modified payload before restore", async () => {
    const encoded = await encodeBackup({ snapshot: snapshot(), files: [{ path: "plans/p.pdf", blob: new Blob(["pdf"]) }] });
    const envelope = JSON.parse(await encoded.text());
    envelope.payload = envelope.payload.replace('"labor_rate":95', '"labor_rate":5');
    await expect(decodeBackup(new Blob([JSON.stringify(envelope)]))).rejects.toThrow("integrity check failed");
  });
  it("refuses an incomplete plan backup", async () => {
    await expect(encodeBackup({ snapshot: snapshot(), files: [] })).rejects.toThrow("missing a plan PDF");
  });
  it("rejects missing tables, duplicate IDs and orphaned records", () => {
    const value = snapshot();
    delete value.tables.items;
    expect(() => validateBackupSnapshot(value, ["plans/p.pdf"])).toThrow("missing the items");
    const duplicate = snapshot();
    duplicate.tables.takeoffs.push(duplicate.tables.takeoffs[0]);
    expect(() => validateBackupSnapshot(duplicate, ["plans/p.pdf"])).toThrow("duplicate record");
    const orphan = snapshot();
    orphan.tables.sheets[0].document_id = "missing";
    expect(() => validateBackupSnapshot(orphan, ["plans/p.pdf"])).toThrow("matching document");
  });
  it("rejects foreign formats and future schema versions", async () => {
    await expect(decodeBackup(new Blob(["hello"]))).rejects.toThrow("not valid backup JSON");
    await expect(decodeBackup(new Blob(['{"version":2}']))).rejects.toThrow("Choose a .voltline.json");
    const future = { ...snapshot(), schema_version: 2 };
    expect(() => validateBackupSnapshot(future, ["plans/p.pdf"])).toThrow("not a supported");
  });
});
