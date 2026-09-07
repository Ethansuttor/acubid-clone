// Tests for grid anchoring and cell coordinate conversions (GA-4)

import { describe, it, expect } from "vitest";
import { cellOffsetToTilePx, tilePxToCellOffset, drawGridLinesOnBuffer } from "@/lib/autocount/grid";
import { parseDetections } from "@/lib/autocount/claude";

describe("GA-4: Grid coordinate conversions", () => {
  it("converts cell label and offset to tile px", () => {
    // Cell A1, dx: 10, dy: 20 -> x: 10, y: 20
    expect(cellOffsetToTilePx("A1", 10, 20)).toEqual({ x: 10, y: 20 });

    // Cell C4, dx: 40, dy: 90
    // C is column index 2 (2 * 128 = 256) -> x = 256 + 40 = 296
    // 4 is row index 3 (3 * 128 = 384) -> y = 384 + 90 = 474
    expect(cellOffsetToTilePx("C4", 40, 90)).toEqual({ x: 296, y: 474 });

    // Cell J10 (10th col, 10th row)
    // J is col 9 (9 * 128 = 1152), 10 is row 9 (9 * 128 = 1152)
    expect(cellOffsetToTilePx("J10", 0, 0)).toEqual({ x: 1152, y: 1152 });
  });

  it("handles case-insensitivity and whitespace in cell names", () => {
    expect(cellOffsetToTilePx("  c4  ", 40, 90)).toEqual({ x: 296, y: 474 });
    expect(cellOffsetToTilePx("b2", 15, 25)).toEqual({ x: 143, y: 153 });
  });

  it("rejects invalid cell strings", () => {
    expect(cellOffsetToTilePx("", 0, 0)).toBeNull();
    expect(cellOffsetToTilePx("invalid", 0, 0)).toBeNull();
    expect(cellOffsetToTilePx("1A", 0, 0)).toBeNull();
    expect(cellOffsetToTilePx("A0", 0, 0)).toBeNull();
  });

  it("round-trips tile px to cell offset and back", () => {
    const coords = [
      { x: 0, y: 0 },
      { x: 296, y: 474 },
      { x: 1200, y: 950 },
      { x: 1279, y: 1279 },
    ];

    for (const c of coords) {
      const cell = tilePxToCellOffset(c.x, c.y);
      const roundTrip = cellOffsetToTilePx(cell.cell, cell.dx, cell.dy);
      expect(roundTrip).toEqual(c);
    }
  });

  it("draws 1px red gridlines onto a synthetic pixel buffer", () => {
    const W = 256;
    const H = 256;
    const buffer = new Uint8ClampedArray(W * H * 4); // all zero / transparent

    drawGridLinesOnBuffer(buffer, W, H, 128);

    // Pixel at (128, 50) is on the vertical gridline -> should be red (239, 68, 68, 180)
    const idxLineV = (50 * W + 128) * 4;
    expect(buffer[idxLineV]).toBe(239);
    expect(buffer[idxLineV + 1]).toBe(68);
    expect(buffer[idxLineV + 2]).toBe(68);
    expect(buffer[idxLineV + 3]).toBe(180);

    // Pixel at (50, 128) is on the horizontal gridline
    const idxLineH = (128 * W + 50) * 4;
    expect(buffer[idxLineH]).toBe(239);
    expect(buffer[idxLineH + 1]).toBe(68);
    expect(buffer[idxLineH + 2]).toBe(68);
    expect(buffer[idxLineH + 3]).toBe(180);

    // Pixel at (50, 50) is inside cell A1 -> should be unmodified (0, 0, 0, 0)
    const idxBlank = (50 * W + 50) * 4;
    expect(buffer[idxBlank]).toBe(0);
    expect(buffer[idxBlank + 1]).toBe(0);
    expect(buffer[idxBlank + 2]).toBe(0);
    expect(buffer[idxBlank + 3]).toBe(0);
  });
});

describe("GA-4: parseDetections with grid cell output", () => {
  it("parses grid-anchored cell+offset JSON", () => {
    const modelOutput = JSON.stringify([
      { cell: "C4", dx: 40, dy: 90, w: 72, h: 36, confidence: 0.95 },
      { cell: "A1", dx: 15, dy: 25, w: 50, h: 50, confidence: 0.8 },
    ]);

    const detections = parseDetections(modelOutput, 1280, 1280);
    expect(detections).toHaveLength(2);
    // C4 -> col 2 (256) + 40 = 296, row 3 (384) + 90 = 474
    expect(detections[0]).toEqual({
      x: 296,
      y: 474,
      w: 72,
      h: 36,
      confidence: 0.95,
    });
    // A1 -> col 0 + 15 = 15, row 0 + 25 = 25
    expect(detections[1]).toEqual({
      x: 15,
      y: 25,
      w: 50,
      h: 50,
      confidence: 0.8,
    });
  });

  it("still parses legacy absolute x/y coordinates seamlessly", () => {
    const modelOutput = JSON.stringify([
      { x: 100, y: 200, w: 72, h: 36, confidence: 0.9 },
    ]);

    const detections = parseDetections(modelOutput, 1280, 1280);
    expect(detections).toHaveLength(1);
    expect(detections[0]).toEqual({
      x: 100,
      y: 200,
      w: 72,
      h: 36,
      confidence: 0.9,
    });
  });
});
