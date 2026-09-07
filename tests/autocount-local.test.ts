import { describe, expect, it } from "vitest";
import { chooseAiCandidates, fullCorrelation, matchLocalTile, prepareTemplates, resizeGray, validVerificationMap } from "@/lib/autocount/local";
import type { GrayImage } from "@/lib/autocount/ncc";
import { computeTiles } from "@/lib/autocount/tiling";
import { dedupeDetections } from "@/lib/autocount/dedupe";

function blank(w: number, h: number): GrayImage { return { w, h, g: new Float32Array(w * h).fill(255) }; }
function symbol(): GrayImage {
  const image = blank(28, 24);
  for (let y = 4; y < 20; y++) for (let x = 4; x < 24; x++) {
    if (x < 6 || y < 6 || (x >= 19 && y >= 12) || (y >= 18 && x < 14)) image.g[y * image.w + x] = 0;
  }
  return image;
}
function stamp(image: GrayImage, template: GrayImage, x: number, y: number) {
  for (let v = 0; v < template.h; v++) for (let u = 0; u < template.w; u++) image.g[(y + v) * image.w + x + u] = template.g[v * template.w + u];
}

describe("offline detection pipeline", () => {
  it("finds symbols across tile seams and sheet edges once each", () => {
    const template = symbol(), image = blank(1400, 80);
    const positions = [0, 1119, 1265, 1372];
    positions.forEach(x => stamp(image, template, x, 41));
    const templates = prepareTemplates(template);
    const found = computeTiles(image.w, image.h).flatMap(tile => {
      const crop = blank(tile.w, tile.h);
      for (let y = 0; y < tile.h; y++) crop.g.set(image.g.subarray((y + tile.y) * image.w + tile.x, (y + tile.y) * image.w + tile.x + tile.w), y * tile.w);
      return matchLocalTile(crop, templates, 0.85).map(hit => ({ ...hit, x: hit.x + tile.x, y: hit.y + tile.y }));
    });
    const unique = dedupeDetections(found, { centerFraction: 0.35 });
    expect(unique).toHaveLength(positions.length);
    positions.forEach(x => expect(unique.some(hit => hit.x === x && hit.y === 41)).toBe(true));
  });
  it("finds a sparse symbol even when the background is close to the template mean", () => {
    const template = blank(128, 128), image = blank(160, 160);
    for (let p = 54; p <= 74; p++) {
      template.g[64 * 128 + p] = 0;
      template.g[p * 128 + 64] = 0;
    }
    stamp(image, template, 13, 15);
    const found = matchLocalTile(image, prepareTemplates(template), 0.85);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ x: 13, y: 15 });
  });
  it.each([[20, 20], [21, 20], [20, 21], [21, 21], [79, 79]])("finds thin linework at pixel offset (%i, %i), including the image edge", (x, y) => {
    const template = blank(21, 21), image = blank(100, 100);
    for (let p = 4; p < 17; p++) {
      template.g[10 * 21 + p] = 0;
      template.g[p * 21 + 10] = 0;
    }
    stamp(image, template, x, y);
    const found = matchLocalTile(image, prepareTemplates(template), 0.85);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ x, y });
  });
  it("finds every orthogonal rotation and mirrored rotation without a model", () => {
    const templates = prepareTemplates(symbol());
    expect(templates).toHaveLength(8);
    const image = blank(360, 120);
    templates.forEach((template, i) => stamp(image, template, 10 + i * 42, 40));
    const found = matchLocalTile(image, templates, 0.85);
    expect(found).toHaveLength(8);
    templates.forEach((_, i) => expect(found.some(hit => Math.abs(hit.x - 10 - i * 42) <= 1 && Math.abs(hit.y - 40) <= 1)).toBe(true));
  });
  it("matches slight size changes only when the appropriate variants are included", () => {
    const template = symbol(), scaled = resizeGray(template, 1.1), image = blank(160, 100);
    stamp(image, scaled, 60, 30);
    const found = matchLocalTile(image, prepareTemplates(template, true), 0.95);
    expect(found).toHaveLength(1);
    expect(found[0].confidence).toBeCloseTo(1, 5);
  });
  it("validates contrast, dimensions, pixel values and thresholds", () => {
    expect(() => prepareTemplates(blank(20, 20))).toThrow("contrast");
    expect(() => prepareTemplates({ ...symbol(), w: 28.1 })).toThrow("dimensions");
    const invalid = symbol(); invalid.g[2] = NaN;
    expect(() => prepareTemplates(invalid)).toThrow("finite");
    expect(() => matchLocalTile(blank(100, 100), prepareTemplates(symbol()), NaN)).toThrow("threshold");
  });
  it("full-pixel validation rejects a different pattern and tolerates brightness changes", () => {
    const template = symbol(), image = blank(40, 40);
    stamp(image, template, 5, 5);
    expect(fullCorrelation(image, template, 5, 5)).toBeCloseTo(1, 6);
    image.g = image.g.map(pixel => 40 + pixel * 0.7);
    expect(fullCorrelation(image, template, 5, 5)).toBeCloseTo(1, 6);
    expect(fullCorrelation(blank(40, 40), template, 5, 5)).toBe(0);
  });
  it("caps AI work at 48 uncertain candidates and excludes strong matches", () => {
    const candidates = Array.from({ length: 100 }, (_, i) => ({ x: i * 30, y: 0, w: 20, h: 20, confidence: i < 10 ? 0.99 : 0.8 }));
    const selected = chooseAiCandidates(candidates);
    expect(selected).toHaveLength(48);
    expect(selected.every(i => i >= 10)).toBe(true);
    expect(chooseAiCandidates(candidates, 500)).toHaveLength(48);
    expect(chooseAiCandidates(candidates, 0)).toHaveLength(0);
  });
  it("does not trust omitted, invented, duplicate or malformed model decisions", () => {
    const decisions = validVerificationMap([
      { index: 1, match: true, confidence: 0.9 },
      { index: 2, match: true, confidence: 0.9 },
      { index: 2, match: false, confidence: 0.9 },
      { index: 3, match: "true", confidence: 0.9 },
      { index: 4, match: true, confidence: NaN },
      { index: 50, match: true, confidence: 1 },
    ], [1, 2, 3, 4, 5]);
    expect([...decisions.keys()]).toEqual([1]);
  });
});
