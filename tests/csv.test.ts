// CSV round-trip and import strictness. A dropped row is a missing cost, so
// every unusable row must surface as an error rather than disappear.

import { describe, it, expect } from "vitest";
import {
  parseCsv,
  toCsv,
  itemsToCsv,
  parseItemsCsv,
  mergeItems,
  assembliesToCsv,
  parseAssembliesCsv,
  mergeAssemblies,
} from "@/lib/csv";
import { items, assemblies, assemblyItems } from "./fixtures/fixture-project";

describe("parseCsv", () => {
  it("handles quotes, embedded commas, escaped quotes and CRLF", () => {
    const text = 'a,b,c\r\n1,"x, y","he said ""hi"""\r\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ["1", "x, y", 'he said "hi"'],
    ]);
  });

  it("handles newlines inside quoted fields", () => {
    expect(parseCsv('a,b\n"line1\nline2",z')).toEqual([
      ["a", "b"],
      ["line1\nline2", "z"],
    ]);
  });

  it("strips a UTF-8 BOM so the first header still matches", () => {
    expect(parseCsv("﻿code,description")[0]).toEqual(["code", "description"]);
  });

  it("keeps empty trailing fields but drops a trailing blank line", () => {
    expect(parseCsv("a,b,\n")).toEqual([["a", "b", ""]]);
  });

  it("round-trips through toCsv", () => {
    const rows = [
      ["code", "desc"],
      ["A-1", 'quoted "thing", with comma'],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe("items CSV", () => {
  it("round-trips the fixture item database", () => {
    const parsed = parseItemsCsv(itemsToCsv(items));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(items.length);
    const dplx = parsed.rows.find((r) => r.code === "DPLX-15")!;
    expect(dplx.material_cost).toBe(2.85);
    expect(dplx.labor_hours).toBe(0.2);
    expect(dplx.unit).toBe("EA");
  });

  it("accepts $ and thousands separators in costs", () => {
    const csv = "code,description,unit,material_cost,labor_hours\nX,Panelboard,EA,\"$1,250.00\",6.5";
    const r = parseItemsCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.rows[0].material_cost).toBe(1250);
  });

  it("is tolerant of header case, spacing and column order", () => {
    const csv = "Labor Hours,Description,CODE,Unit,Material Cost\n0.5,Box,BX,EA,3.10";
    const r = parseItemsCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ code: "BX", description: "Box", labor_hours: 0.5, material_cost: 3.1 });
  });

  it("reports a missing required column instead of importing junk", () => {
    const r = parseItemsCsv("code,description\nA,B");
    expect(r.rows).toEqual([]);
    expect(r.errors[0]).toContain("material_cost");
  });

  it("reports bad numbers, blank descriptions, negatives and duplicate codes by line", () => {
    const csv = [
      "code,description,unit,material_cost,labor_hours",
      "A,Good,EA,1.00,0.1",
      "B,Bad cost,EA,abc,0.1",
      "C,,EA,1.00,0.1",
      "D,Negative,EA,-5,0.1",
      "A,Duplicate code,EA,2.00,0.2",
    ].join("\n");
    const r = parseItemsCsv(csv);
    expect(r.rows).toHaveLength(1); // only the good row
    expect(r.errors).toHaveLength(4);
    expect(r.errors[0]).toContain("Line 3");
    expect(r.errors[1]).toContain("Line 4");
    expect(r.errors[2]).toContain("Line 5");
    expect(r.errors[3]).toContain("Line 6");
  });

  it("skips fully blank rows without complaining", () => {
    const csv = "code,description,unit,material_cost,labor_hours\nA,Good,EA,1,0.1\n,,,,\n";
    expect(parseItemsCsv(csv).errors).toEqual([]);
  });
});

describe("mergeItems", () => {
  it("updates by code and adds unknown codes", () => {
    const imported = [
      { code: "DPLX-15", description: "Duplex receptacle 15A", unit: "EA", material_cost: 3.15, labor_hours: 0.22 },
      { code: "NEW-1", description: "New widget", unit: "EA", material_cost: 9.99, labor_hours: 1 },
    ];
    const { upserts, added, updated } = mergeItems(items, imported, "u");
    expect(updated).toBe(1);
    expect(added).toBe(1);
    // the update keeps the existing row id, so layers stay linked
    const dplx = upserts.find((u) => u.code === "DPLX-15")!;
    expect(dplx.id).toBe("i-dplx");
    expect(dplx.material_cost).toBe(3.15);
  });

  it("matches codes case-insensitively", () => {
    const { updated } = mergeItems(
      items,
      [{ code: "dplx-15", description: "x", unit: "EA", material_cost: 1, labor_hours: 1 }],
      "u"
    );
    expect(updated).toBe(1);
  });

  it("treats rows with no code as new items", () => {
    const { added } = mergeItems(
      items,
      [{ code: "", description: "Unnamed", unit: "EA", material_cost: 1, labor_hours: 1 }],
      "u"
    );
    expect(added).toBe(1);
  });
});

describe("assemblies CSV", () => {
  it("round-trips the fixture assembly with all six components", () => {
    const csv = assembliesToCsv(assemblies, assemblyItems, items);
    const parsed = parseAssembliesCsv(csv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(6);

    const merged = mergeAssemblies(assemblies, parsed.rows, items, "u");
    expect(merged.errors).toEqual([]);
    expect(merged.assemblies).toHaveLength(1);
    expect(merged.updated).toBe(1);
    expect(merged.components).toHaveLength(6);
    const emt = merged.components.find((c) => c.item_id === "i-emt05")!;
    expect(emt.quantity).toBe(6);
  });

  it("refuses to silently skip a component whose item code is unknown", () => {
    const csv = [
      "assembly_code,assembly_name,item_code,quantity",
      "A-NEW,New assembly,DPLX-15,1",
      "A-NEW,New assembly,NOPE-99,2",
    ].join("\n");
    const parsed = parseAssembliesCsv(csv);
    expect(parsed.errors).toEqual([]);
    const merged = mergeAssemblies(assemblies, parsed.rows, items, "u");
    expect(merged.components).toHaveLength(1);
    expect(merged.errors).toHaveLength(1);
    expect(merged.errors[0]).toContain("NOPE-99");
    expect(merged.added).toBe(1);
  });

  it("supports an assembly with no components yet", () => {
    const merged = mergeAssemblies(
      [],
      parseAssembliesCsv("assembly_code,assembly_name,item_code,quantity\nA-X,Empty,,").rows,
      items,
      "u"
    );
    expect(merged.assemblies).toHaveLength(1);
    expect(merged.components).toEqual([]);
    expect(merged.errors).toEqual([]);
  });

  it("requires an assembly code", () => {
    const r = parseAssembliesCsv("assembly_code,assembly_name,item_code,quantity\n,Nameless,DPLX-15,1");
    expect(r.rows).toEqual([]);
    expect(r.errors[0]).toContain("Line 2");
  });
});
