import { describe, expect, it } from "vitest";
import { diagnoseCatalog } from "@/lib/catalogDiagnostics";
import {
  assemblies as fixtureAssemblies,
  assemblyItems as fixtureAssemblyItems,
  items as fixtureItems,
} from "./fixtures/fixture-project";
import type { Assembly, AssemblyItem, Item } from "@/lib/types";

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: `item-${Math.random().toString(36).slice(2, 9)}`,
    user_id: "u1",
    code: "ITEM-01",
    description: "Sample Item",
    unit: "EA",
    material_cost: 10.0,
    labor_hours: 0.5,
    ...overrides,
  };
}

function makeAssembly(overrides: Partial<Assembly> = {}): Assembly {
  return {
    id: `asm-${Math.random().toString(36).slice(2, 9)}`,
    user_id: "u1",
    code: "ASM-01",
    name: "Sample Assembly",
    description: "Sample Assembly Description",
    ...overrides,
  };
}

function makeAssemblyItem(overrides: Partial<AssemblyItem> = {}): AssemblyItem {
  return {
    id: `ai-${Math.random().toString(36).slice(2, 9)}`,
    assembly_id: "asm-1",
    item_id: "item-1",
    user_id: "u1",
    quantity: 1,
    ...overrides,
  };
}

describe("diagnoseCatalog", () => {
  describe("1. Clean and empty catalogs", () => {
    it("returns healthy report with zero counts and empty issues for empty input arrays", () => {
      const report = diagnoseCatalog([], [], []);
      expect(report.healthy).toBe(true);
      expect(report.issues).toEqual([]);
      expect(report.summary).toEqual({
        totalItems: 0,
        totalAssemblies: 0,
        totalAssemblyItems: 0,
        zeroCostCount: 0,
        zeroLaborCount: 0,
        duplicateItemCodeCount: 0,
        duplicateAssemblyCodeCount: 0,
        emptyAssemblyCount: 0,
        missingComponentCount: 0,
      });
    });

    it("evaluates a standard valid catalog as healthy with 0 defects", () => {
      const report = diagnoseCatalog(fixtureItems, fixtureAssemblies, fixtureAssemblyItems);
      expect(report.healthy).toBe(true);
      expect(report.issues).toHaveLength(0);
      expect(report.summary.totalItems).toBe(fixtureItems.length);
      expect(report.summary.totalAssemblies).toBe(fixtureAssemblies.length);
      expect(report.summary.totalAssemblyItems).toBe(fixtureAssemblyItems.length);
      expect(report.summary.zeroCostCount).toBe(0);
      expect(report.summary.zeroLaborCount).toBe(0);
      expect(report.summary.duplicateItemCodeCount).toBe(0);
      expect(report.summary.duplicateAssemblyCodeCount).toBe(0);
      expect(report.summary.emptyAssemblyCount).toBe(0);
      expect(report.summary.missingComponentCount).toBe(0);
    });
  });

  describe("2. Zero cost and zero labor items", () => {
    it("flags an item with zero material cost as zero-cost-item warning", () => {
      const item = makeItem({ id: "i1", code: "C-01", material_cost: 0, labor_hours: 0.5 });
      const report = diagnoseCatalog([item], [], []);
      expect(report.healthy).toBe(false);
      expect(report.summary.zeroCostCount).toBe(1);
      expect(report.summary.zeroLaborCount).toBe(0);
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          kind: "zero-cost-item",
          severity: "warning",
          itemId: "i1",
          code: "C-01",
        })
      );
    });

    it("flags an item with negative material cost as zero-cost-item", () => {
      const item = makeItem({ id: "i1", code: "C-NEG", material_cost: -2.5, labor_hours: 0.5 });
      const report = diagnoseCatalog([item], [], []);
      expect(report.summary.zeroCostCount).toBe(1);
      expect(report.issues.some((i) => i.kind === "zero-cost-item")).toBe(true);
    });

    it("flags an item with NaN material cost as zero-cost-item", () => {
      const item = makeItem({ id: "i1", code: "C-NAN", material_cost: Number.NaN, labor_hours: 0.5 });
      const report = diagnoseCatalog([item], [], []);
      expect(report.summary.zeroCostCount).toBe(1);
      expect(report.issues.some((i) => i.kind === "zero-cost-item")).toBe(true);
    });

    it("flags an item with zero labor hours as zero-labor-item warning", () => {
      const item = makeItem({ id: "i2", code: "L-01", material_cost: 5.0, labor_hours: 0 });
      const report = diagnoseCatalog([item], [], []);
      expect(report.healthy).toBe(false);
      expect(report.summary.zeroCostCount).toBe(0);
      expect(report.summary.zeroLaborCount).toBe(1);
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          kind: "zero-labor-item",
          severity: "warning",
          itemId: "i2",
          code: "L-01",
        })
      );
    });

    it("flags an item with negative labor hours as zero-labor-item", () => {
      const item = makeItem({ id: "i2", code: "L-NEG", material_cost: 5.0, labor_hours: -0.1 });
      const report = diagnoseCatalog([item], [], []);
      expect(report.summary.zeroLaborCount).toBe(1);
      expect(report.issues.some((i) => i.kind === "zero-labor-item")).toBe(true);
    });

    it("flags an item with NaN labor hours as zero-labor-item", () => {
      const item = makeItem({ id: "i2", code: "L-NAN", material_cost: 5.0, labor_hours: Number.NaN });
      const report = diagnoseCatalog([item], [], []);
      expect(report.summary.zeroLaborCount).toBe(1);
      expect(report.issues.some((i) => i.kind === "zero-labor-item")).toBe(true);
    });

    it("flags an item with both zero cost and zero labor with two distinct issues", () => {
      const item = makeItem({ id: "i3", code: "BOTH-0", material_cost: 0, labor_hours: 0 });
      const report = diagnoseCatalog([item], [], []);
      expect(report.summary.zeroCostCount).toBe(1);
      expect(report.summary.zeroLaborCount).toBe(1);
      expect(report.issues).toHaveLength(2);
      expect(report.issues.map((i) => i.kind)).toEqual(
        expect.arrayContaining(["zero-cost-item", "zero-labor-item"])
      );
    });

    it("does not flag items with positive fractional costs or labor", () => {
      const item = makeItem({ material_cost: 0.005, labor_hours: 0.0001 });
      const report = diagnoseCatalog([item], [], []);
      expect(report.healthy).toBe(true);
      expect(report.summary.zeroCostCount).toBe(0);
      expect(report.summary.zeroLaborCount).toBe(0);
    });
  });

  describe("3. Duplicate item codes", () => {
    it("detects exact match duplicate item codes", () => {
      const item1 = makeItem({ id: "i1", code: "EMT-050" });
      const item2 = makeItem({ id: "i2", code: "EMT-050" });
      const report = diagnoseCatalog([item1, item2], [], []);
      expect(report.healthy).toBe(false);
      expect(report.summary.duplicateItemCodeCount).toBe(2);
      expect(report.issues.filter((i) => i.kind === "duplicate-item-code")).toHaveLength(2);
      expect(report.issues.every((i) => i.severity === "error")).toBe(true);
    });

    it("detects case-insensitive duplicate item codes", () => {
      const item1 = makeItem({ id: "i1", code: "EMT-12" });
      const item2 = makeItem({ id: "i2", code: "emt-12" });
      const report = diagnoseCatalog([item1, item2], [], []);
      expect(report.summary.duplicateItemCodeCount).toBe(2);
      expect(report.issues.filter((i) => i.kind === "duplicate-item-code")).toHaveLength(2);
    });

    it("detects duplicate item codes with whitespace padding", () => {
      const item1 = makeItem({ id: "i1", code: "  EMT-12  " });
      const item2 = makeItem({ id: "i2", code: "EMT-12" });
      const report = diagnoseCatalog([item1, item2], [], []);
      expect(report.summary.duplicateItemCodeCount).toBe(2);
      expect(report.issues.filter((i) => i.kind === "duplicate-item-code")).toHaveLength(2);
    });

    it("ignores blank and whitespace-only item codes", () => {
      const item1 = makeItem({ id: "i1", code: "" });
      const item2 = makeItem({ id: "i2", code: "   " });
      const report = diagnoseCatalog([item1, item2], [], []);
      expect(report.summary.duplicateItemCodeCount).toBe(0);
      expect(report.issues.filter((i) => i.kind === "duplicate-item-code")).toHaveLength(0);
    });

    it("handles tri-duplicate items sharing a code", () => {
      const items = [
        makeItem({ id: "i1", code: "BOX-4S" }),
        makeItem({ id: "i2", code: "box-4s" }),
        makeItem({ id: "i3", code: " BOX-4S " }),
      ];
      const report = diagnoseCatalog(items, [], []);
      expect(report.summary.duplicateItemCodeCount).toBe(3);
      expect(report.issues.filter((i) => i.kind === "duplicate-item-code")).toHaveLength(3);
    });
  });

  describe("4. Duplicate assembly codes", () => {
    it("detects exact match duplicate assembly codes", () => {
      const asm1 = makeAssembly({ id: "a1", code: "A-REC" });
      const asm2 = makeAssembly({ id: "a2", code: "A-REC" });
      const report = diagnoseCatalog([], [asm1, asm2], []);
      expect(report.healthy).toBe(false);
      expect(report.summary.duplicateAssemblyCodeCount).toBe(2);
      expect(report.issues.filter((i) => i.kind === "duplicate-assembly-code")).toHaveLength(2);
      expect(report.issues.every((i) => i.severity === "error")).toBe(true);
    });

    it("detects case-insensitive and whitespace-padded assembly code duplicates", () => {
      const asm1 = makeAssembly({ id: "a1", code: "A-REC" });
      const asm2 = makeAssembly({ id: "a2", code: " a-rec " });
      const report = diagnoseCatalog([], [asm1, asm2], []);
      expect(report.summary.duplicateAssemblyCodeCount).toBe(2);
      expect(report.issues.filter((i) => i.kind === "duplicate-assembly-code")).toHaveLength(2);
    });

    it("ignores blank and whitespace-only assembly codes", () => {
      const asm1 = makeAssembly({ id: "a1", code: "" });
      const asm2 = makeAssembly({ id: "a2", code: "  " });
      const report = diagnoseCatalog([], [asm1, asm2], []);
      expect(report.summary.duplicateAssemblyCodeCount).toBe(0);
    });
  });

  describe("5. Empty assemblies", () => {
    it("flags an assembly with 0 assembly items as empty-assembly", () => {
      const asm = makeAssembly({ id: "a-empty", code: "A-EMPTY" });
      const report = diagnoseCatalog([], [asm], []);
      expect(report.healthy).toBe(false);
      expect(report.summary.emptyAssemblyCount).toBe(1);
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          kind: "empty-assembly",
          severity: "error",
          assemblyId: "a-empty",
          code: "A-EMPTY",
        })
      );
    });

    it("does not flag an assembly that has at least one component item", () => {
      const item = makeItem({ id: "i1" });
      const asm = makeAssembly({ id: "a1" });
      const ai = makeAssemblyItem({ id: "ai1", assembly_id: "a1", item_id: "i1" });
      const report = diagnoseCatalog([item], [asm], [ai]);
      expect(report.summary.emptyAssemblyCount).toBe(0);
      expect(report.issues.some((i) => i.kind === "empty-assembly")).toBe(false);
    });

    it("correctly differentiates populated vs empty assemblies in mixed sets", () => {
      const item = makeItem({ id: "i1" });
      const asmPop = makeAssembly({ id: "a-pop" });
      const asmEmpty1 = makeAssembly({ id: "a-emp1" });
      const asmEmpty2 = makeAssembly({ id: "a-emp2" });
      const ai = makeAssemblyItem({ id: "ai1", assembly_id: "a-pop", item_id: "i1" });
      const report = diagnoseCatalog([item], [asmPop, asmEmpty1, asmEmpty2], [ai]);
      expect(report.summary.totalAssemblies).toBe(3);
      expect(report.summary.emptyAssemblyCount).toBe(2);
    });
  });

  describe("6. Dangling / Missing component references", () => {
    it("flags assemblyItem referencing a non-existent item_id as missing-component-item", () => {
      const asm = makeAssembly({ id: "a1" });
      const ai = makeAssemblyItem({ id: "ai1", assembly_id: "a1", item_id: "missing-item-id" });
      const report = diagnoseCatalog([], [asm], [ai]);
      expect(report.healthy).toBe(false);
      expect(report.summary.missingComponentCount).toBe(1);
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          kind: "missing-component-item",
          severity: "error",
          assemblyId: "a1",
          assemblyItemId: "ai1",
          itemId: "missing-item-id",
        })
      );
    });

    it("flags assemblyItem referencing a non-existent assembly_id as missing-component-assembly", () => {
      const item = makeItem({ id: "i1" });
      const ai = makeAssemblyItem({ id: "ai1", assembly_id: "missing-asm-id", item_id: "i1" });
      const report = diagnoseCatalog([item], [], [ai]);
      expect(report.healthy).toBe(false);
      expect(report.summary.missingComponentCount).toBe(1);
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          kind: "missing-component-assembly",
          severity: "error",
          assemblyId: "missing-asm-id",
          assemblyItemId: "ai1",
        })
      );
    });

    it("flags both missing assembly and missing item when both references are broken", () => {
      const ai = makeAssemblyItem({ id: "ai-broken", assembly_id: "no-asm", item_id: "no-item" });
      const report = diagnoseCatalog([], [], [ai]);
      expect(report.summary.missingComponentCount).toBe(2);
      expect(report.issues.map((i) => i.kind)).toEqual(
        expect.arrayContaining(["missing-component-assembly", "missing-component-item"])
      );
    });
  });

  describe("7. Combined messy catalog scenario", () => {
    it("accurately captures all defect categories simultaneously in a complex corrupted catalog", () => {
      const items: Item[] = [
        makeItem({ id: "i-clean", code: "CLEAN-01", material_cost: 12.5, labor_hours: 0.25 }),
        makeItem({ id: "i-nocost", code: "NO-COST", material_cost: 0, labor_hours: 0.5 }),
        makeItem({ id: "i-nolabor", code: "NO-LABOR", material_cost: 15.0, labor_hours: 0 }),
        makeItem({ id: "i-dup1", code: "DUP-ITEM", material_cost: 10.0, labor_hours: 0.2 }),
        makeItem({ id: "i-dup2", code: " dup-item ", material_cost: 0, labor_hours: 0 }),
      ];

      const assemblies: Assembly[] = [
        makeAssembly({ id: "a-valid", code: "A-VALID" }),
        makeAssembly({ id: "a-empty", code: "A-EMPTY" }),
        makeAssembly({ id: "a-dup1", code: "A-DUP" }),
        makeAssembly({ id: "a-dup2", code: "a-dup" }),
      ];

      const assemblyItems: AssemblyItem[] = [
        makeAssemblyItem({ id: "ai-1", assembly_id: "a-valid", item_id: "i-clean", quantity: 2 }),
        makeAssemblyItem({ id: "ai-2", assembly_id: "a-valid", item_id: "i-nocost", quantity: 1 }),
        makeAssemblyItem({ id: "ai-3", assembly_id: "a-dup1", item_id: "i-dup1", quantity: 1 }),
        makeAssemblyItem({ id: "ai-dangling-item", assembly_id: "a-valid", item_id: "i-deleted", quantity: 1 }),
        makeAssemblyItem({ id: "ai-dangling-asm", assembly_id: "a-deleted", item_id: "i-clean", quantity: 1 }),
      ];

      const report = diagnoseCatalog(items, assemblies, assemblyItems);

      expect(report.healthy).toBe(false);
      expect(report.summary).toEqual({
        totalItems: 5,
        totalAssemblies: 4,
        totalAssemblyItems: 5,
        zeroCostCount: 2,
        zeroLaborCount: 2,
        duplicateItemCodeCount: 2,
        duplicateAssemblyCodeCount: 2,
        emptyAssemblyCount: 2,
        missingComponentCount: 2,
      });

      expect(report.issues).toHaveLength(12);
    });
  });

  describe("8. Pure function and immutability invariants", () => {
    it("does not mutate input collections or objects", () => {
      const items = [makeItem({ id: "i1", code: "I1" })];
      const assemblies = [makeAssembly({ id: "a1", code: "A1" })];
      const assemblyItems = [makeAssemblyItem({ id: "ai1", assembly_id: "a1", item_id: "i1" })];

      const itemsSnapshot = JSON.stringify(items);
      const assembliesSnapshot = JSON.stringify(assemblies);
      const assemblyItemsSnapshot = JSON.stringify(assemblyItems);

      diagnoseCatalog(items, assemblies, assemblyItems);

      expect(JSON.stringify(items)).toBe(itemsSnapshot);
      expect(JSON.stringify(assemblies)).toBe(assembliesSnapshot);
      expect(JSON.stringify(assemblyItems)).toBe(assemblyItemsSnapshot);
    });

    it("is strictly deterministic across repeated invocations", () => {
      const items = [makeItem({ id: "i1", material_cost: 0, code: "X" })];
      const r1 = diagnoseCatalog(items, [], []);
      const r2 = diagnoseCatalog(items, [], []);
      expect(r1).toEqual(r2);
    });
  });

  describe("9. Performance scaling", () => {
    it("efficiently processes 10,000 items and 2,000 assemblies in linear time", () => {
      const largeItems: Item[] = [];
      for (let i = 0; i < 10000; i++) {
        largeItems.push(
          makeItem({
            id: `item-${i}`,
            code: `CODE-${i}`,
            material_cost: i + 1,
            labor_hours: 0.1,
          })
        );
      }

      const largeAssemblies: Assembly[] = [];
      const largeAssemblyItems: AssemblyItem[] = [];
      for (let j = 0; j < 2000; j++) {
        const asmId = `asm-${j}`;
        largeAssemblies.push(makeAssembly({ id: asmId, code: `ASM-${j}` }));
        largeAssemblyItems.push(
          makeAssemblyItem({
            id: `ai-${j}`,
            assembly_id: asmId,
            item_id: `item-${j}`,
          })
        );
      }

      const start = performance.now();
      const report = diagnoseCatalog(largeItems, largeAssemblies, largeAssemblyItems);
      const duration = performance.now() - start;

      expect(report.healthy).toBe(true);
      expect(report.summary.totalItems).toBe(10000);
      expect(report.summary.totalAssemblies).toBe(2000);
      expect(report.summary.totalAssemblyItems).toBe(2000);
      expect(duration).toBeLessThan(1000);
    });
  });
});
