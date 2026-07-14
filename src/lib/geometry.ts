// Pure geometry: distances, polyline length, polygon area, and conversion of
// takeoff geometry into real-world quantities via sheet calibration.
// All inputs are PDF user-space coordinates; calibration gives feet per unit.

import type { Calibration, Layer, Sheet, Takeoff, PathGeometry } from "./types";

export function dist(a: [number, number], b: [number, number]): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export function polylineLength(points: [number, number][]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += dist(points[i - 1], points[i]);
  return len;
}

/** Shoelace formula; vertices in any winding order. */
export function polygonArea(points: [number, number][]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/** Feet per PDF unit from two calibration points and a known distance. */
export function scaleFromCalibration(c: Calibration): number {
  const d = dist(c.p1, c.p2);
  if (d === 0) throw new Error("Calibration points are identical");
  if (c.distance_ft <= 0) throw new Error("Calibration distance must be positive");
  return c.distance_ft / d;
}

/**
 * Real-world quantity of a single takeoff object:
 *  - count: 1 each
 *  - linear: length in feet plus the layer's rise/drop allowance per run
 *  - area: square feet
 * Linear and area require a calibrated sheet; uncalibrated returns null so
 * callers can surface "needs calibration" rather than silently using 0.
 */
export function takeoffQuantity(
  takeoff: Pick<Takeoff, "kind" | "geometry">,
  sheet: Pick<Sheet, "scale_ft_per_unit">,
  layer: Pick<Layer, "rise_drop_ft">
): number | null {
  if (takeoff.kind === "count") return 1;
  const scale = sheet.scale_ft_per_unit;
  if (scale == null || scale <= 0) return null;
  const geom = takeoff.geometry as PathGeometry;
  if (!geom.points || geom.points.length < 2) return 0;
  if (takeoff.kind === "linear") {
    return polylineLength(geom.points) * scale + (layer.rise_drop_ft || 0);
  }
  // area
  return polygonArea(geom.points) * scale * scale;
}
