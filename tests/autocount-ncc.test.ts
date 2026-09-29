// Tests for Normalized Cross-Correlation (NCC) template matcher (GA-5)

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  toGray,
  rotations,
  matchTemplate,
  matchAll,
  type GrayImage,
} from "@/lib/autocount/ncc";

function createBlankImage(w: number, h: number, fill = 255): GrayImage {
  const g = new Float32Array(w * h);
  g.fill(fill);
  return { g, w, h };
}

/** Draws a 2x4 troffer symbol: 72x36 rectangle with one diagonal line (black on white) */
function createTrofferTemplate(w = 72, h = 36): GrayImage {
  const tpl = createBlankImage(w, h, 255);
  // Outer rectangle (2px border)
  for (let x = 0; x < w; x++) {
    tpl.g[0 * w + x] = 0;
    tpl.g[1 * w + x] = 0;
    tpl.g[(h - 1) * w + x] = 0;
    tpl.g[(h - 2) * w + x] = 0;
  }
  for (let y = 0; y < h; y++) {
    tpl.g[y * w + 0] = 0;
    tpl.g[y * w + 1] = 0;
    tpl.g[y * w + (w - 1)] = 0;
    tpl.g[y * w + (w - 2)] = 0;
  }
  // Diagonal line from (0,0) to (w,h)
  for (let x = 0; x < w; x++) {
    const y = Math.floor((x / w) * h);
    if (y >= 0 && y < h) {
      tpl.g[y * w + x] = 0;
      if (y + 1 < h) tpl.g[(y + 1) * w + x] = 0;
    }
  }
  return tpl;
}

/** Draws a distinct decoy (filled circle of radius 15) */
function createDecoy(w = 72, h = 36): GrayImage {
  const decoy = createBlankImage(w, h, 255);
  const cx = w / 2;
  const cy = h / 2;
  const r = 14;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (Math.hypot(x - cx, y - cy) <= r) {
        decoy.g[y * w + x] = 0;
      }
    }
  }
  return decoy;
}

function stamp(target: GrayImage, stampImg: GrayImage, startX: number, startY: number): void {
  for (let y = 0; y < stampImg.h; y++) {
    for (let x = 0; x < stampImg.w; x++) {
      const tx = startX + x;
      const ty = startY + y;
      if (tx >= 0 && tx < target.w && ty >= 0 && ty < target.h) {
        // Minimum blending (black linework replaces white background)
        const targetVal = target.g[ty * target.w + tx];
        const stampVal = stampImg.g[y * stampImg.w + x];
        target.g[ty * target.w + tx] = Math.min(targetVal, stampVal);
      }
    }
  }
}

function addNoise(image: GrayImage, amp = 10, seed = 42): void {
  let s = seed;
  for (let i = 0; i < image.g.length; i++) {
    s = (s * 1664525 + 1013904223) % 4294967296;
    const noise = ((s / 4294967296) - 0.5) * 2 * amp;
    image.g[i] = Math.min(255, Math.max(0, image.g[i] + noise));
  }
}

describe("GA-5: Normalized Cross-Correlation (NCC) Template Matcher", () => {
  it("verifies no DOM or browser API imports in ncc.ts", () => {
    const filePath = path.resolve(__dirname, "../src/lib/autocount/ncc.ts");
    const content = fs.readFileSync(filePath, "utf-8");

    expect(content).not.toMatch(/document\./);
    expect(content).not.toMatch(/window\./);
    expect(content).not.toMatch(/HTMLCanvasElement/);
    expect(content).not.toMatch(/CanvasRenderingContext2D/);
    expect(content).not.toMatch(/@anthropic-ai/);
  });

  it("converts RGBA Uint8ClampedArray to grayscale Float32Array accurately", () => {
    // 2x1 image: pixel 1 = pure red, pixel 2 = pure green
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
    const gray = toGray(rgba, 2, 1);
    expect(gray).toHaveLength(2);
    expect(gray[0]).toBeCloseTo(0.299 * 255, 2);
    expect(gray[1]).toBeCloseTo(0.587 * 255, 2);
  });

  it("returns no matches on a blank image", () => {
    const image = createBlankImage(500, 500, 255);
    const template = createTrofferTemplate(72, 36);

    const matches = matchTemplate(image, template, 0.5);
    expect(matches).toEqual([]);

    const allMatches = matchAll(image, template, 0.5);
    expect(allMatches).toEqual([]);
  });

  it("finds 5 known stamped positions plus 1 rotated and 1 mirrored with light noise within 2 px", () => {
    const canvasW = 1000;
    const canvasH = 1000;
    const image = createBlankImage(canvasW, canvasH, 255);
    const template = createTrofferTemplate(72, 36);
    const variants = rotations(template);
    const t90 = variants.find((v) => v.angle === 90)!;
    const tMirror = variants.find((v) => v.mirrored)!;

    const positions = [
      { x: 100, y: 100, variant: template, desc: "Standard 0 deg" },
      { x: 300, y: 200, variant: template, desc: "Standard 0 deg" },
      { x: 600, y: 400, variant: template, desc: "Standard 0 deg" },
      { x: 800, y: 100, variant: template, desc: "Standard 0 deg" },
      { x: 200, y: 700, variant: template, desc: "Standard 0 deg" },
      { x: 500, y: 700, variant: t90, desc: "Rotated 90 deg" },
      { x: 800, y: 600, variant: tMirror, desc: "Mirrored horizontal" },
    ];

    // Stamp all 7 positions
    for (const p of positions) {
      stamp(image, p.variant, p.x, p.y);
    }

    // Stamp a decoy shape at (400, 500)
    const decoy = createDecoy(72, 36);
    stamp(image, decoy, 400, 500);

    // Add noise
    addNoise(image, 12, 12345);

    // Run matchAll at minScore = 0.6
    const detections = matchAll(image, template, 0.6);

    // Assert exactly 7 matches (decoy should NOT match)
    expect(detections.length).toBe(7);

    // Assert each stamped position was found within 2 px
    for (const p of positions) {
      const match = detections.find((d) => {
        const dist = Math.hypot(d.x - p.x, d.y - p.y);
        return dist <= 2.5;
      });
      expect(match, `Missing detection for stamped position at (${p.x}, ${p.y})`).toBeDefined();
      expect(match?.confidence).toBeGreaterThan(0.65);
    }

    // Assert decoy at (400, 500) was NOT detected
    const decoyHit = detections.find((d) => Math.hypot(d.x - 400, d.y - 500) <= 20);
    expect(decoyHit).toBeUndefined();
  }, 15000);

  it("benchmarks execution on a realistic 1280x1280 tile within 10s smoke ceiling", () => {
    const W = 1280;
    const H = 1280;
    const tileImg = createBlankImage(W, H, 255);
    const template = createTrofferTemplate(72, 36);

    // Stamp a few fixtures
    stamp(tileImg, template, 200, 200);
    stamp(tileImg, template, 600, 800);
    addNoise(tileImg, 5);

    const t0 = Date.now();
    const results = matchAll(tileImg, template, 0.6);
    const duration = Date.now() - t0;

    expect(results.length).toBe(2);
    expect(duration).toBeLessThan(10000); // 10s smoke ceiling
  }, 15000);

  // Regression: AutoCount passed the FLOAT template size (request.w * S + 2*pad)
  // while crop() had floored the canvas, so toGray/matchAll indexed a buffer of a
  // different size. Fractional writes into a Float32Array are silently discarded,
  // so the matcher returned zero hits with no error and auto-count found nothing.
  describe("rejects malformed dimensions rather than returning nothing", () => {
    const W = 300;
    const H = 300;
    const img = createBlankImage(W, H, 255);
    const template = createTrofferTemplate(40, 20);
    stamp(img, template, 100, 100);

    it("finds the stamped symbol with integer dimensions", () => {
      expect(matchTemplate(img, template, 0.6).length).toBe(1);
    });

    it("throws on a non-integer template dimension", () => {
      const bad = { ...template, w: template.w + 0.34 };
      expect(() => matchTemplate(img, bad, 0.6)).toThrow(/integer dimensions/);
    });

    it("throws on a non-integer image dimension", () => {
      expect(() => matchTemplate({ ...img, w: W + 0.4 }, template, 0.6)).toThrow(
        /integer dimensions/
      );
    });

    it("throws when a buffer is smaller than its stated dimensions", () => {
      expect(() => matchTemplate({ ...img, w: W * 2 }, template, 0.6)).toThrow(
        /buffer smaller/
      );
    });
  });
});
