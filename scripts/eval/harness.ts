// Runs one evaluation case through the application's own detection code.
//
// Production code exercised unchanged:
//   pipeline.ts detectOnCanvas (tiling, uniform-tile skip, cross-tile dedupe,
//     candidate cap, cancellation) and cropCanvas (template crop),
//   worker-client.ts (worker lifecycle, 60 s per-operation timeout),
//   local.worker.ts / local.ts / ncc.ts (template variants, NCC, verification),
//   mapping.ts mapDetectionsToSheet (canvas px -> PDF units),
//   local.ts chooseAiCandidates (reported as a count only; nothing is sent).
// Harness-side substitutes: pdf.js rendering in Node (render.ts), a Node
// worker-thread adapter for the browser Worker (node-worker.ts), and a fetch
// stub that counts and refuses every request.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Canvas } from "@napi-rs/canvas";
import { cropCanvas, detectOnCanvas } from "../../src/lib/autocount/pipeline";
import { mapDetectionsToSheet } from "../../src/lib/autocount/mapping";
import { chooseAiCandidates } from "../../src/lib/autocount/local";
import type { Detection } from "../../src/lib/autocount/types";
import { type CaseSpec, type InputSpec, type PageBox, type ResolvedInput, type RunStatus, PRIVATE_ROOT_ENV, sha256 } from "./manifest";
import { installCanvasDocument, PageRangeError, renderPage, symbolSearchRenderScale, symbolSearchTemplateRect } from "./render";
import { installNodeWebWorker } from "./node-worker";
import { scoreDetections, type Score } from "./scoring";
import { evaluateGates, type GateResult } from "./gates";

export interface CaseRunOptions {
  /** Operator cancellation (e.g. Ctrl+C). */
  signal?: AbortSignal;
  /** Harness budget for render + detection; exceeding it is reported as timed-out. */
  caseTimeoutMs?: number;
  /** Directory for diagnostic images (template, false positive/negative crops). */
  artifactDir?: string;
  /** Maximum false positive/negative crops written per case. */
  maxDiagnosticCrops?: number;
}

export interface TimingSummary { count: number; totalMs: number; p50Ms: number | null; p95Ms: number | null; maxMs: number | null }

export interface CaseResult {
  id: string;
  status: RunStatus;
  statusDetail?: string;
  input: { key: string; fixtureId?: string; redistributable: boolean; location: string; sha256: string | null };
  page: number;
  sheet: string;
  symbolClass: string;
  /** Number of labeled symbols, known even when the case produced no score. */
  expectedCount: number;
  split: CaseSpec["split"];
  labelProvenance: CaseSpec["labelProvenance"];
  options: { minScore: number; scaleTolerance: boolean; assist: false; existingMarks: 0; renderScale: CaseSpec["render"]["scale"]; radiusScale: number };
  exampleBox: PageBox;
  render?: { scale: number; canvasWidth: number; canvasHeight: number; pageWidth: number; pageHeight: number; rotation: number; rasterSha256: string };
  template?: { canvasRect: PageBox; width: number; height: number; sha256: string };
  detection?: {
    tiles: number; skippedUniformTiles: number; duplicatesSuppressed: number; candidates: number;
    wouldReviewCrops: number; requests: number; sentCrops: number; payloadBytes: number;
    workersStarted: number; workersTerminated: number; tileTimings: TimingSummary;
  };
  apiCalls: number;
  score: Score | null;
  gates: GateResult;
  /** Pending candidates in PDF units, as SymbolSearch would store them before review. */
  detections: (PageBox & { confidence: number })[];
  detectionsSha256: string | null;
  timingsMs: { render: number | null; detect: number | null; total: number };
  artifacts: string[];
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

export function summarizeTimings(values: number[]): TimingSummary {
  const sorted = [...values].sort((a, b) => a - b);
  const round = (v: number | null) => (v === null ? null : Math.round(v));
  return { count: values.length, totalMs: Math.round(values.reduce((a, b) => a + b, 0)), p50Ms: round(percentile(sorted, 0.5)), p95Ms: round(percentile(sorted, 0.95)), maxMs: round(sorted.at(-1) ?? null) };
}

/** Rendered-pixel region for a PDF-unit box, clamped to the canvas. */
function pixelRect(box: PageBox, scale: number, canvas: { width: number; height: number }) {
  const x = Math.max(0, Math.floor(box.x * scale)), y = Math.max(0, Math.floor(box.y * scale));
  const right = Math.min(canvas.width, Math.ceil((box.x + box.w) * scale)), bottom = Math.min(canvas.height, Math.ceil((box.y + box.h) * scale));
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

/**
 * Labels that sit on blank paper or off the page reveal a coordinate-convention
 * or labeling error. The box is checked with a small margin (10% of each edge,
 * at least 2 px) so a solid filled symbol, uniform inside its own box, still
 * shows its edge against the paper.
 */
export function checkLabelsAgainstRaster(spec: CaseSpec, canvas: Canvas, scale: number, page: { width: number; height: number }): string[] {
  const problems: string[] = [];
  const ctx = canvas.getContext("2d");
  const check = (box: PageBox, name: string) => {
    if (box.x + box.w > page.width + 1e-6 || box.y + box.h > page.height + 1e-6) { problems.push(`${name} extends beyond the ${page.width}×${page.height} page`); return; }
    const mx = Math.max(2 / scale, 0.1 * box.w), my = Math.max(2 / scale, 0.1 * box.h);
    const r = pixelRect({ x: box.x - mx, y: box.y - my, w: box.w + 2 * mx, h: box.h + 2 * my }, scale, canvas);
    if (r.w === 0 || r.h === 0) { problems.push(`${name} covers no rendered pixels`); return; }
    const data = ctx.getImageData(r.x, r.y, r.w, r.h).data;
    let uniform = true;
    for (let i = 4; i < data.length && uniform; i += 4) if (data[i] !== data[0] || data[i + 1] !== data[1] || data[i + 2] !== data[2]) uniform = false;
    if (uniform) problems.push(`${name} contains no drawing at its labeled position`);
  };
  check(spec.example.box, "example box");
  spec.expected.forEach((box, i) => check(box, `expected[${i}]`));
  spec.negatives.forEach((region, i) => check(region.box, `negatives[${i}] "${region.label}"`));
  return problems;
}

/** Private inputs are reported relative to the private root, never by absolute path. */
const locationOf = (spec: InputSpec) => (spec.redistributable ? spec.path! : `$${PRIVATE_ROOT_ENV}/${spec.privatePath}`);

/** Raised inside runCase for problems with the inputs or labels rather than the detector. */
class CaseInputError extends Error {}

function baseResult(spec: CaseSpec, input: { key: string; spec: InputSpec; sha256?: string }): CaseResult {
  return {
    id: spec.id,
    status: "input-error",
    input: { key: input.key, ...(input.spec.fixtureId ? { fixtureId: input.spec.fixtureId } : {}), redistributable: input.spec.redistributable, location: locationOf(input.spec), sha256: input.sha256 ?? null },
    page: spec.page,
    sheet: spec.sheet,
    symbolClass: spec.symbolClass,
    expectedCount: spec.expected.length,
    split: spec.split,
    labelProvenance: spec.labelProvenance,
    options: { minScore: spec.detector.minScore, scaleTolerance: spec.detector.scaleTolerance, assist: false, existingMarks: 0, renderScale: spec.render.scale, radiusScale: spec.scoring.radiusScale },
    exampleBox: spec.example.box,
    apiCalls: 0,
    score: null,
    gates: { passed: false, violations: [] },
    detections: [],
    detectionsSha256: null,
    timingsMs: { render: null, detect: null, total: 0 },
    artifacts: [],
  };
}

/** A case whose input could not be resolved: reported, never silently skipped. */
export function inputErrorResult(spec: CaseSpec, input: { key: string; spec: InputSpec }, message: string): CaseResult {
  const result = baseResult(spec, input);
  result.statusDetail = message;
  result.gates = evaluateGates("input-error", null, 0, spec.gates);
  return result;
}

async function writeCrop(canvas: Canvas, center: { x: number; y: number }, size: { w: number; h: number }, scale: number, file: string) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const w = Math.max(8, Math.round(size.w * scale * 2.5)), h = Math.max(8, Math.round(size.h * scale * 2.5));
  const x = Math.max(0, Math.min(canvas.width - w, Math.round(center.x * scale - w / 2)));
  const y = Math.max(0, Math.min(canvas.height - h, Math.round(center.y * scale - h / 2)));
  const crop = createCanvas(w, h);
  crop.getContext("2d").drawImage(canvas, x, y, w, h, 0, 0, w, h);
  writeFileSync(file, await crop.encode("png"));
}

export async function runCase(spec: CaseSpec, input: ResolvedInput, options: CaseRunOptions = {}): Promise<CaseResult> {
  const started = performance.now();
  const result = baseResult(spec, input);
  result.status = "failed";
  const budget = new AbortController();
  const timer = options.caseTimeoutMs ? setTimeout(() => budget.abort(new Error("case budget exceeded")), options.caseTimeoutMs) : undefined;
  const signal = options.signal ? AbortSignal.any([options.signal, budget.signal]) : budget.signal;

  let fetchCalls = 0;
  const globals = globalThis as { fetch?: typeof fetch };
  const originalFetch = globals.fetch;
  globals.fetch = (async () => { fetchCalls++; throw new Error("Network access is disabled during local detection evaluation."); }) as typeof fetch;
  const documentShim = installCanvasDocument();
  const workerShim = installNodeWebWorker();

  let canvas: Canvas | undefined;
  let scale = 0;
  try {
    // 1. Render the page exactly as SymbolSearch sizes it.
    let rendered;
    try {
      rendered = await renderPage({
        pdfBytes: input.bytes,
        page: spec.page,
        scale: spec.render.scale === "symbol-search" ? page => symbolSearchRenderScale(spec.example.box, page) : spec.render.scale,
      });
    } catch (error) {
      throw error instanceof PageRangeError ? new CaseInputError(error.message) : error;
    }
    canvas = rendered.canvas;
    scale = rendered.scale;
    result.timingsMs.render = Math.round(rendered.renderMs);
    const raster = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    result.render = { scale, canvasWidth: canvas.width, canvasHeight: canvas.height, pageWidth: rendered.pageWidth, pageHeight: rendered.pageHeight, rotation: rendered.rotation, rasterSha256: sha256(raster) };
    if (rendered.rotation !== 0) throw new CaseInputError(`page /Rotate ${rendered.rotation} is not supported by manifest v1 coordinates`);

    // 2. Labels must sit on drawn content inside the page.
    const labelProblems = checkLabelsAgainstRaster(spec, canvas, scale, { width: rendered.pageWidth, height: rendered.pageHeight });
    if (labelProblems.length) throw new CaseInputError(`label check failed: ${labelProblems.join("; ")}`);

    // 3. Crop the example exactly as SymbolSearch does (production cropCanvas).
    const rect = symbolSearchTemplateRect(spec.example.box, scale, canvas);
    const template = cropCanvas(canvas as unknown as HTMLCanvasElement, rect.x, rect.y, rect.w, rect.h) as unknown as Canvas;
    result.template = { canvasRect: rect, width: template.width, height: template.height, sha256: sha256(template.getContext("2d").getImageData(0, 0, template.width, template.height).data) };
    if (options.artifactDir) {
      mkdirSync(options.artifactDir, { recursive: true });
      const file = path.join(options.artifactDir, "template.png");
      writeFileSync(file, await template.encode("png"));
      result.artifacts.push(file);
    }

    // 4. Detect with the production pipeline in local-only mode.
    const tileStarts: number[] = [];
    const detectStarted = performance.now();
    let output;
    try {
      output = await detectOnCanvas(
        canvas as unknown as HTMLCanvasElement,
        template as unknown as HTMLCanvasElement,
        { minScore: spec.detector.minScore, scaleTolerance: spec.detector.scaleTolerance, assist: false, existing: [] },
        signal,
        progress => { if (progress.stage === "local") tileStarts.push(performance.now()); },
      );
    } finally {
      result.timingsMs.detect = Math.round(performance.now() - detectStarted);
    }
    const tileDurations = tileStarts.slice(1).map((t, i) => t - tileStarts[i]);
    const stats = output.stats;
    result.apiCalls = fetchCalls + stats.requests;
    result.detection = {
      tiles: stats.tiles, skippedUniformTiles: stats.skipped, duplicatesSuppressed: stats.duplicates, candidates: output.detections.length,
      wouldReviewCrops: chooseAiCandidates(output.detections).length, requests: stats.requests, sentCrops: stats.sentCrops, payloadBytes: stats.payloadBytes,
      workersStarted: workerShim.stats.created, workersTerminated: workerShim.stats.terminated, tileTimings: summarizeTimings(tileDurations),
    };

    // 5. Map to PDF units exactly as SymbolSearch stores pending candidates.
    const sheetDetections: Detection[] = mapDetectionsToSheet(output.detections, { x: 0, y: 0 }, scale);
    result.detections = sheetDetections.map(({ x, y, w, h, confidence }) => ({ x, y, w, h, confidence }));
    result.detectionsSha256 = sha256(JSON.stringify(result.detections));
    result.status = sheetDetections.length === 0 ? "zero-match" : "completed";

    // 6. Score one-to-one against the labels.
    result.score = scoreDetections(result.detections, spec.expected, { negatives: spec.negatives, ignore: spec.ignore, radiusScale: spec.scoring.radiusScale });

    if (options.artifactDir) {
      const limit = options.maxDiagnosticCrops ?? 25;
      const typical = spec.expected[0] ?? spec.example.box;
      for (const fp of result.score.falsePositiveDetails.slice(0, limit)) {
        const file = path.join(options.artifactDir, `false-positive-${fp.prediction}.png`);
        await writeCrop(canvas, fp.center, result.detections[fp.prediction], scale, file);
        result.artifacts.push(file);
      }
      for (const fn of result.score.falseNegativeDetails.slice(0, limit)) {
        const file = path.join(options.artifactDir, `false-negative-${fn.truth}.png`);
        await writeCrop(canvas, fn.center, spec.expected[fn.truth] ?? typical, scale, file);
        result.artifacts.push(file);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof CaseInputError) { result.status = "input-error"; result.statusDetail = message; }
    else if (budget.signal.aborted && !options.signal?.aborted) { result.status = "timed-out"; result.statusDetail = `harness case budget of ${options.caseTimeoutMs} ms exceeded`; }
    else if (options.signal?.aborted) { result.status = "cancelled"; result.statusDetail = "cancelled by operator; no partial detections are scored"; }
    else if (/timed out/i.test(message)) { result.status = "timed-out"; result.statusDetail = message; }
    else { result.status = "failed"; result.statusDetail = message; }
    result.detections = [];
    result.detectionsSha256 = null;
    result.score = null;
    result.apiCalls = fetchCalls;
  } finally {
    if (timer) clearTimeout(timer);
    workerShim.restore();
    documentShim.restore();
    if (originalFetch === undefined) delete globals.fetch; else globals.fetch = originalFetch;
    result.timingsMs.total = Math.round(performance.now() - started);
  }
  result.gates = evaluateGates(result.status, result.score, result.apiCalls, spec.gates);
  return result;
}
