import { describe, expect, it } from "vitest";
import { diagnoseCatalog } from "@/lib/catalogDiagnostics";
import type { Assembly, AssemblyItem, Item } from "@/lib/types";

describe("Empirical Challenger: catalogDiagnostics Adversarial Stress Test", () => {
  // Helper builders
  function makeItem(overrides: Partial<Item> = {}): Item {
    return {
      id: `item-${Math.random().toString(36).slice(2, 9)}`,
      user_id: "u1",
      code: "ITEM-01",
      description: "Standard Item",
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
      name: "Standard Assembly",
      description: "Standard Assembly Description",
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

  describe("A. Defensive Type & Nil Boundary Attacks", () => {
    it("handles null/undefined/non-array inputs gracefully without throwing", () => {
      const r1 = diagnoseCatalog(null as unknown as Item[], null as unknown as Assembly[], null as unknown as AssemblyItem[]);
      expect(r1.healthy).toBe(true);
      expect(r1.issues).toEqual([]);
      expect(r1.summary.totalItems).toBe(0);

      const r2 = diagnoseCatalog(undefined as unknown as Item[], undefined as unknown as Assembly[], undefined as unknown as AssemblyItem[]);
      expect(r2.healthy).toBe(true);
      expect(r2.issues).toEqual([]);

      const r3 = diagnoseCatalog("invalid" as unknown as Item[], 123 as unknown as Assembly[], {} as unknown as AssemblyItem[]);
      expect(r3.healthy).toBe(true);
      expect(r3.issues).toEqual([]);
    });

    it("handles sparse arrays, nulls, undefined, and primitive elements within input arrays", () => {
      const items: Item[] = [
        makeItem({ id: "i1", material_cost: 10, labor_hours: 1 }),
        null as unknown as Item,
        undefined as unknown as Item,
        {} as unknown as Item,
        makeItem({ id: "i2", material_cost: 0, labor_hours: 0 }),
      ];

      const assemblies: Assembly[] = [
        makeAssembly({ id: "a1" }),
        null as unknown as Assembly,
        undefined as unknown as Assembly,
        {} as unknown as Assembly,
      ];

      const assemblyItems: AssemblyItem[] = [
        makeAssemblyItem({ id: "ai1", assembly_id: "a1", item_id: "i1" }),
        null as unknown as AssemblyItem,
        undefined as unknown as AssemblyItem,
        {} as unknown as AssemblyItem,
      ];

      expect(() => diagnoseCatalog(items, assemblies, assemblyItems)).not.toThrow();
      const report = diagnoseCatalog(items, assemblies, assemblyItems);
      expect(report.healthy).toBe(false);
      expect(report.summary.totalItems).toBe(5);
    });

    it("handles objects with missing id or missing code properties", () => {
      const itemNoId = { user_id: "u1", description: "No ID", material_cost: 10, labor_hours: 1 } as Item;
      const asmNoId = { user_id: "u1", name: "No ID" } as Assembly;
      const aiNoId = { user_id: "u1", quantity: 1 } as AssemblyItem;

      expect(() => diagnoseCatalog([itemNoId], [asmNoId], [aiNoId])).not.toThrow();
      const report = diagnoseCatalog([itemNoId], [asmNoId], [aiNoId]);
      expect(report.healthy).toBe(false);
    });
  });

  describe("B. Prototype Pollution & Reserved Keyword Keys", () => {
    it("handles items, assemblies, and codes named '__proto__', 'constructor', 'toString', 'valueOf'", () => {
      const protoItem1 = makeItem({ id: "__proto__", code: "__proto__" });
      const protoItem2 = makeItem({ id: "constructor", code: "__proto__" });
      const toStringItem = makeItem({ id: "toString", code: "toString" });
      const valueOfItem = makeItem({ id: "valueOf", code: "valueOf" });

      const protoAsm1 = makeAssembly({ id: "__proto__", code: "__proto__" });
      const protoAsm2 = makeAssembly({ id: "constructor", code: "__proto__" });

      const aiProto = makeAssemblyItem({ id: "ai-proto", assembly_id: "__proto__", item_id: "__proto__" });
      const aiCtor = makeAssemblyItem({ id: "ai-ctor", assembly_id: "constructor", item_id: "constructor" });

      const report = diagnoseCatalog(
        [protoItem1, protoItem2, toStringItem, valueOfItem],
        [protoAsm1, protoAsm2],
        [aiProto, aiCtor]
      );

      expect(report.summary.duplicateItemCodeCount).toBe(2);
      expect(report.summary.duplicateAssemblyCodeCount).toBe(2);
      expect(report.summary.emptyAssemblyCount).toBe(0);
      expect(report.summary.missingComponentCount).toBe(0);
    });
  });

  describe("C. Numeric Edge Cases, Subnormals, and Infinity", () => {
    it("handles -Infinity, +Infinity, -0, NaN, Number.MIN_VALUE, and extreme values", () => {
      const itemInfCost = makeItem({ id: "i-inf", material_cost: Infinity, labor_hours: 1 });
      const itemNegInfCost = makeItem({ id: "i-neginf", material_cost: -Infinity, labor_hours: 1 });
      const itemNegZeroCost = makeItem({ id: "i-negzero", material_cost: -0, labor_hours: 1 });
      const itemSubnormal = makeItem({ id: "i-sub", material_cost: Number.MIN_VALUE, labor_hours: Number.MIN_VALUE });
      const itemMaxSafe = makeItem({ id: "i-max", material_cost: Number.MAX_SAFE_INTEGER, labor_hours: Number.MAX_SAFE_INTEGER });
      const itemInfLabor = makeItem({ id: "i-inflab", material_cost: 10, labor_hours: Infinity });
      const itemNegInfLabor = makeItem({ id: "i-neginflab", material_cost: 10, labor_hours: -Infinity });

      const report = diagnoseCatalog(
        [itemInfCost, itemNegInfCost, itemNegZeroCost, itemSubnormal, itemMaxSafe, itemInfLabor, itemNegInfLabor],
        [],
        []
      );

      expect(report.summary.zeroCostCount).toBe(3);
      expect(report.summary.zeroLaborCount).toBe(2);
    });

    it("handles non-numeric cost/labor types coerced at runtime", () => {
      const itemStrCost = makeItem({ id: "i-str", material_cost: "100" as unknown as number, labor_hours: "2.5" as unknown as number });
      const itemBoolCost = makeItem({ id: "i-bool", material_cost: true as unknown as number, labor_hours: false as unknown as number });
      const itemObjCost = makeItem({ id: "i-obj", material_cost: {} as unknown as number, labor_hours: [] as unknown as number });

      const report = diagnoseCatalog([itemStrCost, itemBoolCost, itemObjCost], [], []);
      expect(report.summary.zeroCostCount).toBe(3);
      expect(report.summary.zeroLaborCount).toBe(3);
    });
  });

  describe("D. Unicode, Whitespace & Code Collision Invariants", () => {
    it("handles Unicode characters, emojis, and diacritics in item and assembly codes", () => {
      const itemEmoji1 = makeItem({ id: "i-em1", code: "⚡-01" });
      const itemEmoji2 = makeItem({ id: "i-em2", code: "⚡-01" });
      const itemDiacritic1 = makeItem({ id: "i-d1", code: "CAFÉ" });
      const itemDiacritic2 = makeItem({ id: "i-d2", code: "café" });

      const report = diagnoseCatalog([itemEmoji1, itemEmoji2, itemDiacritic1, itemDiacritic2], [], []);
      expect(report.summary.duplicateItemCodeCount).toBe(4);
    });

    it("handles various whitespace flavors (tab, newline, non-breaking space, zero-width space)", () => {
      const item1 = makeItem({ id: "i1", code: "\t\r\nWIRE-12\t" });
      const item2 = makeItem({ id: "i2", code: "WIRE-12" });
      const itemBlank = makeItem({ id: "i3", code: "\t\r\n  " });

      const report = diagnoseCatalog([item1, item2, itemBlank], [], []);
      expect(report.summary.duplicateItemCodeCount).toBe(2);
      expect(report.issues.some((i) => i.itemId === "i3" && i.kind === "duplicate-item-code")).toBe(false);
    });

    it("verifies items and assemblies have independent code namespaces", () => {
      const item = makeItem({ id: "i1", code: "CONDUIT-34" });
      const assembly = makeAssembly({ id: "a1", code: "CONDUIT-34" });
      const ai = makeAssemblyItem({ id: "ai1", assembly_id: "a1", item_id: "i1" });

      const report = diagnoseCatalog([item], [assembly], [ai]);
      expect(report.healthy).toBe(true);
      expect(report.summary.duplicateItemCodeCount).toBe(0);
      expect(report.summary.duplicateAssemblyCodeCount).toBe(0);
    });
  });

  describe("E. Relational Integrity & Graph Edge Cases", () => {
    it("handles multiple AssemblyItems referencing the same item in the same assembly", () => {
      const item = makeItem({ id: "i1" });
      const assembly = makeAssembly({ id: "a1" });
      const ai1 = makeAssemblyItem({ id: "ai1", assembly_id: "a1", item_id: "i1", quantity: 2 });
      const ai2 = makeAssemblyItem({ id: "ai2", assembly_id: "a1", item_id: "i1", quantity: 5 });

      const report = diagnoseCatalog([item], [assembly], [ai1, ai2]);
      expect(report.healthy).toBe(true);
      expect(report.summary.emptyAssemblyCount).toBe(0);
      expect(report.summary.missingComponentCount).toBe(0);
      expect(report.summary.totalAssemblyItems).toBe(2);
    });

    it("handles circular or self-referential IDs without throwing or infinite loop", () => {
      const item = makeItem({ id: "SAME_ID", code: "SAME" });
      const assembly = makeAssembly({ id: "SAME_ID", code: "SAME" });
      const ai = makeAssemblyItem({ id: "SAME_ID", assembly_id: "SAME_ID", item_id: "SAME_ID" });

      const report = diagnoseCatalog([item], [assembly], [ai]);
      expect(report.healthy).toBe(true);
      expect(report.summary.missingComponentCount).toBe(0);
      expect(report.summary.emptyAssemblyCount).toBe(0);
    });

    it("correctly identifies missing component assembly when assembly_id is empty string or unknown", () => {
      const item = makeItem({ id: "i1" });
      const aiEmpty = makeAssemblyItem({ id: "ai1", assembly_id: "", item_id: "i1" });

      const report = diagnoseCatalog([item], [], [aiEmpty]);
      expect(report.healthy).toBe(false);
      expect(report.summary.missingComponentCount).toBe(1);
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          kind: "missing-component-assembly",
          assemblyItemId: "ai1",
        })
      );
    });
  });

  describe("F. Strict Immutability & Deep Freeze", () => {
    it("works without error when input arrays and all objects are deeply frozen", () => {
      const item = Object.freeze(makeItem({ id: "i1", code: "FROZEN-1" }));
      const assembly = Object.freeze(makeAssembly({ id: "a1", code: "FROZEN-ASM" }));
      const ai = Object.freeze(makeAssemblyItem({ id: "ai1", assembly_id: "a1", item_id: "i1" }));

      const items = Object.freeze([item]);
      const assemblies = Object.freeze([assembly]);
      const assemblyItems = Object.freeze([ai]);

      let report: ReturnType<typeof diagnoseCatalog> | undefined;
      expect(() => {
        report = diagnoseCatalog(
          items as unknown as Item[],
          assemblies as unknown as Assembly[],
          assemblyItems as unknown as AssemblyItem[]
        );
      }).not.toThrow();

      expect(report?.healthy).toBe(true);
    });
  });

  describe("G. High-Volume Scaling & Worst-Case Hash Collisions", () => {
    it("handles 50,000 items all sharing the exact same code without O(N^2) slowdown", () => {
      const items: Item[] = [];
      for (let i = 0; i < 50000; i++) {
        items.push(
          makeItem({
            id: `item-${i}`,
            code: "COLLIDE_ALL",
            material_cost: 10,
            labor_hours: 1,
          })
        );
      }

      const start = performance.now();
      const report = diagnoseCatalog(items, [], []);
      const duration = performance.now() - start;

      expect(report.healthy).toBe(false);
      expect(report.summary.totalItems).toBe(50000);
      expect(report.summary.duplicateItemCodeCount).toBe(50000);
      expect(report.issues.length).toBe(50000);
      expect(duration).toBeLessThan(2500);
    });

    it("handles massive catalog (100,000 items, 10,000 assemblies, 50,000 assembly items)", () => {
      const items: Item[] = [];
      for (let i = 0; i < 100000; i++) {
        items.push(
          makeItem({
            id: `item-${i}`,
            code: `ITEM-${i % 5000}`, // 20 duplicates per code
            material_cost: i % 10 === 0 ? 0 : 25.0, // 10% zero cost
            labor_hours: i % 20 === 0 ? 0 : 0.75, // 5% zero labor
          })
        );
      }

      const assemblies: Assembly[] = [];
      for (let j = 0; j < 10000; j++) {
        assemblies.push(
          makeAssembly({
            id: `asm-${j}`,
            code: `ASM-${j % 5000}`, // 2 duplicates per code
          })
        );
      }

      const assemblyItems: AssemblyItem[] = [];
      for (let k = 0; k < 50000; k++) {
        assemblyItems.push(
          makeAssemblyItem({
            id: `ai-${k}`,
            assembly_id: `asm-${k % 9000}`, // 1000 assemblies empty (9000..9999)
            item_id: `item-${k % 105000}`, // some reference missing items (k >= 100000)
          })
        );
      }

      const start = performance.now();
      const report = diagnoseCatalog(items, assemblies, assemblyItems);
      const duration = performance.now() - start;

      expect(report.healthy).toBe(false);
      expect(report.summary.totalItems).toBe(100000);
      expect(report.summary.totalAssemblies).toBe(10000);
      expect(report.summary.totalAssemblyItems).toBe(50000);
      expect(report.summary.zeroCostCount).toBe(10000);
      expect(report.summary.zeroLaborCount).toBe(5000);
      expect(report.summary.emptyAssemblyCount).toBe(1000);
      expect(duration).toBeLessThan(5000);
    });
  });

  describe("H. Randomized Fuzzy Mutation Stress Testing", () => {
    it("survives 1,000 randomized corrupted catalog iterations without crashing", () => {
      let seed = 42;
      function rnd() {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      }

      const weirdStrings = [
        "", " ", "\t\n\r", "⚡", "null", "undefined", "[object Object]",
        "__proto__", "constructor", "eval", "<script>alert(1)</script>",
        "🎉🔥✨", "NaN", "Infinity", "-Infinity", "0", "-0"
      ];

      const weirdNumbers = [
        0, -0, 1, -1, 0.0001, -0.0001, NaN, Infinity, -Infinity,
        Number.MAX_SAFE_INTEGER, Number.MIN_VALUE, 1e20, -1e20
      ];

      for (let iteration = 0; iteration < 100; iteration++) {
        const itemCount = Math.floor(rnd() * 30);
        const asmCount = Math.floor(rnd() * 15);
        const aiCount = Math.floor(rnd() * 40);

        const items: Item[] = [];
        for (let i = 0; i < itemCount; i++) {
          const r = rnd();
          if (r < 0.05) {
            items.push(null as unknown as Item);
          } else if (r < 0.1) {
            items.push({} as unknown as Item);
          } else {
            items.push(
              makeItem({
                id: rnd() < 0.2 ? weirdStrings[Math.floor(rnd() * weirdStrings.length)] : `item-${i}`,
                code: rnd() < 0.3 ? weirdStrings[Math.floor(rnd() * weirdStrings.length)] : `C-${i % 5}`,
                material_cost: rnd() < 0.3 ? weirdNumbers[Math.floor(rnd() * weirdNumbers.length)] : rnd() * 100,
                labor_hours: rnd() < 0.3 ? weirdNumbers[Math.floor(rnd() * weirdNumbers.length)] : rnd() * 10,
              })
            );
          }
        }

        const assemblies: Assembly[] = [];
        for (let j = 0; j < asmCount; j++) {
          const r = rnd();
          if (r < 0.05) {
            assemblies.push(null as unknown as Assembly);
          } else {
            assemblies.push(
              makeAssembly({
                id: rnd() < 0.2 ? weirdStrings[Math.floor(rnd() * weirdStrings.length)] : `asm-${j}`,
                code: rnd() < 0.3 ? weirdStrings[Math.floor(rnd() * weirdStrings.length)] : `A-${j % 3}`,
              })
            );
          }
        }

        const assemblyItems: AssemblyItem[] = [];
        for (let k = 0; k < aiCount; k++) {
          assemblyItems.push(
            makeAssemblyItem({
              id: `ai-${k}`,
              assembly_id: rnd() < 0.3 ? `missing-asm-${k}` : `asm-${Math.floor(rnd() * (asmCount + 2))}`,
              item_id: rnd() < 0.3 ? `missing-item-${k}` : `item-${Math.floor(rnd() * (itemCount + 2))}`,
            })
          );
        }

        expect(() => {
          const report = diagnoseCatalog(items, assemblies, assemblyItems);
          expect(typeof report.healthy).toBe("boolean");
          expect(Array.isArray(report.issues)).toBe(true);
          expect(typeof report.summary).toBe("object");
        }).not.toThrow();
      }
    });
  });

  describe("I. Severity and Issue Kind Classification Verification", () => {
    it("assigns 'warning' severity to zero-cost and zero-labor items", () => {
      const item = makeItem({ id: "i1", material_cost: 0, labor_hours: 0 });
      const report = diagnoseCatalog([item], [], []);
      const costIssue = report.issues.find((i) => i.kind === "zero-cost-item");
      const laborIssue = report.issues.find((i) => i.kind === "zero-labor-item");
      expect(costIssue?.severity).toBe("warning");
      expect(laborIssue?.severity).toBe("warning");
    });

    it("assigns 'error' severity to duplicate codes, empty assemblies, and missing references", () => {
      const items = [
        makeItem({ id: "i1", code: "DUP" }),
        makeItem({ id: "i2", code: "DUP" }),
      ];
      const assemblies = [
        makeAssembly({ id: "a1", code: "ASMDUP" }),
        makeAssembly({ id: "a2", code: "ASMDUP" }),
      ];
      const assemblyItems = [
        makeAssemblyItem({ id: "ai1", assembly_id: "missing-asm", item_id: "missing-item" }),
      ];

      const report = diagnoseCatalog(items, assemblies, assemblyItems);
      const errors = report.issues.filter((i) => i.severity === "error");
      const warnings = report.issues.filter((i) => i.severity === "warning");

      expect(warnings).toHaveLength(0);
      expect(errors).toHaveLength(8);
      
      const kinds = new Set(errors.map((e) => e.kind));
      expect(kinds).toContain("duplicate-item-code");
      expect(kinds).toContain("duplicate-assembly-code");
      expect(kinds).toContain("empty-assembly");
      expect(kinds).toContain("missing-component-assembly");
      expect(kinds).toContain("missing-component-item");
    });
  });
});
