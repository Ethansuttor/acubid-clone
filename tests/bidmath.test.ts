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
import { bidPreflight } from "@/lib/preflight";
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
    ...summaryInputs,
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
      ...summaryInputs,
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
      laborBurdenPct: undefined as unknown as number,
      smallToolsPct: undefined as unknown as number,
      contingencyPct: undefined as unknown as number,
      escalationPct: undefined as unknown as number,
      bondPct: undefined as unknown as number,
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

// ---------------------------------------------------------------------------
// Bid-math gaps: labor burden, small tools, contingency, escalation, bond,
// and sales tax on taxable direct costs. Every expected value below was
// computed by hand BEFORE these tests were written (see each block's math).
// Base figures from the fixture: material 566.16, labor 13.528 hr.
// ---------------------------------------------------------------------------

function taxableCost(
  id: string,
  amount: number,
  ohp_applies: boolean,
  taxable: boolean
): DirectCost {
  return { ...cost(id, amount, ohp_applies), taxable };
}

describe("new commercial knobs at zero change nothing", () => {
  // The extended chain must be the identity extension of the old one:
  //   bid = 2280.82624 exactly as the original fixture hand math.
  const s = summarize({ ...totals, ...summaryInputs });

  it("bid price is the original fixture value", () => {
    expect(s.bidPrice).toBeCloseTo(2280.82624, 8);
  });
  it("all new lines are zero and bare labor equals labor", () => {
    expect(s.escalationAmount).toBe(0);
    expect(s.laborBurden).toBe(0);
    expect(s.smallTools).toBe(0);
    expect(s.directCostTax).toBe(0);
    expect(s.contingency).toBe(0);
    expect(s.bondAmount).toBe(0);
    expect(s.laborBareCost).toBe(s.laborCost);
    expect(s.preBondTotal).toBe(s.bidPrice);
  });
});

describe("each knob alone, against hand math", () => {
  it("escalation 3%: on material after waste, then taxed (tax 0 here)", () => {
    // 566.16 * 0.03 = 16.9848 -> materialTotal 583.1448
    // prime 583.1448 + 1285.16 = 1868.3048; oh 224.196576;
    // sub 2092.501376; profit 209.2501376; bid 2301.7515136
    const s = summarize({ ...totals, ...summaryInputs, escalationPct: 3 });
    expect(s.escalationAmount).toBeCloseTo(16.9848, 8);
    expect(s.materialTotal).toBeCloseTo(583.1448, 8);
    expect(s.bidPrice).toBeCloseTo(2301.7515136, 8);
  });

  it("labor burden 28%: its own line on bare labor cost", () => {
    // bare 1285.16; burden 359.8448; laborCost 1645.0048
    // prime 566.16 + 1645.0048 = 2211.1648; oh 265.339776;
    // sub 2476.504576; profit 247.6504576; bid 2724.1550336
    const s = summarize({ ...totals, ...summaryInputs, laborBurdenPct: 28 });
    expect(s.laborBareCost).toBeCloseTo(1285.16, 8);
    expect(s.laborBurden).toBeCloseTo(359.8448, 8);
    expect(s.laborCost).toBeCloseTo(1645.0048, 8);
    expect(s.bidPrice).toBeCloseTo(2724.1550336, 8);
  });

  it("small tools 2% of bare labor, carried in prime", () => {
    // st 25.7032; prime 1877.0232; oh 225.242784;
    // sub 2102.265984; profit 210.2265984; bid 2312.4925824
    const s = summarize({ ...totals, ...summaryInputs, smallToolsPct: 2 });
    expect(s.smallTools).toBeCloseTo(25.7032, 8);
    expect(s.bidPrice).toBeCloseTo(2312.4925824, 8);
  });

  it("contingency 5% of prime gets overhead and profit", () => {
    // prime 1851.32; cont 92.566; oh (1851.32+92.566)*0.12 = 233.26632;
    // sub 2177.15232; profit 217.715232; bid 2394.867552
    const s = summarize({ ...totals, ...summaryInputs, contingencyPct: 5 });
    expect(s.contingency).toBeCloseTo(92.566, 8);
    expect(s.overhead).toBeCloseTo(233.26632, 8);
    expect(s.bidPrice).toBeCloseTo(2394.867552, 8);
  });

  it("bond 1.5% of the FINAL price (circular): bid = preBond / 0.985", () => {
    // preBond 2280.82624; bid 2315.5596345178...; bond = bid - preBond
    const s = summarize({ ...totals, ...summaryInputs, bondPct: 1.5 });
    expect(s.preBondTotal).toBeCloseTo(2280.82624, 8);
    expect(s.bidPrice).toBeCloseTo(2315.55963452, 6);
    // the defining identity of the circular calc, to full precision:
    expect(s.bidPrice * (1 - 1.5 / 100)).toBeCloseTo(s.preBondTotal, 8);
    expect(s.bondAmount).toBeCloseTo(s.bidPrice * 0.015, 8);
  });

  it("taxable O&P quote: tax follows the quote into prime", () => {
    // tax 8.25%: material tax 46.7082 -> materialTotal 612.8682
    // quote 12000 + tax 990 in prime: 612.8682+1285.16+12990 = 14888.0282
    // oh 1786.563384; sub 16674.591584; profit 1667.4591584; bid 18342.0507424
    const s = summarize({
      ...totals,
      ...summaryInputs,
      taxPct: 8.25,
      directCosts: [taxableCost("gear", 12000, true, true)],
    });
    expect(s.directCostTaxWithOhp).toBeCloseTo(990, 8);
    expect(s.primeCost).toBeCloseTo(14888.0282, 8);
    expect(s.bidPrice).toBeCloseTo(18342.0507424, 8);
  });

  it("taxable at-cost item: tax added after profit, never marked up", () => {
    // material tax 46.7082 -> materialTotal 612.8682; prime 1898.0282
    // oh 227.763384; sub 2125.791584; profit 212.5791584
    // + 850 + tax 70.125 = bid 3258.4957424
    const s = summarize({
      ...totals,
      ...summaryInputs,
      taxPct: 8.25,
      directCosts: [taxableCost("permit", 850, false, true)],
    });
    expect(s.directCostTaxAtCost).toBeCloseTo(70.125, 8);
    expect(s.bidPrice).toBeCloseTo(3258.4957424, 8);
  });

  it("a non-taxable direct cost gets no tax line even when taxPct is set", () => {
    const s = summarize({
      ...totals,
      ...summaryInputs,
      taxPct: 8.25,
      directCosts: [cost("gear", 12000, true)],
    });
    expect(s.directCostTax).toBe(0);
  });
});

describe("the full stack, hand-calculated end to end", () => {
  // waste 5%          : 566.16 -> 594.468
  // escalation 3%     : + 17.83404 -> 612.30204
  // tax 8.25%         : + 50.5149183 -> materialTotal 662.8169583
  // hours +15%        : 15.5572 hr @ $95 -> bare 1477.934
  // burden 28%        : + 413.82152 -> laborCost 1891.75552
  // small tools 2%    : 29.55868
  // gear 12000 (O&P, taxable): + tax 990
  // prime             : 662.8169583+1891.75552+29.55868+12000+990 = 15574.1311583
  // contingency 5%    : 778.706557915
  // overhead 12%      : (prime+cont)*0.12 = 1962.3405259458
  // subtotal          : 18315.1782421608
  // profit 10%        : 1831.51782421608
  // permit 850 at cost: preBond 20996.69606637688
  // bond 1.5%         : bid = preBond/0.985 = 21316.44270698...
  const s = summarize({
    ...totals,
    laborRate: 95,
    wastePct: 5,
    taxPct: 8.25,
    laborFactorPct: 15,
    overheadPct: 12,
    profitPct: 10,
    laborBurdenPct: 28,
    smallToolsPct: 2,
    contingencyPct: 5,
    escalationPct: 3,
    bondPct: 1.5,
    directCosts: [
      taxableCost("switchgear", 12000, true, true),
      cost("permit", 850, false),
    ],
  });

  it("material chain: waste, then escalation, then tax", () => {
    expect(s.wasteAmount).toBeCloseTo(28.308, 8);
    expect(s.escalationAmount).toBeCloseTo(17.83404, 8);
    expect(s.salesTax).toBeCloseTo(50.5149183, 8);
    expect(s.materialTotal).toBeCloseTo(662.8169583, 8);
  });
  it("labor chain: factor, rate, burden", () => {
    expect(s.laborBareCost).toBeCloseTo(1477.934, 8);
    expect(s.laborBurden).toBeCloseTo(413.82152, 8);
    expect(s.laborCost).toBeCloseTo(1891.75552, 8);
    expect(s.smallTools).toBeCloseTo(29.55868, 8);
  });
  it("prime, contingency, overhead, profit", () => {
    expect(s.directCostTaxWithOhp).toBeCloseTo(990, 8);
    expect(s.primeCost).toBeCloseTo(15574.1311583, 8);
    expect(s.contingency).toBeCloseTo(778.706557915, 8);
    expect(s.overhead).toBeCloseTo(1962.3405259458, 8);
    expect(s.subtotal).toBeCloseTo(18315.1782421608, 8);
    expect(s.profit).toBeCloseTo(1831.51782421608, 8);
  });
  it("bond closes the circle", () => {
    expect(s.preBondTotal).toBeCloseTo(20996.69606637688, 8);
    expect(s.bidPrice).toBeCloseTo(21316.44270698, 6);
    expect(s.bidPrice * 0.985).toBeCloseTo(s.preBondTotal, 8);
  });
});

describe("bond >= 100% cannot produce a finite bid and preflight refuses it", () => {
  it("summarize reports Infinity rather than guessing a cap", () => {
    const s = summarize({ ...totals, ...summaryInputs, bondPct: 100 });
    expect(s.bidPrice).toBe(Number.POSITIVE_INFINITY);
  });

  it("preflight blocks on both the input and the total", () => {
    const project = {
      id: "p1",
      user_id: "u",
      name: "Bond overflow",
      labor_rate: 95,
      overhead_pct: 12,
      profit_pct: 10,
      waste_pct: 0,
      tax_pct: 0,
      labor_factor_pct: 0,
      labor_burden_pct: 0,
      small_tools_pct: 0,
      contingency_pct: 0,
      escalation_pct: 0,
      bond_pct: 100,
      created_at: "",
      updated_at: "",
    };
    const confirmed = takeoffs.filter((t) => t.status === "confirmed");
    const q = layerQuantities(layers, confirmed, [sheet]);
    const { lines: allLines, issues } = extendEstimate(q, items, assemblies, assemblyItems);
    const result = bidPreflight({
      project,
      sheets: [sheet],
      layers,
      takeoffs: confirmed,
      lines: allLines,
      issues,
      summary: summarize({ ...estimateTotals(allLines), ...summaryInputs, bondPct: 100 }),
      directCosts: [],
      pendingWrites: 0,
      saveState: "saved",
    });
    expect(result.ready).toBe(false);
    const ids = result.blockers.map((b) => b.id);
    expect(ids).toContain("invalid-commercial-input");
    expect(ids).toContain("invalid-total");
  });
});
