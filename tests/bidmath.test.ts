// Bid-math completeness and the "never silently drop quantity" guarantee.
//
// Hand-calculated scenario (built on the fixture project's takeoff totals of
// $566.16 material / 13.528 labor hours):
//
//   waste 5%      = 566.16 x 0.05           =    28.308
//   after waste                             =   594.468
//   sales tax 8.25% on 594.468              =    49.04361
//   material total                          =   643.51161
//   labor factor +15% on 13.528 hr          =     2.0292 hr
//   labor hours total                       =    15.5572 hr
//   labor cost @ $95/hr                     =  1477.934
//   switchgear quote (O&P applies)          = 12000
//   permit (carried at cost)                =   850
//   prime = 643.51161 + 1477.934 + 12000    = 14121.44561
//   overhead 12%                            =  1694.5734732
//   subtotal                                = 15816.0190832
//   profit 10%                              =  1581.60190832
//   bid = subtotal + profit + 850           = 18247.62099152

import { describe, it, expect } from "vitest";
import {
  extendEstimate,
  estimateTotals,
  layerQuantities,
  summarize,
} from "@/lib/estimate";
import {
  items,
  assemblies,
  assemblyItems,
  layers,
  takeoffs,
  sheet,
  summaryInputs,
} from "./fixtures/fixture-project";
import type { DirectCost, Layer } from "@/lib/types";

const quantities = layerQuantities(layers, takeoffs, [sheet]);
const { lines } = extendEstimate(quantities, items, assemblies, assemblyItems);
const totals = estimateTotals(lines);

function cost(id: string, amount: number, ohp_applies: boolean): DirectCost {
  return {
    id,
    project_id: "p1",
    user_id: "u",
    description: id,
    category: "quote",
    amount,
    ohp_applies,
    sort_order: 0,
  };
}

describe("bid summary with waste, tax, labor factor and direct costs", () => {
  const s = summarize({
    ...totals,
    laborRate: 95,
    wastePct: 5,
    taxPct: 8.25,
    laborFactorPct: 15,
    overheadPct: 12,
    profitPct: 10,
    directCosts: [cost("switchgear", 12000, true), cost("permit", 850, false)],
  });

  it("waste is a percentage of extended material", () => {
    expect(s.wasteAmount).toBeCloseTo(28.308, 8);
    expect(s.materialAfterWaste).toBeCloseTo(594.468, 8);
  });

  it("sales tax applies to material after waste", () => {
    expect(s.salesTax).toBeCloseTo(49.04361, 8);
    expect(s.materialTotal).toBeCloseTo(643.51161, 8);
  });

  it("labor factor adjusts hours, not the rate", () => {
    expect(s.laborFactorHours).toBeCloseTo(2.0292, 8);
    expect(s.laborHoursTotal).toBeCloseTo(15.5572, 8);
    expect(s.laborCost).toBeCloseTo(1477.934, 8);
  });

  it("direct costs split by whether overhead and profit apply", () => {
    expect(s.directCostsWithOhp).toBe(12000);
    expect(s.directCostsAtCost).toBe(850);
  });

  it("O&P-applicable direct costs land inside prime cost", () => {
    expect(s.primeCost).toBeCloseTo(14121.44561, 8);
    expect(s.overhead).toBeCloseTo(1694.5734732, 7);
    expect(s.subtotal).toBeCloseTo(15816.0190832, 7);
    expect(s.profit).toBeCloseTo(1581.60190832, 7);
  });

  it("at-cost direct costs are added after profit, never marked up", () => {
    expect(s.bidPrice).toBeCloseTo(18247.62099152, 6);
    // proof they are not marked up: the same amount marked O&P-applies bids higher
    const marked = summarize({
      ...totals,
      laborRate: 95,
      wastePct: 5,
      taxPct: 8.25,
      laborFactorPct: 15,
      overheadPct: 12,
      profitPct: 10,
      directCosts: [cost("switchgear", 12000, true), cost("permit", 850, true)],
    });
    // 850 inside prime picks up 12% OH then 10% profit: 850 x 1.12 x 1.10 = 1047.20
    expect(marked.bidPrice - s.bidPrice).toBeCloseTo(850 * 1.12 * 1.1 - 850, 6);
  });

  it("zeroed markups reproduce the pure takeoff bid", () => {
    const plain = summarize({ ...totals, ...summaryInputs });
    expect(plain.materialTotal).toBeCloseTo(566.16, 8);
    expect(plain.laborHoursTotal).toBeCloseTo(13.528, 8);
    expect(plain.bidPrice).toBeCloseTo(2280.82624, 8);
  });

  it("a negative labor factor credits hours for favorable conditions", () => {
    const easy = summarize({ ...totals, ...summaryInputs, laborFactorPct: -10 });
    expect(easy.laborHoursTotal).toBeCloseTo(13.528 * 0.9, 8);
  });
});

describe("typical-area multiplier", () => {
  it("multiplies a layer's measured quantity", () => {
    const threeFloors = layers.map((l) =>
      l.id === "l-rec" ? { ...l, typical_multiplier: 3 } : l
    );
    const q = layerQuantities(threeFloors, takeoffs, [sheet]);
    const rec = q.find((x) => x.layer.id === "l-rec")!;
    expect(rec.rawQuantity).toBe(8); // still 8 objects measured
    expect(rec.objects).toBe(8);
    expect(rec.quantity).toBe(24); // 8 receptacles x 3 identical floors
  });

  it("flows through to extended cost", () => {
    const threeFloors = layers.map((l) =>
      l.id === "l-rec" ? { ...l, typical_multiplier: 3 } : l
    );
    const r = extendEstimate(
      layerQuantities(threeFloors, takeoffs, [sheet]),
      items,
      assemblies,
      assemblyItems
    );
    const dplx = r.lines.find((l) => l.item.id === "i-dplx")!;
    expect(dplx.itemQty).toBe(24);
    expect(dplx.materialCost).toBeCloseTo(24 * 2.85, 10);
  });

  it("treats a missing or invalid multiplier as 1", () => {
    const legacy = layers.map((l) =>
      l.id === "l-rec"
        ? ({ ...l, typical_multiplier: undefined } as unknown as Layer)
        : l
    );
    const q = layerQuantities(legacy, takeoffs, [sheet]);
    expect(q.find((x) => x.layer.id === "l-rec")!.quantity).toBe(8);
  });
});

describe("quantity is never silently dropped from a bid", () => {
  it("reports a layer whose linked item was deleted", () => {
    const withoutTroffer = items.filter((i) => i.id !== "i-led");
    const r = extendEstimate(quantities, withoutTroffer, assemblies, assemblyItems);
    expect(r.lines.some((l) => l.layerId === "l-led")).toBe(false);
    const issue = r.issues.find((i) => i.layerId === "l-led")!;
    expect(issue.kind).toBe("missing-item");
    expect(issue.quantity).toBe(4);
  });

  it("reports a layer linked to an assembly with no components", () => {
    const r = extendEstimate(quantities, items, assemblies, []);
    expect(r.lines.some((l) => l.layerId === "l-rec")).toBe(false);
    const issue = r.issues.find((i) => i.layerId === "l-rec")!;
    expect(issue.kind).toBe("empty-assembly");
    expect(issue.quantity).toBe(8);
  });

  it("reports a layer whose assembly no longer exists", () => {
    const r = extendEstimate(quantities, items, [], assemblyItems);
    const issue = r.issues.find((i) => i.layerId === "l-rec")!;
    expect(issue.kind).toBe("missing-assembly");
  });

  it("flags an assembly that is short a deleted component", () => {
    // The 1/2" EMT component item is gone: the receptacle lines still appear
    // but are short $32.64 of material. That under-extension must be reported.
    const withoutEmt = items.filter((i) => i.id !== "i-emt05");
    const r = extendEstimate(quantities, withoutEmt, assemblies, assemblyItems);
    const recLines = r.lines.filter((l) => l.layerId === "l-rec");
    expect(recLines).toHaveLength(5); // was 6
    const issue = r.issues.find((i) => i.kind === "missing-component")!;
    expect(issue.layerId).toBe("l-rec");
    expect(issue.detail).toContain("under-extended");
    const shortfall = estimateTotals(r.lines).materialBase;
    expect(totals.materialBase - shortfall).toBeCloseTo(32.64, 8);
  });

  it("layers with zero quantity raise no issue", () => {
    const empty = layerQuantities(layers, [], [sheet]);
    expect(extendEstimate(empty, items, assemblies, assemblyItems).issues).toEqual([]);
  });
});
