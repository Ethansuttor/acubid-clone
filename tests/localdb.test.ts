import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalClient } from "@/lib/localdb";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("local data client", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("surfaces corrupted table data instead of treating it as an empty table", async () => {
    localStorage.setItem("voltline.local.projects", "{not valid json");

    const result = await createLocalClient().from("projects").select("*");

    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({ message: expect.stringContaining("JSON") });
  });

  it("rejects valid JSON that is not a table array", async () => {
    localStorage.setItem("voltline.local.projects", JSON.stringify({ id: "p1" }));

    const result = await createLocalClient().from("projects").select("*");

    expect(result.data).toBeNull();
    expect(result.error).toEqual({ message: "Local projects data is corrupted." });
  });

  it("removes all project-owned rows and plan bytes when a project is deleted", async () => {
    const client = createLocalClient();
    const projectId = "project-delete";
    const documentId = "document-delete";
    const sheetId = "sheet-delete";
    const layerId = "layer-delete";
    const storagePath = "user/project-delete/plans.pdf";

    await client.from("projects").insert({ id: projectId, name: "Delete me" });
    await client.from("documents").insert({
      id: documentId,
      project_id: projectId,
      storage_path: storagePath,
    });
    await client.from("sheets").insert({
      id: sheetId,
      document_id: documentId,
      project_id: projectId,
    });
    await client.from("layers").insert({ id: layerId, project_id: projectId });
    await client.from("takeoffs").insert({
      id: "takeoff-delete",
      project_id: projectId,
      sheet_id: sheetId,
      layer_id: layerId,
    });
    await client.from("direct_costs").insert({ id: "cost-delete", project_id: projectId });
    await client.from("proposal_entries").insert({
      id: "scope-delete",
      project_id: projectId,
      kind: "inclusion",
    });
    await client.from("bid_snapshots").insert({
      id: "snapshot-delete",
      project_id: projectId,
    });
    localStorage.setItem(`voltline.local.file.${storagePath}`, "pdf-bytes");

    const deleted = await client.from("projects").delete().eq("id", projectId);
    expect(deleted.error).toBeNull();

    for (const table of [
      "projects",
      "documents",
      "sheets",
      "layers",
      "takeoffs",
      "direct_costs",
      "proposal_entries",
      "bid_snapshots",
    ]) {
      const result = await client.from(table).select("*");
      expect(result.error).toBeNull();
      expect(result.data, table).toEqual([]);
    }
    expect(localStorage.getItem(`voltline.local.file.${storagePath}`)).toBeNull();
  });

  it("can remove an uploaded plan during a failed-upload rollback", async () => {
    const plans = createLocalClient().storage.from("plans");
    const path = "user/orphaned-plan.pdf";

    expect((await plans.upload(path, new Uint8Array([1, 2, 3]))).error).toBeNull();
    expect(localStorage.getItem(`voltline.local.file.${path}`)).not.toBeNull();

    expect((await plans.remove([path])).error).toBeNull();
    expect(localStorage.getItem(`voltline.local.file.${path}`)).toBeNull();
  });
});
