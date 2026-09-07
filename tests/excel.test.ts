// The Excel export must carry the exact same numbers as the estimate module.
// Builds the workbook from the hand-calculated fixture and inspects cells.

import { describe, it, expect } from "vitest";
import { buildWorkbook } from "@/lib/excel";
import {
  items,
  assemblies,
  assemblyItems,
  layers,
  takeoffs,
  sheet,
  summaryInputs,
} from "./fixtures/fixture-project";
import type { Project } from "@/lib/types";

const project: Project = {
  id: "p1",
  user_id: "u",
  name: "Fixture Project",
  labor_rate: summaryInputs.laborRate,
  overhead_pct: summaryInputs.overheadPct,
  profit_pct: summaryInputs.profitPct,
  waste_pct: summaryInputs.wastePct,
  tax_pct: summaryInputs.taxPct,
  labor_factor_pct: summaryInputs.laborFactorPct,
  labor_burden_pct: 0,
  small_tools_pct: 0,
  contingency_pct: 0,
  escalation_pct: 0,
  bond_pct: 0,
  created_at: "",
  updated_at: "",
};

const { wb, summary } = buildWorkbook({
  project,
  sheets: [sheet],
  layers,
  takeoffs,
  items,
  assemblies,
  assemblyItems,
});

function sheetValues(name: string): unknown[][] {
  const ws = wb.getWorksheet(name)!;
  const rows: unknown[][] = [];
  ws.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
  return rows;
}

describe("excel export", () => {
  it("has the four required sheets", () => {
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Takeoff", "Material", "Labor", "Summary"]);
  });

  it("takeoff sheet lists each layer with correct quantity", () => {
    const rows = sheetValues("Takeoff");
    const rec = rows.find((r) => r[0] === "Receptacles")!;
    expect(rec[3]).toBe(8); // objects
    expect(rec[4]).toBe(8); // measured
    expect(rec[5]).toBe(1); // typical multiplier
    expect(rec[6]).toBe(8); // extended quantity
    expect(rec[8]).toBe("[ASM] Duplex receptacle assembly");
    const emt = rows.find((r) => r[0] === "Feeder EMT")!;
    expect(emt[6]).toBe(60);
  });

  it("material sheet: W-12 rollup 264 FT @ .18 = 47.52 and total 566.16", () => {
    const rows = sheetValues("Material");
    const w12 = rows.find((r) => r[0] === "W-12")!;
    expect(w12[2]).toBe(264);
    expect(w12[5]).toBe(47.52);
    const total = rows.find((r) => r[1] === "MATERIAL TOTAL")!;
    expect(total[5]).toBe(566.16);
  });

  it("labor sheet total 13.53 hr (rounded for display)", () => {
    const rows = sheetValues("Labor");
    const total = rows.find((r) => r[1] === "LABOR HOURS TOTAL")!;
    expect(total[5]).toBe(13.53);
  });

  it("summary sheet carries the bid math", () => {
    const rows = sheetValues("Summary");
    const find = (label: string) => rows.find((r) => String(r[0]).startsWith(label))?.[1];
    expect(find("Material from takeoff")).toBe(566.16);
    expect(find("Material total")).toBe(566.16);
    expect(find("Labor cost")).toBe(1285.16);
    expect(find("Prime cost")).toBe(1851.32);
    expect(find("Overhead (12%)")).toBe(222.16);
    expect(find("Profit (10%)")).toBe(207.35);
    expect(find("BID PRICE")).toBe(2280.83);
    expect(summary.bidPrice).toBeCloseTo(2280.82624, 8);
  });

  it("omits the Breakdown sheet when no layer carries a tag", () => {
    expect(wb.worksheets.map((w) => w.name)).not.toContain("Breakdown");
  });
});

describe("excel breakdown sheet", () => {
  // Same tagging and hand-calculated shares as tests/breakdown.test.ts:
  //   Power 993.38624, Lighting 931.1456, Unassigned 356.2944 = 2280.82624.
  const SYSTEMS: Record<string, string> = {
    "l-led": "Lighting",
    "l-wire": "Lighting",
    "l-rec": "Power",
    "l-emt": "",
  };
  const built = buildWorkbook({
    project,
    sheets: [sheet],
    layers: layers.map((l) => ({ ...l, system: SYSTEMS[l.id] })),
    takeoffs,
    items,
    assemblies,
    assemblyItems,
  });
  const rows: unknown[][] = [];
  built.wb.getWorksheet("Breakdown")!.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));

  it("adds the sheet once a dimension is tagged, for the tagged dimension only", () => {
    expect(built.wb.worksheets.map((w) => w.name)).toEqual([
      "Takeoff",
      "Material",
      "Labor",
      "Breakdown",
      "Summary",
    ]);
    expect(rows.some((r) => r[0] === "BID BY SYSTEM")).toBe(true);
    // area and phase are untagged, so they would only say "Unassigned 100%".
    expect(rows.some((r) => r[0] === "BID BY AREA")).toBe(false);
    expect(rows.some((r) => r[0] === "BID BY PHASE")).toBe(false);
  });

  it("carries each system's share of the bid price and sums to the total", () => {
    const row = (label: string) => rows.find((r) => r[0] === label)!;
    expect(row("Power")[4]).toBe(993.39);
    expect(row("Lighting")[4]).toBe(931.15);
    expect(row("Unassigned")[4]).toBe(356.29);
    expect(row("BID PRICE")[4]).toBe(2280.83);
    // Material and labor come from the same chain as the Summary sheet.
    expect(row("Power")[1]).toBe(125.36);
    expect(row("Power")[3]).toBe(680.96);
    expect(row("Power")[5]).toBeCloseTo(43.55, 2);
  });

  it("never drops untagged scope from the export", () => {
    expect(rows.some((r) => r[0] === "Unassigned")).toBe(true);
  });
});
