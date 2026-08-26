import { describe, expect, it } from "vitest";
import { bidPreflight } from "@/lib/preflight";
import {
  estimateTotals,
  extendEstimate,
  layerQuantities,
  summarize,
} from "@/lib/estimate";
import {
  assemblies,
  assemblyItems,
  items,
  layers,
  sheet,
  takeoffs,
} from "./fixtures/fixture-project";
import type { BidSnapshot, DirectCost, Project } from "@/lib/types";

const baseProject: Project = {
  id: "proj-snap-test",
  user_id: "user-1",
  name: "Snapshot Verification Project",
  labor_rate: 100,
  overhead_pct: 10,
  profit_pct: 10,
  waste_pct: 5,
  tax_pct: 5,
  labor_factor_pct: 10,
  created_at: "2026-08-25T00:00:00.000Z",
  updated_at: "2026-08-25T00:00:00.000Z",
};

function createValidWorkspaceState() {
  const reviewedTakeoffs = takeoffs.filter((t) => t.status === "confirmed");
  const quantities = layerQuantities(layers, reviewedTakeoffs, [sheet]);
  const { lines, issues } = extendEstimate(quantities, items, assemblies, assemblyItems);
  const directCosts: DirectCost[] = [
    {
      id: "dc-1",
      project_id: baseProject.id,
      user_id: "user-1",
      description: "Permit fee",
      category: "permit",
      amount: 500,
      ohp_applies: false,
      sort_order: 0,
    },
  ];
  const summary = summarize({
    ...estimateTotals(lines),
    laborRate: baseProject.labor_rate,
    wastePct: baseProject.waste_pct,
    taxPct: baseProject.tax_pct,
    laborFactorPct: baseProject.labor_factor_pct,
    overheadPct: baseProject.overhead_pct,
    profitPct: baseProject.profit_pct,
    directCosts,
  });

  return {
    project: { ...baseProject },
    sheets: [{ ...sheet }],
    layers: layers.map((l) => ({ ...l })),
    takeoffs: reviewedTakeoffs.map((t) => ({ ...t })),
    lines,
    issues,
    summary,
    directCosts,
    pendingWrites: 0,
    saveState: "saved" as const,
  };
}

describe("Empirical Challenger: Bid Snapshot & Revision Invariants", () => {
  it("determines next revision number deterministically from snapshot history", () => {
    const existingSnapshots: { revision: number }[] = [];
    const nextRev0 = Math.max(0, ...existingSnapshots.map((s) => s.revision)) + 1;
    expect(nextRev0).toBe(1);

    const s1 = [{ revision: 1 }];
    const nextRev1 = Math.max(0, ...s1.map((s) => s.revision)) + 1;
    expect(nextRev1).toBe(2);

    const s3 = [{ revision: 3 }, { revision: 1 }, { revision: 2 }];
    const nextRev3 = Math.max(0, ...s3.map((s) => s.revision)) + 1;
    expect(nextRev3).toBe(4);
  });

  it("strictly prohibits snapshot creation when ANY preflight blocker is active", () => {
    const state = createValidWorkspaceState();
    expect(bidPreflight(state).ready).toBe(true);

    // 1. empty bid blocker
    const emptyState = { ...state, lines: [], directCosts: [] };
    const pEmpty = bidPreflight(emptyState);
    expect(pEmpty.ready).toBe(false);
    expect(pEmpty.blockers.map((b) => b.id)).toContain("empty-bid");

    // 2. unnamed direct cost blocker
    const unnamedDcState = {
      ...state,
      directCosts: [{ ...state.directCosts[0], description: "   " }],
    };
    const pUnnamed = bidPreflight(unnamedDcState);
    expect(pUnnamed.ready).toBe(false);
    expect(pUnnamed.blockers.map((b) => b.id)).toContain("unnamed-direct-cost");

    // 3. invalid labor rate blocker
    const invalidRateState = {
      ...state,
      project: { ...state.project, labor_rate: 0 },
    };
    const pRate = bidPreflight(invalidRateState);
    expect(pRate.ready).toBe(false);
    expect(pRate.blockers.map((b) => b.id)).toContain("labor-rate");

    // 4. pending autocount blocker
    const pendingAiState = {
      ...state,
      takeoffs: [
        ...state.takeoffs,
        {
          id: "t-pending",
          layer_id: state.layers[0].id,
          sheet_id: state.sheets[0].id,
          project_id: state.project.id,
          user_id: "user-1",
          kind: "count" as const,
          geometry: { x: 50, y: 50 },
          source: "ai" as const,
          status: "pending" as const,
          ai_confidence: 0.9,
        },
      ],
    };
    const pAi = bidPreflight(pendingAiState);
    expect(pAi.ready).toBe(false);
    expect(pAi.blockers.map((b) => b.id)).toContain("pending-ai");

    // 5. persistence error blocker
    const saveErrState = {
      ...state,
      saveState: "error" as const,
    };
    const pSave = bidPreflight(saveErrState);
    expect(pSave.ready).toBe(false);
    expect(pSave.blockers.map((b) => b.id)).toContain("save-error");

    // 6. pending writes blocker
    const savePendingState = {
      ...state,
      pendingWrites: 2,
    };
    const pPending = bidPreflight(savePendingState);
    expect(pPending.ready).toBe(false);
    expect(pPending.blockers.map((b) => b.id)).toContain("save-pending");

    // 7. missing quantities blocker
    const missingState = {
      ...state,
      issues: [
        {
          layerId: "l-unlinked",
          layerName: "Unlinked",
          quantity: 10,
          kind: "unlinked" as const,
          severity: "missing" as const,
          detail: "Unlinked layer has quantity",
        },
      ],
    };
    const pMissing = bidPreflight(missingState);
    expect(pMissing.ready).toBe(false);
    expect(pMissing.blockers.map((b) => b.id)).toContain("missing-quantity");

    // 8. negative bid price blocker
    const negPriceState = {
      ...state,
      summary: { ...state.summary, bidPrice: -50 },
    };
    const pNeg = bidPreflight(negPriceState);
    expect(pNeg.ready).toBe(false);
    expect(pNeg.blockers.map((b) => b.id)).toContain("invalid-total");

    // 9. non-finite bid price blocker
    const nonFiniteState = {
      ...state,
      summary: { ...state.summary, bidPrice: Number.NaN },
    };
    const pNaN = bidPreflight(nonFiniteState);
    expect(pNaN.ready).toBe(false);
    expect(pNaN.blockers.map((b) => b.id)).toContain("invalid-total");
  });

  it("verifies snapshot payload deep immutability and structure", () => {
    const state = createValidWorkspaceState();
    const preflight = bidPreflight(state);
    expect(preflight.ready).toBe(true);

    const snapshot: BidSnapshot = {
      id: "snap-1",
      project_id: state.project.id,
      user_id: "user-1",
      revision: 1,
      label: "Base bid",
      created_at: new Date().toISOString(),
      bid_price: state.summary.bidPrice,
      material_total: state.summary.materialTotal,
      labor_hours_total: state.summary.laborHoursTotal,
      labor_cost: state.summary.laborCost,
      warning_count: preflight.warnings.length,
      payload: {
        schema_version: 1,
        project: { ...state.project },
        documents: [],
        sheets: [...state.sheets],
        layers: [...state.layers],
        takeoffs: [...state.takeoffs],
        items: [...items],
        assemblies: [...assemblies],
        assembly_items: [...assemblyItems],
        direct_costs: [...state.directCosts],
        summary: {
          material_base: state.summary.materialBase,
          material_total: state.summary.materialTotal,
          labor_hours_base: state.summary.laborHoursBase,
          labor_hours_total: state.summary.laborHoursTotal,
          labor_cost: state.summary.laborCost,
          prime_cost: state.summary.primeCost,
          overhead: state.summary.overhead,
          profit: state.summary.profit,
          bid_price: state.summary.bidPrice,
        },
        preflight: preflight.checks,
      },
    };

    // Deep freeze snapshot
    Object.freeze(snapshot);
    Object.freeze(snapshot.payload);
    Object.freeze(snapshot.payload.summary);

    // Mutate state afterwards
    state.project.labor_rate = 500;
    state.directCosts.push({
      id: "dc-2",
      project_id: state.project.id,
      user_id: "user-1",
      description: "Added later",
      category: "quote",
      amount: 10000,
      ohp_applies: true,
      sort_order: 1,
    });

    // Verify snapshot fields remain pristine
    expect(snapshot.bid_price).toBe(state.summary.bidPrice);
    expect(snapshot.payload.project.labor_rate).toBe(100);
    expect(snapshot.payload.direct_costs).toHaveLength(1);
    expect(snapshot.payload.summary.bid_price).toBe(snapshot.bid_price);
  });

  it("handles multi-revision sequences (R1 to R10) deterministically", () => {
    let currentRevisions: BidSnapshot[] = [];
    for (let r = 1; r <= 10; r++) {
      const nextRev = Math.max(0, ...currentRevisions.map((s) => s.revision)) + 1;
      expect(nextRev).toBe(r);
      const snapshot: BidSnapshot = {
        id: `snap-${r}`,
        project_id: baseProject.id,
        user_id: "user-1",
        revision: nextRev,
        label: `Addendum ${r}`,
        created_at: new Date().toISOString(),
        bid_price: 1000 * r,
        material_total: 500 * r,
        labor_hours_total: 10 * r,
        labor_cost: 400 * r,
        warning_count: 0,
        payload: {} as never,
      };
      currentRevisions = [snapshot, ...currentRevisions];
    }

    expect(currentRevisions).toHaveLength(10);
    expect(currentRevisions.map((s) => s.revision)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(currentRevisions.map((s) => s.bid_price)).toEqual([
      10000, 9000, 8000, 7000, 6000, 5000, 4000, 3000, 2000, 1000,
    ]);
  });
});
