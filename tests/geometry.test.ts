import { describe, it, expect } from "vitest";
import {
  dist,
  polylineLength,
  polygonArea,
  scaleFromCalibration,
  takeoffQuantity,
} from "@/lib/geometry";

describe("geometry primitives", () => {
  it("dist: 3-4-5 triangle", () => {
    expect(dist([0, 0], [3, 4])).toBe(5);
  });

  it("polyline length sums segments", () => {
    expect(polylineLength([[0, 0], [10, 0], [10, 5]])).toBe(15);
  });

  it("polygon area via shoelace (rectangle + triangle)", () => {
    expect(polygonArea([[0, 0], [10, 0], [10, 4], [0, 4]])).toBe(40);
    expect(polygonArea([[0, 0], [10, 0], [0, 6]])).toBe(30);
    // winding order must not matter
    expect(polygonArea([[0, 4], [10, 4], [10, 0], [0, 0]])).toBe(40);
  });

  it("scale from calibration: 200 units = 20 ft => 0.1 ft/unit", () => {
    expect(scaleFromCalibration({ p1: [100, 60], p2: [300, 60], distance_ft: 20 })).toBeCloseTo(0.1);
  });

  it("rejects degenerate calibrations", () => {
    expect(() => scaleFromCalibration({ p1: [5, 5], p2: [5, 5], distance_ft: 10 })).toThrow();
    expect(() => scaleFromCalibration({ p1: [0, 0], p2: [1, 0], distance_ft: 0 })).toThrow();
  });
});

describe("takeoffQuantity", () => {
  const sheet = { scale_ft_per_unit: 0.1 };
  const uncal = { scale_ft_per_unit: null };
  const layer = { rise_drop_ft: 0 };

  it("count is always 1 each, even uncalibrated", () => {
    expect(takeoffQuantity({ kind: "count", geometry: { x: 1, y: 2 } }, uncal, layer)).toBe(1);
  });

  it("linear converts to feet and adds rise/drop per run", () => {
    const t = { kind: "linear" as const, geometry: { points: [[0, 0], [200, 0]] as [number, number][] } };
    expect(takeoffQuantity(t, sheet, layer)).toBeCloseTo(20);
    expect(takeoffQuantity(t, sheet, { rise_drop_ft: 5 })).toBeCloseTo(25);
  });

  it("area converts to square feet (scale applied twice)", () => {
    const t = {
      kind: "area" as const,
      geometry: { points: [[0, 0], [200, 0], [200, 200], [0, 200]] as [number, number][] },
    };
    // 200u x 200u = 20ft x 20ft = 400 SF
    expect(takeoffQuantity(t, sheet, layer)).toBeCloseTo(400);
  });

  it("linear/area on an uncalibrated sheet returns null, never 0", () => {
    const t = { kind: "linear" as const, geometry: { points: [[0, 0], [200, 0]] as [number, number][] } };
    expect(takeoffQuantity(t, uncal, layer)).toBeNull();
  });
});
