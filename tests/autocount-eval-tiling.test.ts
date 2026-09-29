// Tests for Python tiling port parity and evaluation matching logic (GA-2)

import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import { computeTiles } from "@/lib/autocount/tiling";
import { evaluateMatches } from "../scripts/eval-autocount";
import type { Detection } from "@/lib/autocount/types";

describe("GA-2: Python compute_tiles parity vs TS computeTiles", () => {
  const testCases = [
    { w: 1000, h: 800, tileSize: 1280, overlap: 160 },
    { w: 3888, h: 2592, tileSize: 1280, overlap: 216 },
    { w: 5184, h: 3456, tileSize: 1280, overlap: 160 },
  ];

  for (const tc of testCases) {
    it(`matches exact tile boxes for canvas ${tc.w}x${tc.h}`, () => {
      const tsTiles = computeTiles(tc.w, tc.h, { tileSize: tc.tileSize, overlap: tc.overlap });

      const pyCode = `
import json, sys
from scripts.render_eval_tiles import compute_tiles
tiles = compute_tiles(${tc.w}, ${tc.h}, tile_size=${tc.tileSize}, overlap=${tc.overlap})
print(json.dumps(tiles))
`;
      const pyOutput = execFileSync("python", ["-c", pyCode], { encoding: "utf-8" });
      const pyTiles = JSON.parse(pyOutput.trim());

      expect(pyTiles).toEqual(tsTiles);
    });
  }
});

describe("GA-2: evaluateMatches metric calculations", () => {
  const truth = [
    { kind: "troffer", x: 100, y: 100, w: 72, h: 36 }, // diagonal = sqrt(72^2+36^2) ≈ 80.5, halfDiag ≈ 40.25
    { kind: "troffer", x: 300, y: 100, w: 72, h: 36 },
    { kind: "troffer", x: 500, y: 100, w: 72, h: 36 },
  ];

  it("calculates 100% precision and recall for exact matches", () => {
    const detections: Detection[] = [
      { x: 100 - 36, y: 100 - 18, w: 72, h: 36, confidence: 0.95 },
      { x: 300 - 36, y: 100 - 18, w: 72, h: 36, confidence: 0.92 },
      { x: 500 - 36, y: 100 - 18, w: 72, h: 36, confidence: 0.88 },
    ];
    const metrics = evaluateMatches(detections, truth);
    expect(metrics.truePositives).toBe(3);
    expect(metrics.falsePositives).toBe(0);
    expect(metrics.falseNegatives).toBe(0);
    expect(metrics.precision).toBe(1.0);
    expect(metrics.recall).toBe(1.0);
    expect(metrics.f1).toBe(1.0);
  });

  it("identifies false positives, misses (false negatives), and distance tolerance", () => {
    const detections: Detection[] = [
      // Close enough to truth[0] (dist 20 <= halfDiag 40.25) -> TP
      { x: 100 - 36 + 12, y: 100 - 18 + 16, w: 72, h: 36, confidence: 0.9 },
      // Too far from truth[1] (dist 50 > halfDiag 40.25) -> FP
      { x: 300 - 36 + 50, y: 100 - 18, w: 72, h: 36, confidence: 0.7 },
      // Random hallucination in corridor -> FP
      { x: 900, y: 800, w: 72, h: 36, confidence: 0.6 },
    ];
    // truth[2] at 500, 100 is completely missed -> FN

    const metrics = evaluateMatches(detections, truth);
    expect(metrics.truePositives).toBe(1);
    expect(metrics.falsePositives).toBe(2);
    expect(metrics.falseNegatives).toBe(2);
    expect(metrics.precision).toBeCloseTo(1 / 3, 4);
    expect(metrics.recall).toBeCloseTo(1 / 3, 4);
  });
});
