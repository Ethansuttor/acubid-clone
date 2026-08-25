import { describe, it, expect } from "vitest";
import { parseDrawingScale, feetPerUnit } from "@/lib/sheetai/scale";
import { parseCsv, parseItemsCsv, parseAssembliesCsv, mergeAssemblies, mergeItems, toCsv, itemsToCsv } from "@/lib/csv";
import { summarize, extendEstimate, layerQuantities } from "@/lib/estimate";
import { items, assemblies, assemblyItems, layers, takeoffs, sheet, summaryInputs } from "./fixtures/fixture-project";

describe("scale probes", () => {
  const cases = [
    '1-1/2" = 1\'-0"',
    '1 1/2" = 1\'-0"',
    '3" = 1\'-0"',
    '1:100',
    '1:50',
    'SCALE 1:100',
    '1cm = 1m',
    '1 cm = 1 m',
    '1mm = 1m',
    'SCALE: 1/4"',
    'SCALE: 1/4" =',
    '1/8" = 1\'-0" AND 1/4" = 1\'-0"',
    '1/4" = 1\'-0" / 1/8" = 1\'-0"',
    'SCALE: 1/4" = 1\'-0" (PLAN), 1" = 20\' (SITE)',
    'DWG 1234 = 1\'',
    'REV 3 = 1\'',
    '1/0 " = 1\'-0"',
    '0/4" = 1\'-0"',
    '1/4" = 0\'-6"',
    '1/4" = 1\'-13"',
    '1" = 1\'-0" NTS',
    'HALF SIZE: 1/8" = 1\'-0"',
    'SCALE: AS SHOWN',
    'SCALE: 1/4"=1\'-0" UNLESS NOTED OTHERWISE',
    '12" = 1\'-0"',
    '1/4 = 1',
    '1/4" = 1',
    "1'-0\" = 1/4\"",
    'SCALE 1/4" = 1\'-0" @ 22x34',
    '1/4"=1\'',
    '2.5" = 1\'',
    'E1.01  1/4" = 1\'-0"',
    'PANEL 2 = 1\' SCHEDULE',
    '1/16" = 1\'-0"',
    '1"=200\'',
    '1"=2000\'',
    '1"=2001\'',
  ];
  it("dump", () => {
    for (const c of cases) {
      const r = parseDrawingScale(c);
      console.log(JSON.stringify(c), "->", r, r == null ? "" : `ft/unit=${feetPerUnit(r)}`);
    }
    expect(true).toBe(true);
  });
});

describe("csv probes", () => {
  it("unterminated quote", () => {
    const t = 'code,description,unit,material_cost,labor_hours\r\nA,"unclosed,EA,1,1\r\nB,Good,EA,2,2\r\n';
    console.log("parseCsv:", JSON.stringify(parseCsv(t)));
    console.log("items:", JSON.stringify(parseItemsCsv(t)));
  });
  it("short row", () => {
    const t = 'code,description,unit,material_cost,labor_hours\r\nA,Widget\r\n';
    console.log("short:", JSON.stringify(parseItemsCsv(t)));
  });
  it("extra columns / reordered / whitespace headers", () => {
    const t = 'Labor Hours,Material Cost,UNIT,Description,Code,notes\r\n0.5,1.25,EA,Thing,X1,hi\r\n';
    console.log("reorder:", JSON.stringify(parseItemsCsv(t)));
  });
  it("crlf in quoted field + escaped quotes", () => {
    const t = 'code,description,unit,material_cost,labor_hours\r\n"A","multi\r\nline ""q""",EA,1,1\r\n';
    console.log("quoted:", JSON.stringify(parseCsv(t)));
  });
  it("text after closing quote", () => {
    console.log('after-quote:', JSON.stringify(parseCsv('"a"b,c')));
  });
  it("semicolon delimited (euro excel)", () => {
    const t = 'code;description;unit;material_cost;labor_hours\r\nA;Thing;EA;1;1\r\n';
    console.log("semicolon:", JSON.stringify(parseItemsCsv(t)));
  });
  it("numbers with parens / percent / negatives / euro decimal", () => {
    for (const v of ["(5.00)", "1 000", "1,000", "$1,000.50", "1.5e3", "3,5", "abc", "", "-2"]) {
      const t = `code,description,unit,material_cost,labor_hours\r\nA,Thing,EA,${v.includes(",") ? '"'+v+'"' : v},1\r\n`;
      const r = parseItemsCsv(t);
      console.log(JSON.stringify(v), "->", JSON.stringify(r.rows[0]?.material_cost ?? null), r.errors);
    }
  });
  it("roundtrip preserves ids for existing codes", () => {
    const existing = items;
    const csv = itemsToCsv(existing);
    const parsed = parseItemsCsv(csv);
    const merged = mergeItems(existing, parsed.rows, "u");
    console.log("roundtrip errors", parsed.errors, "added", merged.added, "updated", merged.updated);
    console.log("ids preserved:", merged.upserts.every((u, i) => u.id === existing[i].id));
  });
  it("assembly import with unknown item code wipes components", () => {
    const csv = 'assembly_code,assembly_name,item_code,quantity\r\nA-REC,Duplex,DPLX-15,1\r\nA-REC,Duplex,NOPE-99,3\r\n';
    const parsed = parseAssembliesCsv(csv);
    const merged = mergeAssemblies(assemblies, parsed.rows, items, "u");
    console.log("errors:", merged.errors, "components:", merged.components.length);
  });
  it("assembly csv listing an existing assembly with no components", () => {
    const csv = 'assembly_code,assembly_name,item_code,quantity\r\nA-REC,Duplex,,\r\n';
    const parsed = parseAssembliesCsv(csv);
    const merged = mergeAssemblies(assemblies, parsed.rows, items, "u");
    console.log("no-comp errors:", merged.errors, "components:", merged.components.length, "asm id preserved:", merged.assemblies[0].id === assemblies[0].id);
  });
  it("negative / zero assembly quantity", () => {
    const csv = 'assembly_code,assembly_name,item_code,quantity\r\nA-REC,Duplex,DPLX-15,-5\r\n';
    const parsed = parseAssembliesCsv(csv);
    console.log("neg qty rows:", JSON.stringify(parsed.rows), parsed.errors);
  });
  it("duplicate assembly component rows", () => {
    const csv = 'assembly_code,assembly_name,item_code,quantity\r\nA-REC,Duplex,DPLX-15,1\r\nA-REC,Duplex,DPLX-15,1\r\n';
    const parsed = parseAssembliesCsv(csv);
    const merged = mergeAssemblies(assemblies, parsed.rows, items, "u");
    console.log("dupe components:", merged.components.length);
  });
  it("csv injection on export", () => {
    console.log(toCsv([["=1+1", "@SUM(A1)", "+cmd", "-2"]]));
  });
});

describe("summarize edge inputs", () => {
  const q = layerQuantities(layers, takeoffs, [sheet]);
  const { lines } = extendEstimate(q, items, assemblies, assemblyItems);
  const totals = { materialBase: 566.16, laborHoursBase: 13.528 };
  it("NaN percent", () => {
    const s = summarize({ ...totals, ...summaryInputs, wastePct: NaN });
    console.log("NaN waste -> bid", s.bidPrice);
  });
  it("null-ish percents from a pre-migration project row", () => {
    const s = summarize({ ...totals, ...summaryInputs, wastePct: undefined as unknown as number, taxPct: null as unknown as number });
    console.log("undefined waste, null tax -> bid", s.bidPrice, "matTotal", s.materialTotal);
  });
  it("negative profit / tax", () => {
    console.log("neg profit bid", summarize({ ...totals, ...summaryInputs, profitPct: -100 }).bidPrice);
    console.log("neg tax bid", summarize({ ...totals, ...summaryInputs, taxPct: -50 }).bidPrice);
    console.log("labor factor -200%", summarize({ ...totals, ...summaryInputs, laborFactorPct: -200 }).laborHoursTotal);
  });
  it("fraction instead of percent", () => {
    console.log("overhead 0.12 ->", summarize({ ...totals, ...summaryInputs, overheadPct: 0.12 }).bidPrice);
    console.log("overhead 12  ->", summarize({ ...totals, ...summaryInputs, overheadPct: 12 }).bidPrice);
  });
  it("NaN direct cost amount", () => {
    const dc = { id: "d", project_id: "p", user_id: "u", description: "x", category: "quote" as const, amount: NaN, ohp_applies: true, sort_order: 0 };
    console.log("NaN dc bid", summarize({ ...totals, ...summaryInputs, directCosts: [dc] }).bidPrice);
  });
  it("lines count", () => { console.log("lines", lines.length); });
});
