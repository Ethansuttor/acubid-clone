// Offline symbol matching. Sampled NCC proposes positions; full-pixel NCC
// verifies them. Scores measure visual similarity, not probability of correctness.
import { computeIntegralImages, matchTemplate, rotations, type GrayImage } from "./ncc";
import { dedupeDetections } from "./dedupe";
import type { Detection, VerificationResult } from "./types";

export const LOCAL_MIN_SCORE = 0.72;
export const STRONG_MATCH_SCORE = 0.9;
export const MAX_AI_CROPS = 48;
export const AI_BATCH_SIZE = 12;
export const MAX_LOCAL_CANDIDATES = 2500;
export interface LocalOptions { minScore?: number; scaleTolerance?: boolean }

export function validateGray(image: GrayImage): void {
  if (!Number.isInteger(image.w) || !Number.isInteger(image.h) || image.w <= 0 || image.h <= 0 || image.g.length !== image.w * image.h) {
    throw new Error("Invalid detector image dimensions or pixel buffer.");
  }
  for (const pixel of image.g) if (!Number.isFinite(pixel) || pixel < 0 || pixel > 255) throw new Error("Detector pixels must be finite grayscale values.");
}

export function resizeGray(image: GrayImage, scale: number): GrayImage {
  const w = Math.max(1, Math.round(image.w * scale));
  const h = Math.max(1, Math.round(image.h * scale));
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(image.w - 1, Math.max(0, (x + 0.5) * image.w / w - 0.5));
    const sy = Math.min(image.h - 1, Math.max(0, (y + 0.5) * image.h / h - 0.5));
    const x0 = Math.floor(sx), y0 = Math.floor(sy);
    const x1 = Math.min(image.w - 1, x0 + 1), y1 = Math.min(image.h - 1, y0 + 1);
    const fx = sx - x0, fy = sy - y0;
    g[y * w + x] = (1 - fy) * ((1 - fx) * image.g[y0 * image.w + x0] + fx * image.g[y0 * image.w + x1]) + fy * ((1 - fx) * image.g[y1 * image.w + x0] + fx * image.g[y1 * image.w + x1]);
  }
  return { g, w, h };
}

export function prepareTemplates(template: GrayImage, scaleTolerance = false): GrayImage[] {
  validateGray(template);
  if (Math.min(template.w, template.h) < 6 || Math.max(template.w, template.h) > 256) throw new Error("Draw a tighter box around one symbol (6–256 rendered pixels per edge).");
  const mean = template.g.reduce((sum, pixel) => sum + pixel, 0) / template.g.length;
  const variance = template.g.reduce((sum, pixel) => sum + (pixel - mean) ** 2, 0) / template.g.length;
  if (variance < 100) throw new Error("The example has too little contrast. Select a clear symbol with some white space around it.");
  const variants: GrayImage[] = [];
  for (const scale of scaleTolerance ? [1, 0.9, 1.1] : [1]) {
    const base = scale === 1 ? template : resizeGray(template, scale);
    const normal = rotations(base);
    variants.push(...normal.slice(0, 4));
    variants.push(...rotations(normal[4]).slice(0, 4));
  }
  // Symmetric symbols need fewer passes. Exact comparison avoids hash collisions.
  return variants.filter((variant, i) => !variants.slice(0, i).some(other => other.w === variant.w && other.h === variant.h && other.g.every((pixel, p) => pixel === variant.g[p])));
}

export function fullCorrelation(image: GrayImage, template: GrayImage, x: number, y: number): number {
  let a = 0, b = 0, aa = 0, bb = 0, ab = 0;
  for (let v = 0; v < template.h; v++) for (let u = 0; u < template.w; u++) {
    const av = image.g[(y + v) * image.w + x + u];
    const bv = template.g[v * template.w + u];
    a += av; b += bv; aa += av * av; bb += bv * bv; ab += av * bv;
  }
  const n = template.w * template.h;
  const norm = Math.sqrt(Math.max(0, aa - a * a / n) * Math.max(0, bb - b * b / n));
  return norm > 1e-6 ? Math.max(-1, Math.min(1, (ab - a * b / n) / norm)) : 0;
}

export function matchLocalTile(image: GrayImage, templates: GrayImage[], minScore = LOCAL_MIN_SCORE): Detection[] {
  validateGray(image);
  if (!Number.isFinite(minScore) || minScore < 0.5 || minScore > 1) throw new Error("Match threshold must be between 0.5 and 1.");
  if (image.w * image.h > 1280 * 1280) throw new Error("Detector tiles must not exceed 1280 × 1280 pixels.");
  const integrals = computeIntegralImages(image.g, image.w, image.h);
  const candidates: Detection[] = [];
  for (const template of templates) {
    for (const hit of matchTemplate(image, template, Math.max(0.5, minScore - 0.12), integrals)) {
      const score = fullCorrelation(image, template, hit.x, hit.y);
      if (score >= minScore) candidates.push({ ...hit, confidence: score });
      if (candidates.length > MAX_LOCAL_CANDIDATES * 8) throw new Error("Too many similar shapes. Select a more distinctive symbol or raise the match threshold.");
    }
  }
  return dedupeDetections(candidates, { centerFraction: 0.35 });
}

/** Spend requests only on ambiguous candidates; all others remain for local review. */
export function chooseAiCandidates(candidates: Detection[], maxCrops = MAX_AI_CROPS): number[] {
  return candidates.map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate.confidence < STRONG_MATCH_SCORE)
    .sort((a, b) => b.candidate.confidence - a.candidate.confidence)
    .slice(0, Math.max(0, Math.min(MAX_AI_CROPS, maxCrops))).map(({ index }) => index);
}

/** Omitted, duplicate, invented or malformed model IDs remain unresolved. */
export function validVerificationMap(results: unknown, requested: number[]): Map<number, VerificationResult> {
  const out = new Map<number, VerificationResult>();
  if (!Array.isArray(results)) return out;
  const allowed = new Set(requested), seen = new Set<number>();
  for (const value of results) {
    if (!value || typeof value !== "object") continue;
    const row = value as VerificationResult;
    if (!Number.isInteger(row.index) || !allowed.has(row.index)) continue;
    if (seen.has(row.index)) { out.delete(row.index); continue; }
    seen.add(row.index);
    if (typeof row.match !== "boolean" || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1) continue;
    out.set(row.index, row);
  }
  return out;
}
