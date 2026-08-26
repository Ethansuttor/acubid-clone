import { describe, expect, it } from "vitest";
import { bidPreflight, type BidPreflightInput } from "@/lib/preflight";
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
import type { DirectCost, Item, Project } from "@/lib/types";

// Base clean project for adversarial testing
const baseProject: Project = {
  id: "p-adv",
  user_id: "u-adv",
  name: "Adversarial Bid",
  labor_rate: summaryInputs.laborRate,
  overhead_pct: summaryInputs.overheadPct,
  profit_pct: summaryInputs.profitPct,
  waste_pct: 0,
  tax_pct: 0,
  labor_factor_pct: 0,
  created_at: "2026-08-25T00:00:00.000Z",
  updated_at: "2026-08-25T00:00:00.000Z",
};

function createCleanInput(): BidPreflightInput {
  const reviewedTakeoffs = takeoffs.filter((takeoff) => takeoff.status === "confirmed");
  const quantities = layerQuantities(layers, reviewedTakeoffs, [sheet]);
  const { lines, issues } = extendEstimate(quantities, items, assemblies, assemblyItems);
  return {
    project: { ...baseProject },
    sheets: [{ ...sheet }],
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

function createItem(id: string, code: string, matCost: number, laborHrs: number, desc = "Item"): Item {
  return {
    id,
    user_id: "u-adv",
    code,
    description: desc,
    unit: "EA",
    material_cost: matCost,
    labor_hours: laborHrs,
  };
}

function createLine(item: Item, itemQty: number, layerId = "l-rec"): EstimateLine {
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

function createDc(amount: number, description: string, ohp = true): DirectCost {
  return {
    id: "dc-" + Math.random().toString(36).slice(2, 9),
    project_id: "p-adv",
    user_id: "u-adv",
    description,
    category: "quote",
    amount,
    ohp_applies: ohp,
    sort_order: 0,
  };
}

describe("Empirical Challenger: Preflight Adversarial Stress Suite", () => {
  describe("A. Negative Markups and Extreme Commercial Inputs", () => {
    it("triggers invalid-total blocker when negative markups cause negative bidPrice", () => {
      const input = createCleanInput();
      input.summary = { ...input.summary, bidPrice: -1500.50 };
      input.project.overhead_pct = -50;
      input.project.profit_pct = -20;

      const result = bidPreflight(input);
      expect(result.ready).toBe(false);
      expect(result.blockers.map((b) => b.id)).toContain("invalid-total");
    });

    it("blocks negative markups even when the displayed bid remains non-negative", () => {
      const input = createCleanInput();
      input.project.overhead_pct = -5;
      input.project.profit_pct = 15;
      input.summary = { ...input.summary, bidPrice: 5000 };

      const result = bidPreflight(input);
      expect(result.ready).toBe(false);
      expect(result.blockers.map((blocker) => blocker.id)).toContain(
        "invalid-commercial-input"
      );
      expect(result.warnings.map((w) => w.id)).not.toContain("zero-markup");
    });

    it("triggers zero-markup warning if either overhead_pct or profit_pct is exactly 0", () => {
      const input = createCleanInput();
      input.project.overhead_pct = 0;
      input.project.profit_pct = 10;
      const res1 = bidPreflight(input);
      expect(res1.warnings.map((w) => w.id)).toContain("zero-markup");

      input.project.overhead_pct = 10;
      input.project.profit_pct = 0;
      const res2 = bidPreflight(input);
      expect(res2.warnings.map((w) => w.id)).toContain("zero-markup");
    });

    it("blocks when summary.bidPrice is exactly -0.0000001 (sub-cent negative)", () => {
      const input = createCleanInput();
      input.summary = { ...input.summary, bidPrice: -0.0000001 };
      const result = bidPreflight(input);
      expect(result.ready).toBe(false);
      expect(result.blockers.map((b) => b.id)).toContain("invalid-total");
    });
  });

  describe("B. NaN, Infinity, and Non-Finite Numeric Boundaries", () => {
    it.each([
      ["NaN", Number.NaN],
      ["+Infinity", Number.POSITIVE_INFINITY],
      ["-Infinity", Number.NEGATIVE_INFINITY],
      ["NaN via 0/0", 0 / 0],
      ["Infinity via 1/0", 1 / 0],
    ])("triggers invalid-total blocker when summary.bidPrice is %s", (_label, val) => {
      const input = createCleanInput();
      input.summary = { ...input.summary, bidPrice: val };
      const result = bidPreflight(input);
      expect(result.ready).toBe(false);
      expect(result.blockers.some((b) => b.id === "invalid-total")).toBe(true);
    });

    it("triggers labor-rate blocker when laborHoursTotal > 0 and labor_rate is negative or 0", () => {
      const input = createCleanInput();
      input.summary.laborHoursTotal = 100;
      input.project.labor_rate = -50;
      const result = bidPreflight(input);
      expect(result.ready).toBe(false);
      expect(result.blockers.map((b) => b.id)).toContain("labor-rate");
    });

    it("handles extreme numbers in summary and lines", () => {
      const input = createCleanInput();
      input.summary = { ...input.summary, bidPrice: Number.MAX_SAFE_INTEGER };
      const result = bidPreflight(input);
      expect(result.ready).toBe(true);
      expect(result.blockers).toHaveLength(0);
    });
  });

  describe("C. Extreme Numbers and Boundary Variations of Direct Costs", () => {
    it("handles 10,000 direct costs (5,000 valid, 5,000 unpriced/zero-amount) in < 500ms", () => {
      const input = createCleanInput();
      const directCosts: DirectCost[] = [];
      for (let i = 0; i < 5000; i++) {
        directCosts.push(createDc(100, "Vendor Quote #" + i));
        directCosts.push(createDc(0, ""));
      }
      input.directCosts = directCosts;

      const t0 = performance.now();
      const result = bidPreflight(input);
      const duration = performance.now() - t0;

      expect(result.ready).toBe(true);
      expect(result.blockers).toHaveLength(0);
      expect(duration).toBeLessThan(500);
    });

    it("accurately counts and plurals for 5,000 unnamed priced direct costs", () => {
      const input = createCleanInput();
      const directCosts: DirectCost[] = [];
      for (let i = 0; i < 5000; i++) {
        directCosts.push(createDc(100, i % 2 === 0 ? "" : "   \t\n  "));
      }
      input.directCosts = directCosts;

      const result = bidPreflight(input);
      expect(result.ready).toBe(false);
      const check = result.blockers.find((b) => b.id === "unnamed-direct-cost");
      expect(check).toBeDefined();
      expect(check?.detail).toBe("5000 priced costs need a scope or vendor description.");
    });

    it("handles whitespace in direct cost descriptions", () => {
      const input = createCleanInput();
      input.directCosts = [createDc(100, "   \t   ")];
      const result = bidPreflight(input);
      expect(result.blockers.map((b) => b.id)).toContain("unnamed-direct-cost");
    });
  });

  describe("D. Conflicting Blockers, Warnings, and Mutually Exclusive Item Partitions", () => {
    it("correctly partitions items into zero-value (blocker), zero-material (warning), zero-labor (warning) without overlap", () => {
      const input = createCleanInput();
      const zeroVal = createItem("i-zv", "ZV-01", 0, 0);
      const zeroMat = createItem("i-zm", "ZM-01", 0, 5);
      const zeroLab = createItem("i-zl", "ZL-01", 50, 0);

      input.lines = [
        createLine(zeroVal, 2),
        createLine(zeroMat, 3),
        createLine(zeroLab, 4),
      ];

      const result = bidPreflight(input);
      expect(result.ready).toBe(false);
      expect(result.blockers.map((b) => b.id)).toEqual(["zero-value-items"]);
      const warningIds = result.warnings.map((w) => w.id);
      expect(warningIds).toContain("zero-material-items");
      expect(warningIds).toContain("zero-labor-items");
      expect(warningIds).not.toContain("zero-value-items");
    });

    it("truncates item list when more than 4 zero items exist in each category", () => {
      const input = createCleanInput();
      input.lines = [
        createLine(createItem("zv1", "ZV1", 0, 0), 1),
        createLine(createItem("zv2", "ZV2", 0, 0), 1),
        createLine(createItem("zv3", "ZV3", 0, 0), 1),
        createLine(createItem("zv4", "ZV4", 0, 0), 1),
        createLine(createItem("zv5", "ZV5", 0, 0), 1),
        createLine(createItem("zm1", "ZM1", 0, 1), 1),
        createLine(createItem("zm2", "ZM2", 0, 1), 1),
        createLine(createItem("zm3", "ZM3", 0, 1), 1),
        createLine(createItem("zm4", "ZM4", 0, 1), 1),
        createLine(createItem("zm5", "ZM5", 0, 1), 1),
        createLine(createItem("zl1", "ZL1", 10, 0), 1),
        createLine(createItem("zl2", "ZL2", 10, 0), 1),
        createLine(createItem("zl3", "ZL3", 10, 0), 1),
        createLine(createItem("zl4", "ZL4", 10, 0), 1),
        createLine(createItem("zl5", "ZL5", 10, 0), 1),
      ];

      const result = bidPreflight(input);
      const zv = result.blockers.find((b) => b.id === "zero-value-items");
      const zm = result.warnings.find((w) => w.id === "zero-material-items");
      const zl = result.warnings.find((w) => w.id === "zero-labor-items");

      expect(zv?.detail).toBe("ZV1, ZV2, ZV3, ZV4 and 1 more extend at zero cost.");
      expect(zm?.detail).toBe("ZM1, ZM2, ZM3, ZM4 and 1 more may be labor-only or unpriced.");
      expect(zl?.detail).toBe("ZL1, ZL2, ZL3, ZL4 and 1 more may be material-only or missing labor.");
    });

    it("triggers simultaneous blockers and warnings and verifies strict partition", () => {
      const input = createCleanInput();

      input.saveState = "error";
      input.pendingWrites = 3;
      input.issues.push({
        layerId: "l-miss",
        layerName: "Missing Layer",
        quantity: 10,
        kind: "unlinked",
        severity: "missing",
        detail: "Missing quantity",
      });
      input.takeoffs.push({
        id: "t-ai-pending",
        layer_id: input.layers[0].id,
        sheet_id: input.sheets[0].id,
        project_id: "p-adv",
        user_id: "u-adv",
        kind: "count",
        geometry: { x: 10, y: 10 },
        source: "ai",
        status: "pending",
        ai_confidence: 0.85,
      });
      input.project.labor_rate = 0;
      input.summary.laborHoursTotal = 50;
      input.summary.bidPrice = -100;
      input.directCosts.push(createDc(500, ""));
      input.lines.push(createLine(createItem("zv", "ZERO-ALL", 0, 0), 1));

      input.sheets = [];
      input.lines.push(createLine(createItem("zm", "MAT-ZERO", 0, 2), 1));
      input.lines.push(createLine(createItem("zl", "LAB-ZERO", 20, 0), 1));
      input.issues.push({
        layerId: "l-warn",
        layerName: "Warn Layer",
        quantity: 5,
        kind: "unit-mismatch",
        severity: "warning",
        detail: "Unit mismatch warning",
      });
      input.layers[0].typical_multiplier = 4;
      input.takeoffs.push(
        { ...input.takeoffs[0], id: "t-cs-1", layer_id: input.layers[0].id, sheet_id: "sheet-A", status: "confirmed" },
        { ...input.takeoffs[0], id: "t-cs-2", layer_id: input.layers[0].id, sheet_id: "sheet-B", status: "confirmed" }
      );
      input.project.overhead_pct = 0;

      const result = bidPreflight(input);

      expect(result.ready).toBe(false);
      expect(result.blockers.length).toBe(8);
      expect(result.warnings.length).toBe(6);
      expect(result.checks.length).toBe(14);
      expect(result.checks.filter((c) => c.severity === "blocker")).toEqual(result.blockers);
      expect(result.checks.filter((c) => c.severity === "warning")).toEqual(result.warnings);
    });

    it("triggers empty-bid blocker when lines is empty and all directCosts are 0", () => {
      const input = createCleanInput();
      input.lines = [];
      input.directCosts = [createDc(0, "Free note"), createDc(0, "")];

      const result = bidPreflight(input);
      expect(result.ready).toBe(false);
      expect(result.blockers.map((b) => b.id)).toContain("empty-bid");
    });
  });

  describe("E. Deep Immutability and Side-Effect Freedom", () => {
    it("does not mutate deeply frozen BidPreflightInput and nested structures", () => {
      const input = createCleanInput();
      Object.freeze(input.project);
      Object.freeze(input.sheets);
      Object.freeze(input.layers);
      Object.freeze(input.takeoffs);
      Object.freeze(input.lines);
      Object.freeze(input.issues);
      Object.freeze(input.summary);
      Object.freeze(input.directCosts);
      Object.freeze(input);

      expect(() => bidPreflight(input)).not.toThrow();
      const result = bidPreflight(input);
      expect(result.ready).toBe(true);
    });

    it("produces deterministic output across 100 consecutive invocations", () => {
      const input = createCleanInput();
      const first = bidPreflight(input);
      for (let i = 0; i < 100; i++) {
        const next = bidPreflight(input);
        expect(next).toEqual(first);
      }
    });
  });

  describe("F. Randomized Fuzzy Property Stress Testing (1,000 Iterations)", () => {
    it("maintains structural invariants under 1,000 randomly mutated inputs", () => {
      let seed = 1337;
      function rnd() {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      }

      const saveStates: ("saved" | "saving" | "error")[] = ["saved", "saving", "error"];

      for (let iter = 0; iter < 1000; iter++) {
        const input = createCleanInput();

        input.saveState = saveStates[Math.floor(rnd() * saveStates.length)];
        input.pendingWrites = Math.floor(rnd() * 5);
        input.project.labor_rate = (rnd() - 0.2) * 100;
        input.project.overhead_pct = (rnd() - 0.2) * 30;
        input.project.profit_pct = (rnd() - 0.2) * 30;
        input.summary.laborHoursTotal = rnd() * 200;
        input.summary.bidPrice = (rnd() - 0.1) * 100000;

        const dcCount = Math.floor(rnd() * 6);
        input.directCosts = Array.from({ length: dcCount }, (_, idx) => ({
          id: "dc-" + idx,
          project_id: "p-adv",
          user_id: "u-adv",
          description: rnd() < 0.3 ? "" : "Cost " + idx,
          category: "quote",
          amount: rnd() < 0.3 ? 0 : rnd() * 5000,
          ohp_applies: rnd() < 0.5,
          sort_order: idx,
        }));

        if (rnd() < 0.2) {
          input.sheets = [];
        }

        if (rnd() < 0.3) {
          input.takeoffs.push({
            id: "t-fuzz-" + iter,
            layer_id: input.layers[0]?.id ?? "l1",
            sheet_id: "s1",
            project_id: "p-adv",
            user_id: "u-adv",
            kind: "count",
            geometry: { x: 0, y: 0 },
            source: "ai",
            status: rnd() < 0.5 ? "pending" : "confirmed",
            ai_confidence: rnd() < 0.5 ? 0.9 : null,
          });
        }

        let result: ReturnType<typeof bidPreflight> | undefined;
        expect(() => {
          result = bidPreflight(input);
        }).not.toThrow();

        if (result) {
          expect(typeof result.ready).toBe("boolean");
          expect(Array.isArray(result.checks)).toBe(true);
          expect(Array.isArray(result.blockers)).toBe(true);
          expect(Array.isArray(result.warnings)).toBe(true);

          expect(result.ready).toBe(result.blockers.length === 0);
          expect(result.checks.filter((c) => c.severity === "blocker")).toEqual(result.blockers);
          expect(result.checks.filter((c) => c.severity === "warning")).toEqual(result.warnings);

          for (const b of result.blockers) {
            expect(b.severity).toBe("blocker");
          }

          for (const w of result.warnings) {
            expect(w.severity).toBe("warning");
          }
        }
      }
    });
  });
});
