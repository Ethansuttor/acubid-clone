// AI auto-count module: tiling coverage/overlap, cross-tile dedup, and
// robust parsing of model output.

import { describe, it, expect } from "vitest";
import { computeTiles } from "@/lib/autocount/tiling";
import { dedupeDetections, iou } from "@/lib/autocount/dedupe";
import { parseDetections } from "@/lib/autocount/claude";
import type { Detection } from "@/lib/autocount/types";

describe("computeTiles", () => {
  it("small sheet fits in one tile", () => {
    const tiles = computeTiles(1000, 800, { tileSize: 1280, overlap: 160 });
    expect(tiles).toEqual([{ x: 0, y: 0, w: 1000, h: 800 }]);
  });

  it("covers every pixel of a large sheet", () => {
    const W = 5184, H = 3456;
    const tiles = computeTiles(W, H, { tileSize: 1280, overlap: 160 });
    // full coverage: every sample point falls in >= 1 tile
    for (let x = 0; x < W; x += 97) {
      for (let y = 0; y < H; y += 97) {
        const hit = tiles.some((t) => x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h);
        expect(hit).toBe(true);
      }
    }
    // corners exactly
    expect(tiles.some((t) => t.x === 0 && t.y === 0)).toBe(true);
    expect(tiles.some((t) => t.x + t.w === W && t.y + t.h === H)).toBe(true);
  });

  it("adjacent tiles overlap by at least the requested amount", () => {
    const tiles = computeTiles(5000, 1000, { tileSize: 1280, overlap: 160 });
    const xs = [...new Set(tiles.map((t) => t.x))].sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      const prevRight = xs[i - 1] + 1280;
      expect(prevRight - xs[i]).toBeGreaterThanOrEqual(160);
    }
  });

  it("no tile exceeds the max size", () => {
    for (const t of computeTiles(9999, 7777, { tileSize: 1280, overlap: 200 })) {
      expect(t.w).toBeLessThanOrEqual(1280);
      expect(t.h).toBeLessThanOrEqual(1280);
    }
  });

  it("rejects overlap >= tileSize", () => {
    expect(() => computeTiles(2000, 2000, { tileSize: 100, overlap: 100 })).toThrow();
  });
});

describe("dedupeDetections", () => {
  const box = (x: number, y: number, conf = 0.9, size = 30): Detection => ({
    x, y, w: size, h: size, confidence: conf,
  });

  it("iou sanity", () => {
    expect(iou(box(0, 0), box(0, 0))).toBe(1);
    expect(iou(box(0, 0), box(100, 100))).toBe(0);
    expect(iou(box(0, 0), box(15, 0))).toBeCloseTo(15 / 45, 5);
  });

  it("merges the same symbol seen by two overlapping tiles", () => {
    // same symbol, 2px registration difference between tiles
    const result = dedupeDetections([box(500, 500, 0.95), box(502, 501, 0.8)]);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(0.95); // keeps the higher-confidence one
  });

  it("keeps genuinely distinct nearby symbols", () => {
    // two receptacles 60px apart (2x box size) must both survive
    const result = dedupeDetections([box(100, 100), box(160, 100)]);
    expect(result).toHaveLength(2);
  });

  it("dedupes a chain of near-duplicates to one", () => {
    const result = dedupeDetections([
      box(100, 100, 0.9),
      box(103, 100, 0.85),
      box(100, 104, 0.7),
    ]);
    expect(result).toHaveLength(1);
  });
});

describe("parseDetections", () => {
  it("parses a clean JSON array", () => {
    const out = parseDetections('[{"x":10,"y":20,"w":30,"h":30,"confidence":0.9}]', 1000, 1000);
    expect(out).toEqual([{ x: 10, y: 20, w: 30, h: 30, confidence: 0.9 }]);
  });

  it("tolerates prose and code fences around the JSON", () => {
    const text = 'Here are the results:\n```json\n[{"x":1,"y":2,"w":3,"h":4,"confidence":1}]\n```\nDone.';
    expect(parseDetections(text, 100, 100)).toHaveLength(1);
  });

  it("returns [] for garbage, empty arrays, and non-arrays", () => {
    expect(parseDetections("no symbols found", 100, 100)).toEqual([]);
    expect(parseDetections("[]", 100, 100)).toEqual([]);
    expect(parseDetections('{"x":1}', 100, 100)).toEqual([]);
  });

  it("drops malformed entries and boxes fully outside the tile", () => {
    const text = JSON.stringify([
      { x: 10, y: 10, w: 20, h: 20, confidence: 0.8 },
      { x: "bad", y: 0, w: 5, h: 5 },
      { x: 5000, y: 5000, w: 10, h: 10, confidence: 0.9 }, // outside 1000x1000
      { x: 50, y: 50, w: 0, h: 10 }, // zero width
    ]);
    const out = parseDetections(text, 1000, 1000);
    expect(out).toHaveLength(1);
  });

  it("defaults and clamps confidence", () => {
    const out = parseDetections('[{"x":1,"y":1,"w":5,"h":5},{"x":20,"y":20,"w":5,"h":5,"confidence":7}]', 100, 100);
    expect(out[0].confidence).toBe(0.5);
    expect(out[1].confidence).toBe(1);
  });
});
