// Bid breakdown by area / system / phase, verified against the hand-calculated
// fixture project. Every expected figure below was computed by hand from
// tests/fixtures/fixture-project.ts before the assertions were written.
//
// Fixture extension, per layer:
//   l-rec   Receptacles   material 125.36   labor 7.168 hr
//   l-led   Troffers      material 358.00   labor 3.000 hr
//   l-wire  Ltg wire      material  21.60   labor 0.960 hr
//   l-emt   Feeder EMT    material  61.20   labor 2.400 hr
//                         --------------------------------
//                         total    566.16   total 13.528 hr
//
// Tagging used here: l-led + l-wire = "Lighting", l-rec = "Power",
// l-emt deliberately left untagged so it must appear under "Unassigned".
//
//   Lighting   material 358.00 + 21.60 = 379.60   labor 3.000 + 0.960 = 3.960
//   Power      material               125.36      labor               7.168
//   Unassigned material                61.20      labor               2.400
//
// At 95/hr, 12% overhead, 10% profit and no other markups:
//   Lighting   labor 3.960 x 95 = 376.20   prime 379.60 + 376.20 = 755.80
//              overhead 90.696   subtotal 846.496   profit 84.6496
//              bid 931.1456
//   Power      labor 7.168 x 95 = 680.96   prime 125.36 + 680.96 = 806.32
//              overhead 96.7584  subtotal 903.0784  profit 90.30784
//              bid 993.38624
//   Unassigned labor 2.400 x 95 = 228.00   prime  61.20 + 228.00 = 289.20
//              overhead 34.704   subtotal 323.904   profit 32.3904
//              bid 356.2944
//
//   931.1456 + 993.38624 + 356.2944 = 2280.82624 = the fixture's bid price.

import { describe, it, expect } from "vitest";
import {
  bidBreakdown,
  estimateTotals,
  extendEstimate,
  layerQuantities,
  summarize,
  DIRECT_COST_LABEL,
  UNASSIGNED_LABEL,
  type BreakdownDimension,
} from "@/lib/estimate";
import type { DirectCost, Layer } from "@/lib/types";
import {
  items,
  assemblies,
  assemblyItems,
  layers,
  takeoffs,
  sheet,
  summaryInputs,
} from "./fixtures/fixture-project";

/** Re-tag the fixture layers on one dimension without mutating the fixture. */
function tagged(dimension: BreakdownDimension, map: Record<string, string>): Layer[] {
  return layers.map((layer) => ({ ...layer, [dimension]: map[layer.id] }));
}

const quantities = layerQuantities(layers, takeoffs, [sheet]);
const { lines } = extendEstimate(quantities, items, assemblies, assemblyItems);
const totals = estimateTotals(lines);
const baseInput = { ...summaryInputs, ...totals };

const SYSTEMS = { "l-led": "Lighting", "l-wire": "Lighting", "l-rec": "Power", "l-emt": "" };

describe("bid breakdown by system", () => {
  const breakdown = bidBreakdown(lines, tagged("system", SYSTEMS), baseInput, "system");
  const group = (label: string) => breakdown.groups.find((g) => g.label === label)!;

  it("groups every layer, ordering tagged systems by value with Unassigned last", () => {
    expect(breakdown.groups.map((g) => g.label)).toEqual(["Power", "Lighting", UNASSIGNED_LABEL]);
  });

  it("sums material and labor into the right system", () => {
    expect(group("Lighting").materialBase).toBeCloseTo(379.6, 10);
    expect(group("Lighting").laborHoursBase).toBeCloseTo(3.96, 10);
    expect(group("Power").materialBase).toBeCloseTo(125.36, 10);
    expect(group("Power").laborHoursBase).toBeCloseTo(7.168, 10);
    expect(group(UNASSIGNED_LABEL).materialBase).toBeCloseTo(61.2, 10);
    expect(group(UNASSIGNED_LABEL).laborHoursBase).toBeCloseTo(2.4, 10);
  });

  it("carries each system all the way to its share of the bid price", () => {
    expect(group("Lighting").bidPrice).toBeCloseTo(931.1456, 8);
    expect(group("Power").bidPrice).toBeCloseTo(993.38624, 8);
    expect(group(UNASSIGNED_LABEL).bidPrice).toBeCloseTo(356.2944, 8);
    // Intermediate steps are the same chain, not a pro-rata smear.
    expect(group("Power").laborCost).toBeCloseTo(680.96, 8);
    expect(group("Power").primeCost).toBeCloseTo(806.32, 8);
    expect(group("Power").overhead).toBeCloseTo(96.7584, 8);
    expect(group("Power").profit).toBeCloseTo(90.30784, 8);
  });

  it("reconciles exactly to the whole bid", () => {
    expect(breakdown.bidPrice).toBeCloseTo(2280.82624, 8);
    expect(breakdown.allocated).toBeCloseTo(2280.82624, 8);
    expect(breakdown.reconciliationError).toBeCloseTo(0, 8);
    expect(breakdown.reconciles).toBe(true);
  });

  it("reports each share as a percentage of the bid", () => {
    expect(group("Power").pctOfBid).toBeCloseTo((993.38624 / 2280.82624) * 100, 8);
    const sum = breakdown.groups.reduce((t, g) => t + g.pctOfBid, 0);
    expect(sum).toBeCloseTo(100, 8);
  });

  it("counts the lines and layers behind each group", () => {
    // The receptacle assembly expands to 6 component lines from 1 layer.
    expect(group("Power")).toMatchObject({ lineCount: 6, layerCount: 1 });
    expect(group("Lighting")).toMatchObject({ lineCount: 2, layerCount: 2 });
  });
});

describe("untagged quantity is reported, never dropped or spread", () => {
  it("puts untagged layers under Unassigned rather than into a tagged system", () => {
    const breakdown = bidBreakdown(lines, tagged("system", SYSTEMS), baseInput, "system");
    const unassigned = breakdown.groups.find((g) => g.label === UNASSIGNED_LABEL)!;
    expect(unassigned.materialBase).toBeCloseTo(61.2, 10);
    // The tagged systems must not have absorbed it.
    const taggedMaterial = breakdown.groups
      .filter((g) => g.key !== "")
      .reduce((t, g) => t + g.materialBase, 0);
    expect(taggedMaterial).toBeCloseTo(566.16 - 61.2, 10);
  });

  it("treats a whitespace-only tag as unassigned", () => {
    const breakdown = bidBreakdown(
      lines,
      tagged("system", { ...SYSTEMS, "l-emt": "   " }),
      baseInput,
      "system"
    );
    expect(breakdown.groups.map((g) => g.label)).toContain(UNASSIGNED_LABEL);
    expect(breakdown.groups.find((g) => g.label === UNASSIGNED_LABEL)!.materialBase).toBeCloseTo(
      61.2,
      10
    );
  });

  it("puts everything under Unassigned when no layer is tagged", () => {
    const breakdown = bidBreakdown(lines, layers, baseInput, "system");
    expect(breakdown.groups).toHaveLength(1);
    expect(breakdown.groups[0].label).toBe(UNASSIGNED_LABEL);
    expect(breakdown.groups[0].bidPrice).toBeCloseTo(2280.82624, 8);
    expect(breakdown.reconciles).toBe(true);
  });
});

describe("direct costs are their own group", () => {
  // Gear quote 10,000 with O&P; permit 500 at cost. No tax in the baseline.
  //   prime 10,000  overhead 1,200  subtotal 11,200  profit 1,120
  //   preBond 11,200 + 1,120 + 500 = 12,820  ->  bid 12,820
  const directCosts: DirectCost[] = [
    {
      id: "dc1",
      project_id: "p1",
      user_id: "u",
      description: "Switchgear quote",
      category: "quote",
      amount: 10000,
      ohp_applies: true,
      sort_order: 0,
    },
    {
      id: "dc2",
      project_id: "p1",
      user_id: "u",
      description: "Permit",
      category: "permit",
      amount: 500,
      ohp_applies: false,
      sort_order: 1,
    },
  ];
  const input = { ...baseInput, directCosts };
  const breakdown = bidBreakdown(lines, tagged("system", SYSTEMS), input, "system");

  it("never attributes a project-level cost to a takeoff system", () => {
    expect(breakdown.groups.map((g) => g.label)).toEqual([
      "Power",
      "Lighting",
      UNASSIGNED_LABEL,
      DIRECT_COST_LABEL,
    ]);
    const dc = breakdown.groups.find((g) => g.kind === "direct-costs")!;
    expect(dc.bidPrice).toBeCloseTo(12820, 8);
    expect(dc.materialBase).toBe(0);
    expect(dc.laborHoursBase).toBe(0);
    // The takeoff groups are unchanged by the presence of direct costs.
    expect(breakdown.groups.find((g) => g.label === "Power")!.bidPrice).toBeCloseTo(993.38624, 8);
  });

  it("still reconciles once direct costs are included", () => {
    expect(breakdown.bidPrice).toBeCloseTo(2280.82624 + 12820, 8);
    expect(breakdown.reconciles).toBe(true);
    expect(breakdown.reconciliationError).toBeCloseTo(0, 8);
  });

  it("omits the group when there are no direct costs", () => {
    const none = bidBreakdown(lines, tagged("system", SYSTEMS), baseInput, "system");
    expect(none.groups.some((g) => g.kind === "direct-costs")).toBe(false);
  });
});

describe("reconciliation under every markup, on all three dimensions", () => {
  // The property that matters: whatever the commercial inputs, the parts must
  // sum to the whole. A pro-rata allocation would fail this the moment a
  // percentage compounds.
  const loaded = {
    ...baseInput,
    laborRate: 118.75,
    wastePct: 7.5,
    taxPct: 8.25,
    laborFactorPct: 15,
    overheadPct: 14,
    profitPct: 9.5,
    laborBurdenPct: 32,
    smallToolsPct: 2.5,
    contingencyPct: 3,
    escalationPct: 4,
    bondPct: 1.2,
    directCosts: [
      {
        id: "dc1",
        project_id: "p1",
        user_id: "u",
        description: "Gear",
        category: "quote",
        amount: 42500,
        ohp_applies: true,
        taxable: true,
        sort_order: 0,
      },
      {
        id: "dc2",
        project_id: "p1",
        user_id: "u",
        description: "Fire alarm sub",
        category: "subcontractor",
        amount: 18000,
        ohp_applies: false,
        taxable: false,
        sort_order: 1,
      },
    ] as DirectCost[],
  };

  it.each([
    [
      "system",
      { "l-led": "Lighting", "l-wire": "Lighting", "l-rec": "Power", "l-emt": "Feeders" },
    ],
    ["area", { "l-led": "Level 1", "l-wire": "Level 1", "l-rec": "Level 2", "l-emt": "" }],
    ["phase", { "l-led": "Phase 2", "l-wire": "", "l-rec": "Phase 1", "l-emt": "Phase 1" }],
  ] as const)("reconciles on %s with every markup engaged", (dimension, map) => {
    const breakdown = bidBreakdown(lines, tagged(dimension, map), loaded, dimension);
    const whole = summarize(loaded);
    expect(breakdown.reconciles).toBe(true);
    expect(breakdown.allocated).toBeCloseTo(whole.bidPrice, 6);
    // Bond is circular; the shares must still add up through it.
    const bond = breakdown.groups.reduce((t, g) => t + g.bondAmount, 0);
    expect(bond).toBeCloseTo(whole.bondAmount, 6);
    const prime = breakdown.groups.reduce((t, g) => t + g.primeCost, 0);
    expect(prime).toBeCloseTo(whole.primeCost, 6);
  });
});

describe("the breakdown refuses to look right when it is not", () => {
  it("reports a mismatch when the summary was not derived from these lines", () => {
    // A caller passing a stale total would otherwise render a breakdown that
    // silently disagrees with the bid price beside it.
    const stale = { ...baseInput, materialBase: baseInput.materialBase + 5000 };
    const breakdown = bidBreakdown(lines, tagged("system", SYSTEMS), stale, "system");
    expect(breakdown.reconciles).toBe(false);
    expect(Math.abs(breakdown.reconciliationError)).toBeGreaterThan(1);
  });

  it("handles an empty bid without dividing by zero", () => {
    const empty = bidBreakdown(
      [],
      layers,
      { ...baseInput, materialBase: 0, laborHoursBase: 0 },
      "system"
    );
    expect(empty.groups).toHaveLength(0);
    expect(empty.allocated).toBe(0);
    expect(empty.bidPrice).toBe(0);
    expect(empty.reconciles).toBe(true);
    expect(empty.groups.every((g) => Number.isFinite(g.pctOfBid))).toBe(true);
  });
});
