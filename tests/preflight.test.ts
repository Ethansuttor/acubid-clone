import { describe, expect, it } from "vitest";
import { bidPreflight, type BidPreflightInput, type PreflightSeverity } from "@/lib/preflight";
import {
  estimateTotals,
  extendEstimate,
  layerQuantities,
  summarize,
  type EstimateLine,
} from "@/lib/estimate";
import {
  assemblies,
  assemblyItems,
  items,
  layers,
  sheet,
  summaryInputs,
  takeoffs,
} from "./fixtures/fixture-project";
import type { DirectCost, Item, Project, Takeoff } from "@/lib/types";

// Base pristine project for preflight testing
const baseProject: Project = {
  id: "p1",
  user_id: "u",
  name: "Fixture bid",
  labor_rate: summaryInputs.laborRate,
  overhead_pct: summaryInputs.overheadPct,
  profit_pct: summaryInputs.profitPct,
  waste_pct: 0,
  tax_pct: 0,
  labor_factor_pct: 0,
  created_at: "2026-08-25T00:00:00.000Z",
  updated_at: "2026-08-25T00:00:00.000Z",
};

/**
 * Creates a clean, pristine BidPreflightInput guaranteed to be 100% ready:
 * ready === true, blockers === [], warnings === [].
 */
function createReadyInput(): BidPreflightInput {
  const reviewedTakeoffs = takeoffs.filter((takeoff) => takeoff.status === "confirmed");
  const quantities = layerQuantities(layers, reviewedTakeoffs, [sheet]);
  const { lines, issues } = extendEstimate(quantities, items, assemblies, assemblyItems);
  return {
    project: { ...baseProject },
    sheets: [sheet],
    layers: layers.map((l) => ({ ...l })),
    takeoffs: reviewedTakeoffs.map((t) => ({ ...t })),
    lines: lines.map((l) => ({ ...l })),
    issues: issues.map((i) => ({ ...i })),
    summary: summarize({ ...estimateTotals(lines), ...summaryInputs }),
    directCosts: [],
    pendingWrites: 0,
    saveState: "saved",
  };
}

function createDummyItem(id: string, code: string, matCost: number, laborHrs: number, desc = `Desc ${code}`): Item {
  return {
    id,
    user_id: "u",
    code,
    description: desc,
    unit: "EA",
    material_cost: matCost,
    labor_hours: laborHrs,
  };
}

function createEstimateLine(item: Item, itemQty: number, layerId = "l-rec"): EstimateLine {
  return {
    layerId,
    layerName: "Test Layer",
    item,
    assembly: null,
    perUnit: 1,
    takeoffQty: itemQty,
    itemQty,
    materialCost: itemQty * item.material_cost,
    laborHours: itemQty * item.labor_hours,
  };
}

function createDirectCost(amount: number, description: string, ohp = true): DirectCost {
  return {
    id: `dc-${Math.random().toString(36).slice(2, 7)}`,
    project_id: "p1",
    user_id: "u",
    description,
    category: "quote",
    amount,
    ohp_applies: ohp,
    sort_order: 0,
  };
}

describe("bidPreflight - Baseline readiness", () => {
  it("passes a complete, pristine bid with zero blockers and zero warnings", () => {
    const input = createReadyInput();
    const result = bidPreflight(input);
    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.checks).toEqual([]);
  });

  it("maintains consistent partition invariant: checks equals blockers + warnings", () => {
    const input = createReadyInput();
    input.saveState = "error"; // 1 blocker
    input.sheets = []; // 1 warning
    const result = bidPreflight(input);
    expect(result.ready).toBe(false);
    expect(result.blockers).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.checks).toHaveLength(2);
    expect(result.checks).toEqual([...result.blockers, ...result.warnings]);
  });
});

describe("bidPreflight - Blocker Rules", () => {
  describe("Rule: save-error", () => {
    it("blocks when saveState is 'error'", () => {
      const input = createReadyInput();
      input.saveState = "error";
      const result = bidPreflight(input);
      expect(result.ready).toBe(false);
      const check = result.blockers.find((c) => c.id === "save-error");
      expect(check).toBeDefined();
      expect(check?.severity).toBe("blocker");
      expect(check?.title).toBe("A change failed to save");
      expect(check?.detail).toBe(
        "Resolve the save error before issuing this bid. Later successful edits do not clear this failure."
      );
    });

    it.each<["saved" | "saving"]>([["saved"], ["saving"]])(
      "does not trigger save-error when saveState is '%s'",
      (state) => {
        const input = createReadyInput();
        input.saveState = state;
        const result = bidPreflight(input);
        expect(result.blockers.map((c) => c.id)).not.toContain("save-error");
      }
    );
  });

  describe("Rule: save-pending", () => {
    it.each([
      [1, "Wait for 1 pending change to finish."],
      [2, "Wait for 2 pending changes to finish."],
      [5, "Wait for 5 pending changes to finish."],
    ])("blocks with correct singular/plural text when pendingWrites is %d", (pendingWrites, expectedDetail) => {
      const input = createReadyInput();
      input.pendingWrites = pendingWrites;
      input.saveState = "saving";
      const result = bidPreflight(input);
      expect(result.ready).toBe(false);
      const check = result.blockers.find((c) => c.id === "save-pending");
      expect(check).toBeDefined();
      expect(check?.severity).toBe("blocker");
      expect(check?.title).toBe("Changes are still saving");
      expect(check?.detail).toBe(expectedDetail);
    });

    it("does not block when pendingWrites is 0", () => {
      const input = createReadyInput();
      input.pendingWrites = 0;
      const result = bidPreflight(input);
      expect(result.blockers.map((c) => c.id)).not.toContain("save-pending");
    });
  });

  describe("Rule: missing-quantity", () => {
    it.each([
      [
        1,
        [
          {
            layerId: "l1",
            layerName: "Layer 1",
            quantity: 5,
            kind: "unlinked" as const,
            severity: "missing" as const,
            detail: "Unlinked layer",
          },
        ],
        "1 estimate issue prevents a complete extension. Review the Estimate tab.",
      ],
      [
        2,
        [
          {
            layerId: "l1",
            layerName: "Layer 1",
            quantity: 5,
            kind: "unlinked" as const,
            severity: "missing" as const,
            detail: "Unlinked layer",
          },
          {
            layerId: "l2",
            layerName: "Layer 2",
            quantity: 10,
            kind: "missing-item" as const,
            severity: "missing" as const,
            detail: "Missing item",
          },
        ],
        "2 estimate issues prevent a complete extension. Review the Estimate tab.",
      ],
    ])(
      "blocks with %d missing issue(s) with correct singular/plural message",
      (_count, issueList, expectedDetail) => {
        const input = createReadyInput();
        input.issues = issueList;
        const result = bidPreflight(input);
        expect(result.ready).toBe(false);
        const check = result.blockers.find((c) => c.id === "missing-quantity");
        expect(check).toBeDefined();
        expect(check?.severity).toBe("blocker");
        expect(check?.title).toBe("Quantity is missing from the bid");
        expect(check?.detail).toBe(expectedDetail);
      }
    );

    it("does not trigger missing-quantity when issues have warning severity only", () => {
      const input = createReadyInput();
      input.issues = [
        {
          layerId: "l1",
          layerName: "Layer 1",
          quantity: 5,
          kind: "unit-mismatch",
          severity: "warning",
          detail: "Unit mismatch",
        },
      ];
      const result = bidPreflight(input);
      expect(result.blockers.map((c) => c.id)).not.toContain("missing-quantity");
      expect(result.warnings.map((c) => c.id)).toContain("estimate-warnings");
    });
  });

  describe("Rule: pending-ai", () => {
    it.each([
      [1, "1 candidate is pending acceptance or rejection."],
      [3, "3 candidates are pending acceptance or rejection."],
    ])("blocks when %d AI takeoff candidate(s) are pending review", (count, expectedDetail) => {
      const input = createReadyInput();
      const pendingTakeoffs: Takeoff[] = Array.from({ length: count }, (_, i) => ({
        id: `t-pending-${i}`,
        layer_id: "l-rec",
        sheet_id: "s1",
        project_id: "p1",
        user_id: "u",
        kind: "count",
        geometry: { x: 10 * i, y: 10 * i },
        source: "ai",
        status: "pending",
        ai_confidence: 0.88,
      }));
      input.takeoffs = [...input.takeoffs, ...pendingTakeoffs];
      const result = bidPreflight(input);
      expect(result.ready).toBe(false);
      const check = result.blockers.find((c) => c.id === "pending-ai");
      expect(check).toBeDefined();
      expect(check?.severity).toBe("blocker");
      expect(check?.title).toBe("AI counts still need review");
      expect(check?.detail).toBe(expectedDetail);
    });

    it("does not block when takeoffs are confirmed or rejected", () => {
      const input = createReadyInput();
      input.takeoffs = [
        ...input.takeoffs,
        {
          id: "t-rejected",
          layer_id: "l-rec",
          sheet_id: "s1",
          project_id: "p1",
          user_id: "u",
          kind: "count",
          geometry: { x: 50, y: 50 },
          source: "ai",
          status: "rejected",
          ai_confidence: 0.4,
        },
      ];
      const result = bidPreflight(input);
      expect(result.blockers.map((c) => c.id)).not.toContain("pending-ai");
    });
  });

  describe("Rule: labor-rate", () => {
    it.each([0, -10])("blocks when laborHoursTotal > 0 and labor_rate is %d", (rate) => {
      const input = createReadyInput();
      input.project.labor_rate = rate;
      input.summary.laborRate = rate;
      input.summary.laborHoursTotal = 13.528;
      const result = bidPreflight(input);
      expect(result.ready).toBe(false);
      const check = result.blockers.find((c) => c.id === "labor-rate");
      expect(check).toBeDefined();
      expect(check?.severity).toBe("blocker");
      expect(check?.title).toBe("Labor has no billing rate");
      expect(check?.detail).toBe("13.53 labor hours are extended at $0 per hour.");
    });

    it("does not block when labor_rate is 0 but laborHoursTotal is 0 (material-only / direct-cost-only)", () => {
      const input = createReadyInput();
      input.project.labor_rate = 0;
      input.summary.laborRate = 0;
      input.summary.laborHoursTotal = 0;
      input.lines = [createEstimateLine(createDummyItem("i1", "MAT-1", 100, 0), 5)];
      const result = bidPreflight(input);
      expect(result.blockers.map((c) => c.id)).not.toContain("labor-rate");
    });

    it("does not block when labor_rate is positive ($0.01 or higher)", () => {
      const input = createReadyInput();
      input.project.labor_rate = 0.01;
      input.summary.laborRate = 0.01;
      const result = bidPreflight(input);
      expect(result.blockers.map((c) => c.id)).not.toContain("labor-rate");
    });
  });

  describe("Rule: invalid-total", () => {
    it.each([
      [Number.NaN],
      [Number.POSITIVE_INFINITY],
      [Number.NEGATIVE_INFINITY],
      [-0.01],
      [-500],
    ])("blocks when summary.bidPrice is %s", (bidPrice) => {
      const input = createReadyInput();
      input.summary = { ...input.summary, bidPrice };
      const result = bidPreflight(input);
      expect(result.ready).toBe(false);
      const check = result.blockers.find((c) => c.id === "invalid-total");
      expect(check).toBeDefined();
      expect(check?.severity).toBe("blocker");
      expect(check?.title).toBe("Bid total is invalid");
      expect(check?.detail).toBe("At least one commercial input produced a non-finite or negative bid total.");
    });

    it("does not block invalid-total when bidPrice is 0 (non-negative finite number)", () => {
      const input = createReadyInput();
      input.summary = { ...input.summary, bidPrice: 0 };
      const result = bidPreflight(input);
      expect(result.blockers.map((c) => c.id)).not.toContain("invalid-total");
    });
  });

  describe("Rule: unnamed-direct-cost", () => {
    it.each([
      ["", 500, "1 priced cost needs a scope or vendor description."],
      ["   ", 250, "1 priced cost needs a scope or vendor description."],
      ["\t\n", 100, "1 priced cost needs a scope or vendor description."],
    ])("blocks when a priced direct cost has whitespace/empty description '%s'", (desc, amount, expectedDetail) => {
      const input = createReadyInput();
      input.directCosts = [createDirectCost(amount, desc)];
      const result = bidPreflight(input);
      expect(result.ready).toBe(false);
      const check = result.blockers.find((c) => c.id === "unnamed-direct-cost");
      expect(check).toBeDefined();
      expect(check?.severity).toBe("blocker");
      expect(check?.title).toBe("A direct cost has no description");
      expect(check?.detail).toBe(expectedDetail);
    });

    it("formats plural message when multiple unnamed priced costs exist", () => {
      const input = createReadyInput();
      input.directCosts = [
        createDirectCost(100, ""),
        createDirectCost(200, "   "),
      ];
      const result = bidPreflight(input);
      const check = result.blockers.find((c) => c.id === "unnamed-direct-cost");
      expect(check?.detail).toBe("2 priced costs need a scope or vendor description.");
    });

    it("does not block when direct cost has amount 0 even if description is empty", () => {
      const input = createReadyInput();
      input.directCosts = [createDirectCost(0, "")];
      const result = bidPreflight(input);
      expect(result.blockers.map((c) => c.id)).not.toContain("unnamed-direct-cost");
    });

    it("does not block when priced direct cost has a valid trimmed description", () => {
      const input = createReadyInput();
      input.directCosts = [createDirectCost(500, "Permit fee")];
      const result = bidPreflight(input);
      expect(result.blockers.map((c) => c.id)).not.toContain("unnamed-direct-cost");
    });
  });

  describe("Rule: empty-bid", () => {
    it("blocks when lines is empty and directCosts is empty", () => {
      const input = createReadyInput();
      input.lines = [];
      input.directCosts = [];
      const result = bidPreflight(input);
      expect(result.ready).toBe(false);
      const check = result.blockers.find((c) => c.id === "empty-bid");
      expect(check).toBeDefined();
      expect(check?.severity).toBe("blocker");
      expect(check?.title).toBe("The bid has no priced scope");
      expect(check?.detail).toBe("Add takeoff-linked scope or a priced direct cost before issuing this bid.");
    });

    it("blocks when lines is empty and all directCosts have amount 0", () => {
      const input = createReadyInput();
      input.lines = [];
      input.directCosts = [createDirectCost(0, "Unpriced note")];
      const result = bidPreflight(input);
      expect(result.blockers.map((c) => c.id)).toContain("empty-bid");
    });

    it("does not block empty-bid when lines are present", () => {
      const input = createReadyInput();
      input.directCosts = [];
      const result = bidPreflight(input);
      expect(result.blockers.map((c) => c.id)).not.toContain("empty-bid");
    });

    it("does not block empty-bid when lines is empty but a priced direct cost exists", () => {
      const input = createReadyInput();
      input.lines = [];
      input.directCosts = [createDirectCost(1500, "Gear quote")];
      const result = bidPreflight(input);
      expect(result.blockers.map((c) => c.id)).not.toContain("empty-bid");
    });
  });

  describe("Rule: zero-value-items", () => {
    it("blocks when an item with itemQty > 0 has material_cost <= 0 AND labor_hours <= 0", () => {
      const input = createReadyInput();
      const zeroItem = createDummyItem("z1", "ZERO-1", 0, 0);
      input.lines.push(createEstimateLine(zeroItem, 10));
      const result = bidPreflight(input);
      expect(result.ready).toBe(false);
      const check = result.blockers.find((c) => c.id === "zero-value-items");
      expect(check).toBeDefined();
      expect(check?.severity).toBe("blocker");
      expect(check?.title).toBe("Used items have no material or labor value");
      expect(check?.detail).toBe("ZERO-1 extend at zero cost.");
    });

    it("truncates item list when more than 4 zero-value items exist", () => {
      const input = createReadyInput();
      input.lines = [
        createEstimateLine(createDummyItem("z1", "Z1", 0, 0), 1),
        createEstimateLine(createDummyItem("z2", "Z2", 0, 0), 1),
        createEstimateLine(createDummyItem("z3", "Z3", 0, 0), 1),
        createEstimateLine(createDummyItem("z4", "Z4", 0, 0), 1),
        createEstimateLine(createDummyItem("z5", "Z5", 0, 0), 1),
        createEstimateLine(createDummyItem("z6", "Z6", 0, 0), 1),
      ];
      const result = bidPreflight(input);
      const check = result.blockers.find((c) => c.id === "zero-value-items");
      expect(check?.detail).toBe("Z1, Z2, Z3, Z4 and 2 more extend at zero cost.");
    });

    it("uses item description if item code is empty", () => {
      const input = createReadyInput();
      const zeroItem = createDummyItem("z1", "", 0, 0, "No-Code Zero Item");
      input.lines = [createEstimateLine(zeroItem, 5)];
      const result = bidPreflight(input);
      const check = result.blockers.find((c) => c.id === "zero-value-items");
      expect(check?.detail).toBe("No-Code Zero Item extend at zero cost.");
    });

    it("deduplicates identical zero-value item codes across multiple lines", () => {
      const input = createReadyInput();
      const zeroItem = createDummyItem("z1", "ZERO-1", 0, 0);
      input.lines = [
        createEstimateLine(zeroItem, 5, "layer-a"),
        createEstimateLine(zeroItem, 10, "layer-b"),
      ];
      const result = bidPreflight(input);
      const check = result.blockers.find((c) => c.id === "zero-value-items");
      expect(check?.detail).toBe("ZERO-1 extend at zero cost.");
    });

    it("does not block zero-value-items if itemQty is 0", () => {
      const input = createReadyInput();
      const zeroItem = createDummyItem("z1", "ZERO-1", 0, 0);
      input.lines = [
        createEstimateLine(createDummyItem("valid", "V1", 10, 1), 5),
        createEstimateLine(zeroItem, 0),
      ];
      const result = bidPreflight(input);
      expect(result.blockers.map((c) => c.id)).not.toContain("zero-value-items");
    });
  });
});

describe("bidPreflight - Warning Rules", () => {
  describe("Rule: no-sheets", () => {
    it("warns when sheets array is empty without blocking ready", () => {
      const input = createReadyInput();
      input.sheets = [];
      const result = bidPreflight(input);
      expect(result.ready).toBe(true);
      const check = result.warnings.find((c) => c.id === "no-sheets");
      expect(check).toBeDefined();
      expect(check?.severity).toBe("warning");
      expect(check?.title).toBe("No plan sheets are attached");
      expect(check?.detail).toBe(
        "This may be intentional for a quote-only estimate, but it should be confirmed."
      );
    });

    it("does not warn when sheets are attached", () => {
      const input = createReadyInput();
      expect(input.sheets.length).toBeGreaterThan(0);
      const result = bidPreflight(input);
      expect(result.warnings.map((c) => c.id)).not.toContain("no-sheets");
    });
  });

  describe("Rule: zero-material-items", () => {
    it("warns when items have labor_hours > 0 but material_cost <= 0 (labor-only)", () => {
      const input = createReadyInput();
      const laborOnly = createDummyItem("l1", "LABOR-ONLY", 0, 2.5);
      input.lines.push(createEstimateLine(laborOnly, 4));
      const result = bidPreflight(input);
      expect(result.ready).toBe(true);
      const check = result.warnings.find((c) => c.id === "zero-material-items");
      expect(check).toBeDefined();
      expect(check?.severity).toBe("warning");
      expect(check?.title).toBe("Used items have no material price");
      expect(check?.detail).toBe("LABOR-ONLY may be labor-only or unpriced.");
      expect(result.blockers.map((c) => c.id)).not.toContain("zero-value-items");
    });

    it("truncates zero-material item codes if > 4 items", () => {
      const input = createReadyInput();
      input.lines = [
        createEstimateLine(createDummyItem("l1", "L1", 0, 1), 1),
        createEstimateLine(createDummyItem("l2", "L2", 0, 1), 1),
        createEstimateLine(createDummyItem("l3", "L3", 0, 1), 1),
        createEstimateLine(createDummyItem("l4", "L4", 0, 1), 1),
        createEstimateLine(createDummyItem("l5", "L5", 0, 1), 1),
      ];
      const result = bidPreflight(input);
      const check = result.warnings.find((c) => c.id === "zero-material-items");
      expect(check?.detail).toBe("L1, L2, L3, L4 and 1 more may be labor-only or unpriced.");
    });
  });

  describe("Rule: zero-labor-items", () => {
    it("warns when items have material_cost > 0 but labor_hours <= 0 (material-only)", () => {
      const input = createReadyInput();
      const matOnly = createDummyItem("m1", "MAT-ONLY", 45.5, 0);
      input.lines.push(createEstimateLine(matOnly, 2));
      const result = bidPreflight(input);
      expect(result.ready).toBe(true);
      const check = result.warnings.find((c) => c.id === "zero-labor-items");
      expect(check).toBeDefined();
      expect(check?.severity).toBe("warning");
      expect(check?.title).toBe("Used items have no labor unit");
      expect(check?.detail).toBe("MAT-ONLY may be material-only or missing labor.");
      expect(result.blockers.map((c) => c.id)).not.toContain("zero-value-items");
    });

    it("truncates zero-labor item codes if > 4 items", () => {
      const input = createReadyInput();
      input.lines = [
        createEstimateLine(createDummyItem("m1", "M1", 10, 0), 1),
        createEstimateLine(createDummyItem("m2", "M2", 10, 0), 1),
        createEstimateLine(createDummyItem("m3", "M3", 10, 0), 1),
        createEstimateLine(createDummyItem("m4", "M4", 10, 0), 1),
        createEstimateLine(createDummyItem("m5", "M5", 10, 0), 1),
      ];
      const result = bidPreflight(input);
      const check = result.warnings.find((c) => c.id === "zero-labor-items");
      expect(check?.detail).toBe("M1, M2, M3, M4 and 1 more may be material-only or missing labor.");
    });
  });

  describe("Rule: estimate-warnings", () => {
    it.each([
      [1, "1 unit or catalog warning is present."],
      [2, "2 unit or catalog warnings are present."],
    ])("warns with %d estimate warning issue(s) with singular/plural detail", (count, expectedDetail) => {
      const input = createReadyInput();
      input.issues = Array.from({ length: count }, (_, i) => ({
        layerId: `l-${i}`,
        layerName: `Layer ${i}`,
        quantity: 10,
        kind: "unit-mismatch" as const,
        severity: "warning" as const,
        detail: "Unit mismatch",
      }));
      const result = bidPreflight(input);
      expect(result.ready).toBe(true);
      const check = result.warnings.find((c) => c.id === "estimate-warnings");
      expect(check).toBeDefined();
      expect(check?.severity).toBe("warning");
      expect(check?.title).toBe("Estimate links need review");
      expect(check?.detail).toBe(expectedDetail);
      expect(result.blockers.map((c) => c.id)).not.toContain("missing-quantity");
    });
  });

  describe("Rule: cross-sheet-typical", () => {
    it("warns when a layer with typical_multiplier > 1 spans multiple sheets with confirmed takeoffs", () => {
      const input = createReadyInput();
      input.layers = input.layers.map((layer) =>
        layer.id === "l-rec" ? { ...layer, typical_multiplier: 3 } : layer
      );
      input.takeoffs = [
        ...input.takeoffs,
        { ...input.takeoffs[0], id: "other-sheet-confirmed", sheet_id: "sheet-2", status: "confirmed" },
      ];
      const result = bidPreflight(input);
      expect(result.ready).toBe(true);
      const check = result.warnings.find((c) => c.id === "cross-sheet-typical");
      expect(check).toBeDefined();
      expect(check?.severity).toBe("warning");
      expect(check?.title).toBe("Typical multipliers span multiple sheets");
      expect(check?.detail).toBe("Receptacles may multiply unrelated sheet quantities.");
    });

    it("does not warn when typical_multiplier > 1 but all takeoffs are on a single sheet", () => {
      const input = createReadyInput();
      input.layers = input.layers.map((layer) =>
        layer.id === "l-rec" ? { ...layer, typical_multiplier: 3 } : layer
      );
      const result = bidPreflight(input);
      expect(result.warnings.map((c) => c.id)).not.toContain("cross-sheet-typical");
    });

    it("does not warn when typical_multiplier is 1 even across multiple sheets", () => {
      const input = createReadyInput();
      input.takeoffs = [
        ...input.takeoffs,
        { ...input.takeoffs[0], id: "other-sheet-confirmed", sheet_id: "sheet-2", status: "confirmed" },
      ];
      const result = bidPreflight(input);
      expect(result.warnings.map((c) => c.id)).not.toContain("cross-sheet-typical");
    });

    it("ignores pending and rejected takeoffs when computing sheet count for cross-sheet typical", () => {
      const input = createReadyInput();
      input.layers = input.layers.map((layer) =>
        layer.id === "l-rec" ? { ...layer, typical_multiplier: 3 } : layer
      );
      input.takeoffs = [
        ...input.takeoffs,
        { ...input.takeoffs[0], id: "other-sheet-pending", sheet_id: "sheet-2", status: "pending" },
        { ...input.takeoffs[0], id: "other-sheet-rejected", sheet_id: "sheet-3", status: "rejected" },
      ];
      const result = bidPreflight(input);
      expect(result.warnings.map((c) => c.id)).not.toContain("cross-sheet-typical");
    });
  });

  describe("Rule: zero-markup", () => {
    it.each([
      [0, 10],
      [12, 0],
      [0, 0],
    ])("warns when overhead_pct is %d and profit_pct is %d", (overhead, profit) => {
      const input = createReadyInput();
      input.project.overhead_pct = overhead;
      input.project.profit_pct = profit;
      const result = bidPreflight(input);
      expect(result.ready).toBe(true);
      const check = result.warnings.find((c) => c.id === "zero-markup");
      expect(check).toBeDefined();
      expect(check?.severity).toBe("warning");
      expect(check?.title).toBe("Overhead or profit is zero");
      expect(check?.detail).toBe("Confirm the commercial strategy before issuing the bid.");
    });

    it("does not warn when both overhead_pct and profit_pct are positive", () => {
      const input = createReadyInput();
      input.project.overhead_pct = 5;
      input.project.profit_pct = 5;
      const result = bidPreflight(input);
      expect(result.warnings.map((c) => c.id)).not.toContain("zero-markup");
    });
  });
});

describe("bidPreflight - Master Table-Driven 15-Rule Matrix", () => {
  interface RuleMatrixRow {
    ruleNumber: number;
    id: string;
    severity: PreflightSeverity;
    title: string;
    mutate: (input: BidPreflightInput) => void;
  }

  const ruleMatrix: RuleMatrixRow[] = [
    {
      ruleNumber: 1,
      id: "save-error",
      severity: "blocker",
      title: "A change failed to save",
      mutate: (i) => {
        i.saveState = "error";
      },
    },
    {
      ruleNumber: 2,
      id: "save-pending",
      severity: "blocker",
      title: "Changes are still saving",
      mutate: (i) => {
        i.pendingWrites = 2;
      },
    },
    {
      ruleNumber: 3,
      id: "missing-quantity",
      severity: "blocker",
      title: "Quantity is missing from the bid",
      mutate: (i) => {
        i.issues = [
          {
            layerId: "l1",
            layerName: "L1",
            quantity: 5,
            kind: "unlinked",
            severity: "missing",
            detail: "Missing",
          },
        ];
      },
    },
    {
      ruleNumber: 4,
      id: "pending-ai",
      severity: "blocker",
      title: "AI counts still need review",
      mutate: (i) => {
        i.takeoffs.push({ ...i.takeoffs[0], id: "pending-ai-1", status: "pending", source: "ai" });
      },
    },
    {
      ruleNumber: 5,
      id: "labor-rate",
      severity: "blocker",
      title: "Labor has no billing rate",
      mutate: (i) => {
        i.project.labor_rate = 0;
        i.summary.laborRate = 0;
        i.summary.laborHoursTotal = 15;
      },
    },
    {
      ruleNumber: 6,
      id: "invalid-total",
      severity: "blocker",
      title: "Bid total is invalid",
      mutate: (i) => {
        i.summary.bidPrice = Number.NaN;
      },
    },
    {
      ruleNumber: 7,
      id: "unnamed-direct-cost",
      severity: "blocker",
      title: "A direct cost has no description",
      mutate: (i) => {
        i.directCosts = [createDirectCost(1000, "")];
      },
    },
    {
      ruleNumber: 8,
      id: "empty-bid",
      severity: "blocker",
      title: "The bid has no priced scope",
      mutate: (i) => {
        i.lines = [];
        i.directCosts = [];
      },
    },
    {
      ruleNumber: 9,
      id: "no-sheets",
      severity: "warning",
      title: "No plan sheets are attached",
      mutate: (i) => {
        i.sheets = [];
      },
    },
    {
      ruleNumber: 10,
      id: "zero-value-items",
      severity: "blocker",
      title: "Used items have no material or labor value",
      mutate: (i) => {
        i.lines.push(createEstimateLine(createDummyItem("z1", "ZERO-VAL", 0, 0), 10));
      },
    },
    {
      ruleNumber: 11,
      id: "zero-material-items",
      severity: "warning",
      title: "Used items have no material price",
      mutate: (i) => {
        i.lines.push(createEstimateLine(createDummyItem("l1", "LABOR-ONLY", 0, 2), 5));
      },
    },
    {
      ruleNumber: 12,
      id: "zero-labor-items",
      severity: "warning",
      title: "Used items have no labor unit",
      mutate: (i) => {
        i.lines.push(createEstimateLine(createDummyItem("m1", "MAT-ONLY", 25, 0), 5));
      },
    },
    {
      ruleNumber: 13,
      id: "estimate-warnings",
      severity: "warning",
      title: "Estimate links need review",
      mutate: (i) => {
        i.issues = [
          {
            layerId: "l1",
            layerName: "L1",
            quantity: 5,
            kind: "unit-mismatch",
            severity: "warning",
            detail: "Unit mismatch",
          },
        ];
      },
    },
    {
      ruleNumber: 14,
      id: "cross-sheet-typical",
      severity: "warning",
      title: "Typical multipliers span multiple sheets",
      mutate: (i) => {
        i.layers[0].typical_multiplier = 2;
        i.takeoffs.push({
          ...i.takeoffs[0],
          id: "cs-takeoff",
          layer_id: i.layers[0].id,
          sheet_id: "sheet-2",
          status: "confirmed",
        });
      },
    },
    {
      ruleNumber: 15,
      id: "zero-markup",
      severity: "warning",
      title: "Overhead or profit is zero",
      mutate: (i) => {
        i.project.overhead_pct = 0;
      },
    },
  ];

  it.each(ruleMatrix)(
    "evaluates Rule #$ruleNumber ($id - $severity)",
    ({ id, severity, title, mutate }) => {
      const input = createReadyInput();
      mutate(input);
      const result = bidPreflight(input);

      const targetList = severity === "blocker" ? result.blockers : result.warnings;
      const otherList = severity === "blocker" ? result.warnings : result.blockers;

      const matched = targetList.find((c) => c.id === id);
      expect(matched).toBeDefined();
      expect(matched?.title).toBe(title);
      expect(matched?.severity).toBe(severity);
      expect(otherList.map((c) => c.id)).not.toContain(id);

      if (severity === "blocker") {
        expect(result.ready).toBe(false);
      } else {
        expect(result.ready).toBe(true);
      }
    }
  );
});

describe("bidPreflight - Valid Commercial Edge Cases", () => {
  it("allows a direct-cost-only bid (no sheets, no takeoffs, $0 labor rate, priced direct cost)", () => {
    const input: BidPreflightInput = {
      project: {
        ...baseProject,
        labor_rate: 0, // No labor rate needed since labor hours is 0
        overhead_pct: 10,
        profit_pct: 10,
      },
      sheets: [], // No sheets attached
      layers: [],
      takeoffs: [],
      lines: [],
      issues: [],
      summary: summarize({
        materialBase: 0,
        laborHoursBase: 0,
        laborRate: 0,
        wastePct: 0,
        taxPct: 0,
        laborFactorPct: 0,
        overheadPct: 10,
        profitPct: 10,
        directCosts: [createDirectCost(25000, "Subcontractor Turnkey Package", true)],
      }),
      directCosts: [createDirectCost(25000, "Subcontractor Turnkey Package", true)],
      pendingWrites: 0,
      saveState: "saved",
    };

    const result = bidPreflight(input);
    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
    // Warning for no-sheets is present
    expect(result.warnings.map((c) => c.id)).toEqual(["no-sheets"]);
  });

  it("allows a pure material-only bid with $0 labor rate without blocker", () => {
    const matItem = createDummyItem("mat-only-item", "CONDUIT-100", 75, 0);
    const line = createEstimateLine(matItem, 10);
    const input: BidPreflightInput = {
      project: {
        ...baseProject,
        labor_rate: 0, // $0 labor rate is acceptable when labor hours is 0
        overhead_pct: 10,
        profit_pct: 10,
      },
      sheets: [sheet],
      layers: layers.map((l) => ({ ...l })),
      takeoffs: takeoffs.filter((t) => t.status === "confirmed"),
      lines: [line],
      issues: [],
      summary: summarize({
        materialBase: 750,
        laborHoursBase: 0,
        laborRate: 0,
        wastePct: 0,
        taxPct: 0,
        laborFactorPct: 0,
        overheadPct: 10,
        profitPct: 10,
        directCosts: [],
      }),
      directCosts: [],
      pendingWrites: 0,
      saveState: "saved",
    };

    const result = bidPreflight(input);
    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.warnings.map((c) => c.id)).toContain("zero-labor-items");
    expect(result.blockers.map((c) => c.id)).not.toContain("labor-rate");
  });

  it("allows a labor-only bid with valid labor rate without blocker", () => {
    const laborItem = createDummyItem("labor-only-item", "INSTALL-HRS", 0, 2.5);
    const line = createEstimateLine(laborItem, 10);
    const input: BidPreflightInput = {
      project: {
        ...baseProject,
        labor_rate: 95,
        overhead_pct: 10,
        profit_pct: 10,
      },
      sheets: [sheet],
      layers: layers.map((l) => ({ ...l })),
      takeoffs: takeoffs.filter((t) => t.status === "confirmed"),
      lines: [line],
      issues: [],
      summary: summarize({
        materialBase: 0,
        laborHoursBase: 25,
        laborRate: 95,
        wastePct: 0,
        taxPct: 0,
        laborFactorPct: 0,
        overheadPct: 10,
        profitPct: 10,
        directCosts: [],
      }),
      directCosts: [],
      pendingWrites: 0,
      saveState: "saved",
    };

    const result = bidPreflight(input);
    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.warnings.map((c) => c.id)).toContain("zero-material-items");
    expect(result.blockers.map((c) => c.id)).not.toContain("zero-value-items");
  });
});

describe("bidPreflight - Multi-Condition Aggregation & Partitioning", () => {
  it("aggregates multiple blockers and returns ready = false", () => {
    const input = createReadyInput();
    input.saveState = "error";
    input.pendingWrites = 4;
    input.project.labor_rate = 0;
    input.summary.laborRate = 0;
    input.summary.laborHoursTotal = 20;
    input.summary.bidPrice = -50;
    input.takeoffs.push({ ...input.takeoffs[0], id: "t-pending", status: "pending", source: "ai" });
    input.directCosts = [createDirectCost(100, "")];

    const result = bidPreflight(input);
    expect(result.ready).toBe(false);
    const blockerIds = result.blockers.map((c) => c.id);
    expect(blockerIds).toContain("save-error");
    expect(blockerIds).toContain("save-pending");
    expect(blockerIds).toContain("pending-ai");
    expect(blockerIds).toContain("labor-rate");
    expect(blockerIds).toContain("invalid-total");
    expect(blockerIds).toContain("unnamed-direct-cost");
  });

  it("aggregates all 6 warnings simultaneously and returns ready = true when zero blockers exist", () => {
    const input = createReadyInput();
    input.sheets = []; // 1. no-sheets
    input.project.overhead_pct = 0; // 2. zero-markup
    input.issues = [
      {
        layerId: "l1",
        layerName: "L1",
        quantity: 5,
        kind: "unit-mismatch",
        severity: "warning",
        detail: "Unit mismatch",
      },
    ]; // 3. estimate-warnings
    input.layers[0].typical_multiplier = 3;
    input.takeoffs.push({
      ...input.takeoffs[0],
      id: "cs-takeoff",
      layer_id: input.layers[0].id,
      sheet_id: "sheet-2",
      status: "confirmed",
    }); // 4. cross-sheet-typical
    input.lines.push(createEstimateLine(createDummyItem("mat-only", "MO-1", 10, 0), 1)); // 5. zero-labor-items
    input.lines.push(createEstimateLine(createDummyItem("lab-only", "LO-1", 0, 1), 1)); // 6. zero-material-items

    const result = bidPreflight(input);
    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
    const warningIds = result.warnings.map((c) => c.id);
    expect(warningIds).toContain("no-sheets");
    expect(warningIds).toContain("zero-markup");
    expect(warningIds).toContain("estimate-warnings");
    expect(warningIds).toContain("cross-sheet-typical");
    expect(warningIds).toContain("zero-labor-items");
    expect(warningIds).toContain("zero-material-items");
  });
});

describe("bidPreflight - Raw Input Integrity", () => {
  it.each([
    ["labor_rate", Number.NaN],
    ["waste_pct", -1],
    ["tax_pct", Number.POSITIVE_INFINITY],
    ["labor_factor_pct", -100],
    ["overhead_pct", -0.01],
    ["profit_pct", Number.NaN],
  ] as const)("blocks invalid project field %s", (field, value) => {
    const input = createReadyInput();
    input.project = { ...input.project, [field]: value };

    const result = bidPreflight(input);

    expect(result.ready).toBe(false);
    expect(result.blockers.map((check) => check.id)).toContain("invalid-commercial-input");
  });

  it("allows a negative labor factor that represents a productivity credit", () => {
    const input = createReadyInput();
    input.project = { ...input.project, labor_factor_pct: -10 };

    expect(bidPreflight(input).blockers.map((check) => check.id)).not.toContain(
      "invalid-commercial-input"
    );
  });

  it("blocks non-finite and negative direct costs", () => {
    const input = createReadyInput();
    input.directCosts = [createDirectCost(Number.NaN, "Bad quote"), createDirectCost(-1, "Credit")];

    expect(bidPreflight(input).blockers.map((check) => check.id)).toContain(
      "invalid-commercial-input"
    );
  });

  it.each([
    ["zero typical", { typical_multiplier: 0 }],
    ["non-finite typical", { typical_multiplier: Number.NaN }],
    ["negative rise/drop", { rise_drop_ft: -1 }],
    ["non-finite rise/drop", { rise_drop_ft: Number.POSITIVE_INFINITY }],
  ])("blocks %s layer inputs", (_label, patch) => {
    const input = createReadyInput();
    input.layers[0] = { ...input.layers[0], ...patch };

    expect(bidPreflight(input).blockers.map((check) => check.id)).toContain(
      "invalid-layer-input"
    );
  });

  it.each([
    ["non-finite quantity", { itemQty: Number.NaN }],
    ["negative quantity", { itemQty: -1 }],
    ["non-finite material", { material_cost: Number.NaN }],
    ["negative material", { material_cost: -1 }],
    ["non-finite labor", { labor_hours: Number.POSITIVE_INFINITY }],
    ["negative labor", { labor_hours: -0.1 }],
  ])("blocks %s on used catalog lines", (_label, patch) => {
    const input = createReadyInput();
    const line = input.lines[0];
    const values = patch as {
      itemQty?: number;
      material_cost?: number;
      labor_hours?: number;
    };
    const { itemQty, ...itemPatch } = values;
    input.lines[0] = {
      ...line,
      ...(itemQty !== undefined ? { itemQty } : {}),
      item: { ...line.item, ...itemPatch },
    };

    expect(bidPreflight(input).blockers.map((check) => check.id)).toContain(
      "invalid-catalog-input"
    );
  });

  it("blocks a saving state even if a malformed caller reports zero pending writes", () => {
    const input = createReadyInput();
    input.saveState = "saving";
    input.pendingWrites = 0;

    expect(bidPreflight(input).blockers.map((check) => check.id)).toContain("save-pending");
  });

  it("checks every major summary total, not only the displayed bid price", () => {
    const input = createReadyInput();
    input.summary = { ...input.summary, materialTotal: Number.NaN };

    expect(bidPreflight(input).blockers.map((check) => check.id)).toContain("invalid-total");
  });
});
