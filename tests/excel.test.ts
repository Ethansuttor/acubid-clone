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
  labor_burden_pct: summaryInputs.laborBurdenPct,
  small_tools_pct: summaryInputs.smallToolsPct,
  escalation_pct: summaryInputs.escalationPct,
  contingency_pct: summaryInputs.contingencyPct,
  bond_pct: summaryInputs.bondPct,
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

  it("summary sheet carries the new markups and the bond", () => {
    // Same hand math as tests/bidmath-markups.test.ts, driven through the export.
    const { wb: wb2, summary: s2 } = buildWorkbook({
      project: {
        ...project,
        waste_pct: 5,
        tax_pct: 8.25,
        labor_factor_pct: 15,
        labor_burden_pct: 32,
        small_tools_pct: 2,
        escalation_pct: 3,
        contingency_pct: 5,
        bond_pct: 1.2,
      },
      sheets: [sheet],
      layers,
      takeoffs,
      items,
      assemblies,
      assemblyItems,
      directCosts: [
        {
          id: "dc1",
          project_id: "p1",
          user_id: "u",
          description: "Switchgear quote",
          category: "quote",
          amount: 12000,
          ohp_applies: true,
          taxable: true,
          sort_order: 0,
        },
        {
          id: "dc2",
          project_id: "p1",
          user_id: "u",
          description: "Permit",
          category: "permit",
          amount: 850,
          ohp_applies: false,
          taxable: false,
          sort_order: 1,
        },
      ],
    });
    const rows: unknown[][] = [];
    wb2.getWorksheet("Summary")!.eachRow((r) => rows.push((r.values as unknown[]).slice(1)));
    const find = (label: string) => rows.find((r) => String(r[0]).startsWith(label))?.[1];
    expect(find("Escalation")).toBe(19.31);
    expect(find("Labor burden")).toBe(472.94);
    expect(find("Small tools")).toBe(29.56);
    expect(find("Labor total")).toBe(1980.43);
    expect(find("Tax on taxable direct costs, with O&P")).toBe(990);
    expect(find("Prime cost")).toBe(15633.25);
    expect(find("Contingency")).toBe(781.66);
    expect(find("Bond (1.2% of bid price)")).toBe(255.95);
    expect(find("BID PRICE")).toBe(21329.12);
    expect(s2.bidPrice).toBeCloseTo(21329.11971991182, 6);
    // the taxable flag is legible in the direct-cost detail rows
    expect(rows.some((r) => String(r[0]).includes("Switchgear quote [quote, taxable]"))).toBe(true);
    expect(rows.some((r) => String(r[0]).includes("Permit [permit, at cost]"))).toBe(true);
  });

  it("puts a refused bond rate at the top of the Summary sheet in red", () => {
    const { wb: wb3 } = buildWorkbook({
      project: { ...project, bond_pct: 150 },
      sheets: [sheet],
      layers,
      takeoffs,
      items,
      assemblies,
      assemblyItems,
    });
    const ws = wb3.getWorksheet("Summary")!;
    const rows: unknown[][] = [];
    ws.eachRow((r) => rows.push((r.values as unknown[]).slice(1)));
    expect(rows.some((r) => String(r[0]) === "!! CHECK THE BID INPUTS")).toBe(true);
    // find the styled row by its content rather than by index arithmetic
    let detailRow: import("exceljs").Row | undefined;
    ws.eachRow((r) => {
      if (String(r.getCell(1).value).includes("not a usable percentage")) detailRow = r;
    });
    expect(detailRow).toBeDefined();
    expect(detailRow!.font?.color?.argb).toBe("FFC00000");
    // and no bond was invented
    expect(rows.find((r) => String(r[0]).startsWith("Bond"))?.[1]).toBe(0);
    expect(rows.find((r) => String(r[0]).startsWith("BID PRICE"))?.[1]).toBe(2280.83);
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
});
