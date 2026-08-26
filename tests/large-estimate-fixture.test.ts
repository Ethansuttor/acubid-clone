import { describe, expect, it } from "vitest";
import {
  createMulberry32,
  generateLargeEstimateFixture,
} from "./fixtures/large-estimate-fixture";
import {
  layerQuantities,
  extendEstimate,
  materialRollup,
  estimateTotals,
  summarize,
} from "@/lib/estimate";
import { bidPreflight } from "@/lib/preflight";

describe("deterministic large-estimate fixture", () => {
  it("produces deterministic PRNG values with identical seeds and divergent values with different seeds", () => {
    const rng1 = createMulberry32(42);
    const rng2 = createMulberry32(42);
    const rng3 = createMulberry32(999);

    const seq1 = Array.from({ length: 10 }, () => rng1.next());
    const seq2 = Array.from({ length: 10 }, () => rng2.next());
    const seq3 = Array.from({ length: 10 }, () => rng3.next());

    expect(seq1).toEqual(seq2);
    expect(seq1).not.toEqual(seq3);
  });

  it("generates exact target entity scale (50 sheets, 200 layers, 1000 items, 200 assemblies, 1200 components, 10k takeoffs, 50 direct costs)", () => {
    const fixture = generateLargeEstimateFixture({ seed: 42 });

    expect(fixture.documents).toHaveLength(5);
    expect(fixture.sheets).toHaveLength(50);
    expect(fixture.items).toHaveLength(1000);
    expect(fixture.assemblies).toHaveLength(200);
    expect(fixture.assemblyItems).toHaveLength(1200);
    expect(fixture.layers).toHaveLength(200);
    expect(fixture.takeoffs).toHaveLength(10000);
    expect(fixture.directCosts).toHaveLength(50);
  });

  it("maintains strict relational integrity across all entities", () => {
    const fixture = generateLargeEstimateFixture({ seed: 42 });

    const itemIds = new Set(fixture.items.map((i) => i.id));
    const assemblyIds = new Set(fixture.assemblies.map((a) => a.id));
    const sheetIds = new Set(fixture.sheets.map((s) => s.id));
    const layerIds = new Set(fixture.layers.map((l) => l.id));

    // Assembly items reference valid items and assemblies
    for (const ai of fixture.assemblyItems) {
      expect(itemIds.has(ai.item_id)).toBe(true);
      expect(assemblyIds.has(ai.assembly_id)).toBe(true);
    }

    // Layers reference valid items or assemblies when linked
    for (const l of fixture.layers) {
      if (l.item_id) expect(itemIds.has(l.item_id)).toBe(true);
      if (l.assembly_id) expect(assemblyIds.has(l.assembly_id)).toBe(true);
    }

    // Takeoffs reference valid layers and sheets
    for (const t of fixture.takeoffs) {
      expect(layerIds.has(t.layer_id)).toBe(true);
      expect(sheetIds.has(t.sheet_id)).toBe(true);
    }
  });

  it("executes the full estimating calculation pipeline on the generated fixture", () => {
    const fixture = generateLargeEstimateFixture({ seed: 42 });

    const quantities = layerQuantities(fixture.layers, fixture.takeoffs, fixture.sheets);
    expect(quantities).toHaveLength(200);

    const { lines, issues } = extendEstimate(
      quantities,
      fixture.items,
      fixture.assemblies,
      fixture.assemblyItems
    );
    expect(lines.length).toBeGreaterThan(0);

    const rollup = materialRollup(lines);
    expect(rollup.length).toBeGreaterThan(0);

    const totals = estimateTotals(lines);
    expect(totals.materialBase).toBeGreaterThan(0);
    expect(totals.laborHoursBase).toBeGreaterThan(0);

    const summary = summarize({
      ...totals,
      laborRate: fixture.project.labor_rate,
      wastePct: fixture.project.waste_pct,
      taxPct: fixture.project.tax_pct,
      laborFactorPct: fixture.project.labor_factor_pct,
      overheadPct: fixture.project.overhead_pct,
      profitPct: fixture.project.profit_pct,
      directCosts: fixture.directCosts,
    });
    expect(summary.bidPrice).toBeGreaterThan(0);
    expect(Number.isFinite(summary.bidPrice)).toBe(true);

    const preflight = bidPreflight({
      project: fixture.project,
      sheets: fixture.sheets,
      layers: fixture.layers,
      takeoffs: fixture.takeoffs,
      lines,
      issues,
      summary,
      directCosts: fixture.directCosts,
      pendingWrites: 0,
      saveState: "saved",
    });
    expect(preflight.ready).toBe(false);
    expect(new Set(preflight.blockers.map((check) => check.id))).toEqual(
      new Set(["pending-ai", "missing-quantity"])
    );
  });
});
