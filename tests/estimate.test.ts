// Verifies the full estimate extension pipeline against the hand-calculated
// fixture project (see tests/fixtures/fixture-project.ts for the arithmetic).

import { describe, it, expect } from "vitest";
import {
  layerQuantities,
  extendEstimate,
  materialRollup,
  estimateTotals,
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

const quantities = layerQuantities(layers, takeoffs, [sheet]);
const byLayer = new Map(quantities.map((q) => [q.layer.id, q]));
const { lines, issues } = extendEstimate(quantities, items, assemblies, assemblyItems);

describe("layer quantities from takeoff", () => {
  it("counts 8 receptacles — pending AI detections are excluded", () => {
    expect(byLayer.get("l-rec")!.quantity).toBe(8);
    expect(byLayer.get("l-rec")!.objects).toBe(8);
  });
  it("counts 4 troffers", () => {
    expect(byLayer.get("l-led")!.quantity).toBe(4);
  });
  it("lighting wire: 1200 units at 0.1 ft/unit = 120 FT", () => {
    expect(byLayer.get("l-wire")!.quantity).toBeCloseTo(120, 10);
  });
  it("feeder EMT: 550 units = 55 ft + 5 ft rise/drop = 60 FT", () => {
    expect(byLayer.get("l-emt")!.quantity).toBeCloseTo(60, 10);
  });
});

describe("assembly expansion", () => {
  const recLines = lines.filter((l) => l.layerId === "l-rec");

  it("expands the receptacle assembly into its 6 component items", () => {
    expect(recLines).toHaveLength(6);
  });

  it.each([
    ["i-dplx", 8, 22.8, 1.6],
    ["i-plt", 8, 4.4, 0.4],
    ["i-box", 8, 24.8, 2.0],
    ["i-mr", 8, 14.8, 0.48],
    ["i-emt05", 48, 32.64, 1.536],
    ["i-w12", 144, 25.92, 1.152],
  ])("component %s: qty %d, $%f, %f hr", (itemId, qty, mat, hrs) => {
    const line = recLines.find((l) => l.item.id === itemId)!;
    expect(line.itemQty).toBeCloseTo(qty as number, 10);
    expect(line.materialCost).toBeCloseTo(mat as number, 10);
    expect(line.laborHours).toBeCloseTo(hrs as number, 10);
  });
});

describe("direct item extension", () => {
  it("troffers: 4 x $89.50 = $358.00, 3.0 hr", () => {
    const l = lines.find((x) => x.layerId === "l-led")!;
    expect(l.materialCost).toBeCloseTo(358.0, 10);
    expect(l.laborHours).toBeCloseTo(3.0, 10);
  });
  it("lighting wire: 120 FT x $0.18 = $21.60, 0.96 hr", () => {
    const l = lines.find((x) => x.layerId === "l-wire")!;
    expect(l.materialCost).toBeCloseTo(21.6, 10);
    expect(l.laborHours).toBeCloseTo(0.96, 10);
  });
  it("feeder EMT: 60 FT x $1.02 = $61.20, 2.40 hr", () => {
    const l = lines.find((x) => x.layerId === "l-emt")!;
    expect(l.materialCost).toBeCloseTo(61.2, 10);
    expect(l.laborHours).toBeCloseTo(2.4, 10);
  });
});

describe("rollup and totals", () => {
  it("W-12 rolls up across assembly + direct runs: 264 FT, $47.52", () => {
    const rollup = materialRollup(lines);
    const w12 = rollup.find((r) => r.item.id === "i-w12")!;
    expect(w12.quantity).toBeCloseTo(264, 10);
    expect(w12.materialCost).toBeCloseTo(47.52, 10);
  });

  it("material $566.16, labor 13.528 hr", () => {
    const { materialBase, laborHoursBase } = estimateTotals(lines);
    expect(materialBase).toBeCloseTo(566.16, 8);
    expect(laborHoursBase).toBeCloseTo(13.528, 8);
  });

  it("the fully-linked fixture reports no estimate issues", () => {
    expect(issues).toEqual([]);
  });
});

describe("bid summary ($95/hr, 12% OH, 10% profit)", () => {
  const s = summarize({ ...estimateTotals(lines), ...summaryInputs });

  it("labor cost 13.528 x 95 = $1285.16", () => {
    expect(s.laborCost).toBeCloseTo(1285.16, 8);
  });
  it("prime cost $1851.32", () => {
    expect(s.primeCost).toBeCloseTo(1851.32, 8);
  });
  it("overhead $222.1584", () => {
    expect(s.overhead).toBeCloseTo(222.1584, 8);
  });
  it("profit $207.34784", () => {
    expect(s.profit).toBeCloseTo(207.34784, 8);
  });
  it("bid price $2280.82624", () => {
    expect(s.bidPrice).toBeCloseTo(2280.82624, 8);
  });
});

describe("guard rails", () => {
  it("uncalibrated sheets flag needsCalibration instead of contributing 0", () => {
    const uncalSheet = { ...sheet, scale_ft_per_unit: null };
    const q = layerQuantities(layers, takeoffs, [uncalSheet]);
    const emt = q.find((x) => x.layer.id === "l-emt")!;
    expect(emt.needsCalibration).toBe(true);
    expect(emt.quantity).toBe(0);
    // counts are unaffected by calibration
    expect(q.find((x) => x.layer.id === "l-rec")!.quantity).toBe(8);
  });

  it("unlinked layers produce no estimate lines", () => {
    // keep the layer id so its 8 takeoffs still count, but strip the link
    const unlinked = [{ ...layers[0], item_id: null, assembly_id: null }];
    const q = layerQuantities(unlinked, takeoffs, [sheet]);
    const r = extendEstimate(q, items, assemblies, assemblyItems);
    expect(r.lines).toHaveLength(0);
    // ...and the dropped quantity is reported, never silently discarded
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].kind).toBe("unlinked");
    expect(r.issues[0].quantity).toBe(8);
  });
});
