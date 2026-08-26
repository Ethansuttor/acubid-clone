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
  assemblyUsage,
  extendEstimate,
  estimateTotals,
  itemUsage,
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

  it("reports takeoff stranded on an uncalibrated sheet", () => {
    // Previously this contributed 0 and raised nothing, so 180 ft of conduit
    // could disappear from the Summary tab and the Excel export in silence.
    const uncal = { ...sheet, scale_ft_per_unit: null };
    const q = layerQuantities(layers, takeoffs, [uncal]);
    const r = extendEstimate(q, items, assemblies, assemblyItems);
    const stranded = r.issues.filter((i) => i.kind === "uncalibrated");
    expect(stranded.map((i) => i.layerId).sort()).toEqual(["l-emt", "l-wire"]);
    expect(stranded.every((i) => i.severity === "missing")).toBe(true);
    expect(stranded[0].detail).toContain("no scale");
    // counts are unaffected by calibration and still price normally
    expect(estimateTotals(r.lines).materialBase).toBeCloseTo(566.16 - 21.6 - 61.2, 8);
  });

  it("counts unmeasured objects separately from measured ones", () => {
    const uncal = { ...sheet, scale_ft_per_unit: null };
    const q = layerQuantities(layers, takeoffs, [uncal]);
    const wire = q.find((x) => x.layer.id === "l-wire")!;
    expect(wire.objects).toBe(0);
    expect(wire.unmeasured).toBe(1);
    expect(wire.needsCalibration).toBe(true);
  });
});

describe("unit sanity between a layer and its item", () => {
  it("warns when a count layer is priced per foot", () => {
    // 8 receptacles x $0.68/FT is arithmetically fine and commercially wrong
    const mislinked = layers.map((l) =>
      l.id === "l-rec" ? { ...l, assembly_id: null, item_id: "i-emt05" } : l
    );
    const r = extendEstimate(
      layerQuantities(mislinked, takeoffs, [sheet]),
      items,
      assemblies,
      assemblyItems
    );
    const warn = r.issues.find((i) => i.kind === "unit-mismatch")!;
    expect(warn.severity).toBe("warning");
    expect(warn.detail).toContain("measures EA");
    // it is a warning, not a removal: the line is still priced
    expect(r.lines.some((l) => l.layerId === "l-rec")).toBe(true);
  });

  it("accepts matching units and unfamiliar custom units without noise", () => {
    expect(
      extendEstimate(quantities, items, assemblies, assemblyItems).issues
    ).toEqual([]);
    const custom = items.map((i) =>
      i.id === "i-led" ? { ...i, unit: "CTN" } : i
    );
    const r = extendEstimate(quantities, custom, assemblies, assemblyItems);
    expect(r.issues).toEqual([]);
  });
});

describe("deleting from the database is warned, not silent", () => {
  it("reports the assemblies and layers an item is used by", () => {
    // The database cascades component rows away on delete, so nothing
    // downstream can detect the shortfall afterwards — hence the pre-check.
    const use = itemUsage("i-emt05", assemblies, assemblyItems, layers);
    expect(use.assemblies.map((a) => a.code)).toEqual(["A-REC"]);
    expect(use.layers).toEqual([]);

    const direct = itemUsage("i-led", assemblies, assemblyItems, layers);
    expect(direct.assemblies).toEqual([]);
    expect(direct.layers.map((l) => l.id)).toEqual(["l-led"]);
  });

  it("reports the layers an assembly prices", () => {
    expect(assemblyUsage("a-rec", layers).map((l) => l.id)).toEqual(["l-rec"]);
    expect(assemblyUsage("nope", layers)).toEqual([]);
  });
});

describe("summarize tolerates malformed inputs", () => {
  it("treats undefined percentages as zero instead of rendering NaN", () => {
    // A project row from a database predating the bid-math columns
    const legacy = summarize({
      ...totals,
      laborRate: 95,
      overheadPct: 12,
      profitPct: 10,
      wastePct: undefined as unknown as number,
      taxPct: undefined as unknown as number,
      laborFactorPct: undefined as unknown as number,
      directCosts: [],
    });
    expect(Number.isFinite(legacy.bidPrice)).toBe(true);
    expect(legacy.bidPrice).toBeCloseTo(2280.82624, 8);
  });

  it("ignores a non-numeric direct cost amount rather than poisoning the bid", () => {
    const s = summarize({
      ...totals,
      ...summaryInputs,
      directCosts: [cost("bad", "abc" as unknown as number, true)],
    });
    expect(Number.isFinite(s.bidPrice)).toBe(true);
    expect(s.directCostsWithOhp).toBe(0);
  });
});
