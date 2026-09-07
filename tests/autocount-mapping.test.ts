// Tests for pure autocount coordinate mapping (GA-1)
// Proves tile-local detections + tile offset + render scale S -> sheet coordinates (scale 1).

import { describe, it, expect } from "vitest";
import { mapDetectionsToSheet, detectionCenter, mapDetectionToPoint } from "@/lib/autocount/mapping";
import type { Detection } from "@/lib/autocount/types";

describe("autocount mapping (GA-1)", () => {
  it("computes box center correctly", () => {
    const box = { x: 10, y: 20, w: 30, h: 40 };
    expect(detectionCenter(box)).toEqual({ x: 25, y: 40 });
  });

  it("handles origin tile at x=0, y=0 with scale S=1", () => {
    const detections: Detection[] = [
      { x: 100, y: 150, w: 20, h: 30, confidence: 0.95 },
      { x: 0, y: 0, w: 50, h: 50, confidence: 0.8 },
    ];
    const mapped = mapDetectionsToSheet(detections, { x: 0, y: 0 }, 1);
    expect(mapped).toHaveLength(2);
    expect(mapped[0]).toEqual({ x: 100, y: 150, w: 20, h: 30, confidence: 0.95 });
    expect(mapped[1]).toEqual({ x: 0, y: 0, w: 50, h: 50, confidence: 0.8 });

    const center0 = detectionCenter(mapped[0]);
    expect(center0.x).toBeCloseTo(110, 8);
    expect(center0.y).toBeCloseTo(165, 8);
  });

  it("maps interior tile with offset and non-integer scale S with 8-decimal precision", () => {
    // Tile at offset (1280, 2560) in rendered canvas px
    // Render scale S = 2.34567891
    const S = 2.34567891;
    const tile = { x: 1280, y: 2560 };
    const localDetection: Detection = {
      x: 320.12345678,
      y: 480.87654321,
      w: 72.5,
      h: 36.25,
      confidence: 0.98765432,
    };

    const [mapped] = mapDetectionsToSheet([localDetection], tile, S);

    // Expected values
    const expectedX = (1280 + 320.12345678) / S;
    const expectedY = (2560 + 480.87654321) / S;
    const expectedW = 72.5 / S;
    const expectedH = 36.25 / S;

    expect(mapped.x).toBeCloseTo(expectedX, 8);
    expect(mapped.y).toBeCloseTo(expectedY, 8);
    expect(mapped.w).toBeCloseTo(expectedW, 8);
    expect(mapped.h).toBeCloseTo(expectedH, 8);
    expect(mapped.confidence).toBe(0.98765432);

    const center = detectionCenter(mapped);
    const expectedCenterX = (1280 + 320.12345678 + 72.5 / 2) / S;
    const expectedCenterY = (2560 + 480.87654321 + 36.25 / 2) / S;

    expect(center.x).toBeCloseTo(expectedCenterX, 8);
    expect(center.y).toBeCloseTo(expectedCenterY, 8);

    // mapDetectionToPoint should match exactly
    const directPoint = mapDetectionToPoint(localDetection, tile, S);
    expect(directPoint.x).toBeCloseTo(expectedCenterX, 8);
    expect(directPoint.y).toBeCloseTo(expectedCenterY, 8);
  });

  it("same symbol in overlap region seen by two tiles maps to identical sheet coordinates", () => {
    // Suppose a fixture is located at sheet position:
    // center (500.0, 300.0) pt, size 72.0 x 36.0 pt (box x=464.0, y=282.0).
    // At scale S = 2.0:
    // Canvas box is x = 928, y = 564, w = 144, h = 72. Canvas center is (1000, 600).
    const S = 2.0;

    // Tile 1 is at canvas origin (0, 0)
    // Detection coordinates in Tile 1:
    const tile1 = { x: 0, y: 0 };
    const d1: Detection = {
      x: 928,
      y: 564,
      w: 144,
      h: 72,
      confidence: 0.91,
    };

    // Tile 2 is at canvas origin (800, 400) (overlapping Tile 1)
    // Detection coordinates in Tile 2:
    // local x = 928 - 800 = 128, local y = 564 - 400 = 164
    const tile2 = { x: 800, y: 400 };
    const d2: Detection = {
      x: 128,
      y: 164,
      w: 144,
      h: 72,
      confidence: 0.89,
    };

    const [mapped1] = mapDetectionsToSheet([d1], tile1, S);
    const [mapped2] = mapDetectionsToSheet([d2], tile2, S);

    // Assert both map to the exact same sheet coordinates
    expect(mapped1.x).toBeCloseTo(464.0, 8);
    expect(mapped1.y).toBeCloseTo(282.0, 8);
    expect(mapped1.w).toBeCloseTo(72.0, 8);
    expect(mapped1.h).toBeCloseTo(36.0, 8);

    expect(mapped2.x).toBeCloseTo(464.0, 8);
    expect(mapped2.y).toBeCloseTo(282.0, 8);
    expect(mapped2.w).toBeCloseTo(72.0, 8);
    expect(mapped2.h).toBeCloseTo(36.0, 8);

    const c1 = detectionCenter(mapped1);
    const c2 = detectionCenter(mapped2);
    expect(c1.x).toBeCloseTo(500.0, 8);
    expect(c1.y).toBeCloseTo(300.0, 8);
    expect(c2.x).toBeCloseTo(500.0, 8);
    expect(c2.y).toBeCloseTo(300.0, 8);

    expect(c1.x).toBeCloseTo(c2.x, 8);
    expect(c1.y).toBeCloseTo(c2.y, 8);
  });

  it("rejects non-positive scale S", () => {
    expect(() => mapDetectionsToSheet([], { x: 0, y: 0 }, 0)).toThrow();
    expect(() => mapDetectionsToSheet([], { x: 0, y: 0 }, -1)).toThrow();
    expect(() => mapDetectionToPoint({ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0 }, 0)).toThrow();
  });
});
