import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalClient, replaceLocalAssemblyItems } from "@/lib/localdb";

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
  it("preserves saved assembly components when a replacement is invalid", async () => {
    const client = createLocalClient();
    await client.from("assemblies").insert({ id: "a" });
    await client.from("items").insert({ id: "i" });
    const original = { id: "c", assembly_id: "a", item_id: "i", user_id: "u", quantity: 2 };
    expect((await replaceLocalAssemblyItems("a", [original])).error).toBeNull();
    expect((await replaceLocalAssemblyItems("a", [{ ...original, item_id: "missing" }])).error).not.toBeNull();
    expect((await client.from("assembly_items").select()).data).toEqual([original]);
    expect((await replaceLocalAssemblyItems("a", [{ ...original, quantity: 3 }])).error).toBeNull();
    expect((await client.from("assembly_items").select()).data).toEqual([{ ...original, quantity: 3 }]);
  });
  it("preserves concurrent writes to different tables and rows", async () => {
    const client = createLocalClient();
    const results = await Promise.all([
      client.from("projects").insert({ id: "p", name: "Bid" }),
      client.from("items").insert({ id: "i1", code: "A" }),
      client.from("items").insert({ id: "i2", code: "B" }),
    ]);
    expect(results.every(result => !result.error)).toBe(true);
    expect((await client.from("items").select()).data).toHaveLength(2);
    expect((await client.from("projects").select()).data).toHaveLength(1);
  });

  it("updates project recency when its bid data changes", async () => {
    const client = createLocalClient();
    await client.from("projects").insert({ id: "p", name: "Bid", updated_at: "2000-01-01T00:00:00Z" });
    await client.from("direct_costs").insert({ id: "cost", project_id: "p", amount: 125 });
    const result = await client.from("projects").select().single();
    expect(result.data).toMatchObject({ id: "p", updated_at: expect.not.stringContaining("2000-") });
  });
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("indexedDB", undefined);
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

  it("inserts rows and returns exactly one matching row with single", async () => {
    const client = createLocalClient();

    const inserted = await client
      .from("items")
      .insert({ id: "item-1", code: "A-100", description: "Junction box" })
      .select("*")
      .single();

    expect(inserted.error).toBeNull();
    expect(inserted.data).toMatchObject({
      id: "item-1",
      code: "A-100",
      description: "Junction box",
      created_at: expect.any(String),
      updated_at: expect.any(String),
    });

    const selected = await client.from("items").select("*").eq("id", "item-1").single();
    expect(selected).toEqual(inserted);

    const missing = await client.from("items").select("*").eq("id", "missing").single();
    expect(missing.data).toBeNull();
    expect(missing.error).toEqual({ message: "expected 1 row, got 0" });

    await client.from("items").insert({ id: "item-2", code: "A-200" });
    const multiple = await client.from("items").select("*").single();
    expect(multiple.data).toBeNull();
    expect(multiple.error).toEqual({ message: "expected 1 row, got 2" });
  });

  it("upserts existing rows by id and adds new ids", async () => {
    const client = createLocalClient();
    await client.from("items").insert({
      id: "item-existing",
      code: "OLD",
      description: "Original",
      unit: "EA",
    });

    const updated = await client
      .from("items")
      .upsert({ id: "item-existing", code: "NEW", description: "Updated" })
      .select("*")
      .single();
    const added = await client
      .from("items")
      .upsert({ id: "item-new", code: "ADD", description: "Added", unit: "FT" })
      .select("*")
      .single();

    expect(updated.error).toBeNull();
    expect(updated.data).toMatchObject({
      id: "item-existing",
      code: "NEW",
      description: "Updated",
    });
    expect(added.error).toBeNull();
    expect(added.data).toMatchObject({ id: "item-new", code: "ADD", unit: "FT" });

    const persisted = await client
      .from("items")
      .select("*")
      .eq("id", "item-existing")
      .single();
    expect(persisted.data).toMatchObject({
      id: "item-existing",
      code: "NEW",
      description: "Updated",
      unit: "EA",
    });

    const all = await client.from("items").select("*").order("code");
    expect(all.error).toBeNull();
    expect(all.data).toEqual([
      expect.objectContaining({ id: "item-new", code: "ADD" }),
      expect.objectContaining({ id: "item-existing", code: "NEW", unit: "EA" }),
    ]);
  });

  it("updates only rows matching chained equality filters", async () => {
    const client = createLocalClient();
    await client.from("direct_costs").insert([
      { id: "p1-permit", project_id: "p1", category: "permit", amount: 10 },
      { id: "p1-quote", project_id: "p1", category: "quote", amount: 20 },
      { id: "p2-permit", project_id: "p2", category: "permit", amount: 30 },
    ]);

    const result = await client
      .from("direct_costs")
      .update({ amount: 99 })
      .eq("project_id", "p1")
      .eq("category", "permit");
    expect(result).toEqual({ data: null, error: null });

    const rows = await client.from("direct_costs").select("*").order("id");
    expect(rows.data).toEqual([
      expect.objectContaining({ id: "p1-permit", amount: 99 }),
      expect.objectContaining({ id: "p1-quote", amount: 20 }),
      expect.objectContaining({ id: "p2-permit", amount: 30 }),
    ]);
  });

  it("deletes rows selected by an in filter and leaves other rows intact", async () => {
    const client = createLocalClient();
    await client.from("takeoffs").insert([
      { id: "takeoff-a", project_id: "p1" },
      { id: "takeoff-b", project_id: "p1" },
      { id: "takeoff-c", project_id: "p1" },
    ]);

    const result = await client
      .from("takeoffs")
      .delete()
      .in("id", ["takeoff-a", "takeoff-c"]);
    expect(result).toEqual({ data: null, error: null });

    const remaining = await client.from("takeoffs").select("*");
    expect(remaining.data).toEqual([expect.objectContaining({ id: "takeoff-b" })]);
  });

  it("orders selected rows in ascending and descending order", async () => {
    const client = createLocalClient();
    await client.from("items").insert([
      { id: "item-b", code: "B-200" },
      { id: "item-a", code: "A-100" },
      { id: "item-c", code: "C-300" },
    ]);

    const ascending = await client.from("items").select("*").order("code");
    const descending = await client
      .from("items")
      .select("*")
      .order("code", { ascending: false });

    expect((ascending.data as { id: string }[]).map((row) => row.id)).toEqual([
      "item-a",
      "item-b",
      "item-c",
    ]);
    expect((descending.data as { id: string }[]).map((row) => row.id)).toEqual([
      "item-c",
      "item-b",
      "item-a",
    ]);
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

  it("uploads, downloads, and removes plan bytes", async () => {
    const plans = createLocalClient().storage.from("plans");
    const path = "user/orphaned-plan.pdf";
    const bytes = new Uint8Array([1, 2, 3, 250]);

    expect(await plans.upload(path, bytes)).toEqual({ data: { path }, error: null });
    expect(localStorage.getItem(`voltline.local.file.${path}`)).not.toBeNull();

    const downloaded = await plans.download(path);
    expect(downloaded.error).toBeNull();
    expect(downloaded.data).toBeInstanceOf(Blob);
    expect(
      [...new Uint8Array(await (downloaded.data as Blob).arrayBuffer())]
    ).toEqual([...bytes]);

    expect(await plans.remove([path])).toEqual({ data: [{ name: path }], error: null });
    expect(localStorage.getItem(`voltline.local.file.${path}`)).toBeNull();

    expect(await plans.download(path)).toEqual({
      data: null,
      error: { message: "file not found" },
    });
  });
});
