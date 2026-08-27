// Labor burden, small tools, escalation, contingency, sales tax on quotes, and
// a bond priced as a percentage of the bid price.
//
// Hand-calculated scenario, built on the fixture project's takeoff totals of
// $566.16 material / 13.528 labor hours, at $95/hr, 12% OH, 10% profit:
//
//   waste 5%           566.16 x 0.05                =        28.308
//   after waste                                     =       594.468
//   sales tax 8.25%    594.468 x 0.0825             =        49.04361
//   material total                                  =       643.51161
//   escalation 3%      643.51161 x 0.03             =        19.3053483
//
//   labor factor +15%  13.528 x 0.15                =         2.0292 hr
//   labor hours total                               =        15.5572 hr
//   labor cost @ 95                                 =      1477.934
//   burden 32%         1477.934 x 0.32              =       472.93888
//   small tools 2%     1477.934 x 0.02              =        29.55868
//   labor total        1477.934+472.93888+29.55868  =      1980.43156
//
//   switchgear quote 12000, O&P applies, TAXABLE
//     tax             12000 x 0.0825                =       990
//     with O&P                                      =     12990
//   permit 850, at cost, not taxable                =       850
//
//   prime  643.51161 + 19.3053483 + 1980.43156 + 12990
//                                                   =     15633.2485183
//   contingency 5%     x 0.05                       =       781.662425915
//   cost + contingency                              =     16414.910944215
//   overhead 12%       x 0.12                       =      1969.7893133058
//   subtotal                                        =     18384.7002575208
//   profit 10%         x 0.10                       =      1838.47002575208
//   + permit at cost 850
//   price before bond                               =     21073.17028327288
//
//   bond 1.2% OF THE BID PRICE, and the bid price includes the bond:
//     bid  = 21073.17028327288 / (1 - 0.012)        =     21329.11971991182
//     bond = bid - price before bond                =       255.94943663894
//     check: 21329.11971991182 x 0.012              =       255.94943663894  OK

import { describe, it, expect } from "vitest";
import { estimateTotals, extendEstimate, layerQuantities, summarize } from "@/lib/estimate";
import {
  items,
  assemblies,
  assemblyItems,
  layers,
  takeoffs,
  sheet,
  summaryInputs,
} from "./fixtures/fixture-project";
import type { DirectCost, DirectCostCategory } from "@/lib/types";

const quantities = layerQuantities(layers, takeoffs, [sheet]);
const { lines } = extendEstimate(quantities, items, assemblies, assemblyItems);
const totals = estimateTotals(lines);

function cost(
  id: string,
  amount: number,
  opts: Partial<Pick<DirectCost, "ohp_applies" | "taxable" | "category">> = {}
): DirectCost {
  return {
    id,
    project_id: "p1",
    user_id: "u",
    description: id,
    category: (opts.category ?? "quote") as DirectCostCategory,
    amount,
    ohp_applies: opts.ohp_applies ?? true,
    taxable: opts.taxable ?? false,
    sort_order: 0,
  };
}

const scenario = {
  ...totals,
  ...summaryInputs,
  wastePct: 5,
  taxPct: 8.25,
  laborFactorPct: 15,
  laborBurdenPct: 32,
  smallToolsPct: 2,
  escalationPct: 3,
  contingencyPct: 5,
  bondPct: 1.2,
  directCosts: [
    cost("switchgear", 12000, { ohp_applies: true, taxable: true }),
    cost("permit", 850, { ohp_applies: false, taxable: false }),
  ],
};

describe("the full bid chain with every markup applied", () => {
  const s = summarize(scenario);

  it("escalates the material total, not the base", () => {
    expect(s.materialTotal).toBeCloseTo(643.51161, 8);
    expect(s.escalation).toBeCloseTo(19.3053483, 8);
  });

  it("charges burden and small tools on bare labor cost", () => {
    expect(s.laborCost).toBeCloseTo(1477.934, 8);
    expect(s.laborBurden).toBeCloseTo(472.93888, 8);
    expect(s.smallTools).toBeCloseTo(29.55868, 8);
    expect(s.laborTotal).toBeCloseTo(1980.43156, 8);
  });

  it("taxes a quote flagged taxable, in its own O&P bucket", () => {
    expect(s.directCostsWithOhpBase).toBe(12000);
    expect(s.directCostsWithOhpTax).toBeCloseTo(990, 8);
    expect(s.directCostsWithOhp).toBeCloseTo(12990, 8);
    expect(s.directCostsAtCostBase).toBe(850);
    expect(s.directCostsAtCostTax).toBe(0);
    expect(s.directCostsAtCost).toBe(850);
    expect(s.directCostTax).toBeCloseTo(990, 8);
  });

  it("carries contingency inside the cost overhead is charged on", () => {
    expect(s.primeCost).toBeCloseTo(15633.2485183, 7);
    expect(s.contingency).toBeCloseTo(781.662425915, 7);
    expect(s.costWithContingency).toBeCloseTo(16414.910944215, 7);
    expect(s.overhead).toBeCloseTo(1969.7893133058, 6);
    expect(s.subtotal).toBeCloseTo(18384.7002575208, 6);
    expect(s.profit).toBeCloseTo(1838.47002575208, 6);
  });

  it("solves the circular bond so the premium is a share of the bid price", () => {
    expect(s.priceBeforeBond).toBeCloseTo(21073.17028327288, 6);
    expect(s.bond).toBeCloseTo(255.94943663894, 6);
    expect(s.bidPrice).toBeCloseTo(21329.11971991182, 6);
    // the defining property: the premium really is 1.2% of the final bid price
    expect(s.bond).toBeCloseTo(s.bidPrice * 0.012, 8);
    expect(s.bidPrice).toBeCloseTo(s.priceBeforeBond + s.bond, 8);
  });

  it("raises no warnings when the inputs are sane", () => {
    expect(s.warnings).toEqual([]);
  });
});

describe("each new term is inert at zero", () => {
  // Rule 3 of .ai/07-verification.md: prove the fixture's original figures
  // survive the new terms untouched.
  it("reproduces the pure takeoff bid", () => {
    const plain = summarize({ ...totals, ...summaryInputs });
    expect(plain.escalation).toBe(0);
    expect(plain.laborBurden).toBe(0);
    expect(plain.smallTools).toBe(0);
    expect(plain.contingency).toBe(0);
    expect(plain.bond).toBe(0);
    expect(plain.laborTotal).toBeCloseTo(1285.16, 8);
    expect(plain.primeCost).toBeCloseTo(1851.32, 8);
    expect(plain.bidPrice).toBeCloseTo(2280.82624, 8);
  });

  it("leaves the previous waste/tax/factor scenario's bid unchanged", () => {
    const before = summarize({
      ...totals,
      ...summaryInputs,
      wastePct: 5,
      taxPct: 8.25,
      laborFactorPct: 15,
      directCosts: [
        cost("switchgear", 12000, { ohp_applies: true }),
        cost("permit", 850, { ohp_applies: false }),
      ],
    });
    expect(before.bidPrice).toBeCloseTo(18247.62099152, 6);
  });

  it("adds no tax to a direct cost that is not flagged taxable", () => {
    const s = summarize({
      ...totals,
      ...summaryInputs,
      taxPct: 8.25,
      directCosts: [cost("switchgear", 12000, { ohp_applies: true })],
    });
    expect(s.directCostsWithOhp).toBe(12000);
    expect(s.directCostTax).toBe(0);
  });
});

describe("labor burden is visible rather than buried in the rate", () => {
  it("matches burdening the rate by hand, but shows the split", () => {
    // 13.528 hr at $95/hr with 32% burden is the same money as $125.40/hr,
    // which is exactly what an estimator had to do before this line existed.
    const split = summarize({ ...totals, ...summaryInputs, laborBurdenPct: 32 });
    const baked = summarize({ ...totals, ...summaryInputs, laborRate: 95 * 1.32 });
    expect(split.laborTotal).toBeCloseTo(baked.laborCost, 8);
    expect(split.bidPrice).toBeCloseTo(baked.bidPrice, 8);
    // the difference is that the split one can be shown to a reviewer
    expect(split.laborCost).toBeCloseTo(1285.16, 8);
    expect(split.laborBurden).toBeCloseTo(1285.16 * 0.32, 8);
  });
});

describe("a bond rate that cannot be solved is refused, not guessed", () => {
  it("adds no bond and says so at 100% or more", () => {
    // bid = price / (1 - 1.0) diverges; a plausible number here would be a lie.
    const s = summarize({ ...totals, ...summaryInputs, bondPct: 100 });
    expect(s.bond).toBe(0);
    expect(s.bidPrice).toBeCloseTo(2280.82624, 8);
    expect(s.warnings).toHaveLength(1);
    expect(s.warnings[0]).toContain("not a usable percentage");
  });

  it("adds no bond and says so for a negative rate", () => {
    const s = summarize({ ...totals, ...summaryInputs, bondPct: -2 });
    expect(s.bond).toBe(0);
    expect(s.warnings[0]).toContain("not a usable percentage");
  });

  it("warns when a bond is priced both as a percentage and as a direct cost", () => {
    const s = summarize({
      ...totals,
      ...summaryInputs,
      bondPct: 1.2,
      directCosts: [cost("bond premium", 400, { category: "bond", ohp_applies: false })],
    });
    expect(s.bond).toBeGreaterThan(0);
    expect(s.warnings.some((w) => w.includes("priced twice"))).toBe(true);
    // the warning does not change the arithmetic — both really are in the bid
    expect(s.bidPrice).toBeCloseTo(s.priceBeforeBond + s.bond, 8);
  });

  it("does not warn about a zero-dollar bond line", () => {
    const s = summarize({
      ...totals,
      ...summaryInputs,
      bondPct: 1.2,
      directCosts: [cost("bond TBD", 0, { category: "bond" })],
    });
    expect(s.warnings).toEqual([]);
  });
});
