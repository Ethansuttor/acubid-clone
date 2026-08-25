// Drawing-scale parsing feeds an automatic calibration, so a misread scale
// would silently mis-measure every conduit run on the sheet.

import { describe, it, expect } from "vitest";
import {
  parseDrawingScale,
  feetPerUnit,
  calibrationFromScale,
  formatScale,
} from "@/lib/sheetai/scale";
import { scaleFromCalibration } from "@/lib/geometry";

describe("parseDrawingScale", () => {
  it.each([
    ['1/4" = 1\'-0"', 4],
    ['1/4"=1\'-0"', 4],
    ["1/4in = 1ft", 4],
    ['1/8" = 1\'-0"', 8],
    ['3/16" = 1\'-0"', 16 / 3],
    ['3/32" = 1\'-0"', 32 / 3],
    ['1/2" = 1\'-0"', 2],
    ['3/4" = 1\'-0"', 4 / 3],
    ['1" = 1\'-0"', 1],
    ['1" = 20\'', 20],
    ['1"=40\'-0"', 40],
    ['1" = 100\'', 100],
    ["SCALE: 1/4\" = 1'-0\"", 4],
    ['1/4" = 1\'-6"', 6], // 1.5 ft per quarter inch
  ])("parses %s", (text, expected) => {
    expect(parseDrawingScale(text as string)!).toBeCloseTo(expected as number, 9);
  });

  it.each(["NTS", "N.T.S.", "Not To Scale", "AS NOTED", "SCALE: VARIES", "", "E-101 POWER PLAN"])(
    "refuses to derive a scale from %s",
    (text) => {
      expect(parseDrawingScale(text)).toBeNull();
    }
  );

  it("rejects an absurd reading rather than mis-measuring the sheet", () => {
    expect(parseDrawingScale('1" = 99999\'')).toBeNull();
    expect(parseDrawingScale('1000" = 1\'')).toBeNull();
  });
});

describe("scale to calibration", () => {
  it('1/4" = 1\'-0" gives 4 ft per inch and 0.0555.. ft per PDF unit', () => {
    const fpi = parseDrawingScale('1/4" = 1\'-0"')!;
    expect(fpi).toBe(4);
    expect(feetPerUnit(fpi)).toBeCloseTo(4 / 72, 12);
  });

  it("the synthesized calibration reproduces the same scale as a hand calibration", () => {
    for (const text of ['1/8" = 1\'-0"', '1/4" = 1\'-0"', '1" = 20\'']) {
      const fpi = parseDrawingScale(text)!;
      const calib = calibrationFromScale(fpi);
      expect(scaleFromCalibration(calib)).toBeCloseTo(feetPerUnit(fpi), 12);
    }
  });

  it("measures a real distance correctly at 1/8 scale", () => {
    // 100 ft at 1/8" = 1'-0" is 12.5 inches of paper = 900 PDF units
    const fpu = feetPerUnit(parseDrawingScale('1/8" = 1\'-0"')!);
    expect(900 * fpu).toBeCloseTo(100, 9);
  });

  it("formats common architectural scales back to their label", () => {
    expect(formatScale(4)).toBe('1/4" = 1\'-0"');
    expect(formatScale(8)).toBe('1/8" = 1\'-0"');
    expect(formatScale(20)).toBe("1\" = 20'");
  });
});
