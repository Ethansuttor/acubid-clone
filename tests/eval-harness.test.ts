// End-to-end harness check on a small generated drawing: the real pdf.js
// render, production pipeline, worker client and local.worker.ts (in a Node
// worker thread) and one-to-one scoring. Injected label errors must change
// the score exactly; invalid inputs and cancellation must be reported.
import { describe, expect, it } from "vitest";
import { PDFDocument, rgb } from "pdf-lib";
import { parseManifest, sha256, type CaseSpec, type ResolvedInput } from "../scripts/eval/manifest";
import { runCase } from "../scripts/eval/harness";

const H = 300;
// Troffer-like symbol: 30 × 15 pt rectangle with one diagonal (bottom-left PDF coordinates).
const symbols = [[60, 60], [160, 60], [260, 200], [340, 120]];
const legendSwatch = [60, 250]; // half-size copy, labeled as a negative
const circle = [200, 180]; // a different symbol class

async function drawing(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const page = doc.addPage([400, H]);
  const troffer = (cx: number, cy: number, w: number, h: number) => {
    page.drawRectangle({ x: cx - w / 2, y: cy - h / 2, width: w, height: h, borderWidth: 1.2, borderColor: rgb(0, 0, 0) });
    page.drawLine({ start: { x: cx - w / 2, y: cy - h / 2 }, end: { x: cx + w / 2, y: cy + h / 2 }, thickness: 1, color: rgb(0, 0, 0) });
  };
  for (const [x, y] of symbols) troffer(x, y, 30, 15);
  troffer(legendSwatch[0], legendSwatch[1], 15, 7.5);
  page.drawCircle({ x: circle[0], y: circle[1], size: 8, borderWidth: 1.2, borderColor: rgb(0, 0, 0) });
  return doc.save();
}

const topLeft = ([x, y]: number[], w = 30, h = 15) => ({ x: x - w / 2, y: H - y - h / 2, w, h });

async function setup(caseOverrides: Record<string, unknown> = {}) {
  const bytes = await drawing();
  const digest = sha256(bytes);
  const manifest = parseManifest(JSON.stringify({
    format: "voltline-detection-eval", version: 1, id: "harness-test", description: "generated in test", evidenceClass: "synthetic", coordinateConvention: "pdf-top-left-points",
    inputs: { plan: { kind: "pdf", fixtureId: "harness-test", redistributable: true, path: "generated.pdf", sha256: digest } },
    defaults: {
      detector: { minScore: 0.72, scaleTolerance: false }, render: { scale: "symbol-search" },
      scoring: { rule: "center-distance", radius: "truth-half-diagonal", radiusScale: 1 }, labelProvenance: "synthetic-generator",
      split: { project: "test", source: "test", set: "regression" },
      gates: { minPrecision: 1, minRecall: 1, maxFalsePositives: 0, maxFalseNegatives: 0, maxNegativeHits: 0, maxApiCalls: 0, allowedStatus: ["completed"] },
    },
    cases: [{
      id: "troffer", input: "plan", page: 1, sheet: "T-1", symbolClass: "troffer",
      example: { box: topLeft(symbols[0]) }, expected: symbols.map(s => topLeft(s)),
      negatives: [{ label: "legend swatch", box: topLeft(legendSwatch, 17, 10) }], ignore: [],
      ...caseOverrides,
    }],
  }));
  const input: ResolvedInput = { key: "plan", spec: manifest.inputs.plan, absolutePath: "generated.pdf", bytes, sha256: digest };
  return { spec: manifest.cases[0] as CaseSpec, input };
}

describe("evaluation harness on the production pipeline", () => {
  it("finds every labeled symbol with zero API calls, reproducibly", async () => {
    const { spec, input } = await setup();
    const first = await runCase(spec, input);
    expect(first.status).toBe("completed");
    expect(first.score).toMatchObject({ expected: 4, truePositives: 4, falsePositives: 0, falseNegatives: 0, negativeHits: 0, precision: 1, recall: 1, countError: 0 });
    expect(first.gates).toEqual({ passed: true, violations: [] });
    expect(first.apiCalls).toBe(0);
    expect(first.render).toMatchObject({ scale: 2.4, canvasWidth: 960, canvasHeight: 720, pageWidth: 400, pageHeight: 300 });
    expect(first.detection).toMatchObject({ tiles: 1, skippedUniformTiles: 0, requests: 0, sentCrops: 0, payloadBytes: 0, workersStarted: 1, workersTerminated: 1 });
    // SymbolSearch stores candidates in PDF units; each lies on a labeled symbol.
    expect(first.detections).toHaveLength(4);

    const second = await runCase(spec, input);
    expect(second.render!.rasterSha256).toBe(first.render!.rasterSha256);
    expect(second.template!.sha256).toBe(first.template!.sha256);
    expect(second.detectionsSha256).toBe(first.detectionsSha256);
  }, 60_000);

  it("scores a symbol missing from the labels as a false positive and fails the gate", async () => {
    const { spec, input } = await setup({ expected: symbols.slice(0, 3).map(s => topLeft(s)) });
    const result = await runCase(spec, input);
    expect(result.score).toMatchObject({ truePositives: 3, falsePositives: 1, falseNegatives: 0 });
    expect(result.gates.passed).toBe(false);
  }, 60_000);

  it("scores a labeled symbol the detector cannot find as a false negative", async () => {
    const { spec, input } = await setup({ expected: [...symbols.map(s => topLeft(s)), topLeft(circle, 16, 16)] });
    const result = await runCase(spec, input);
    expect(result.score).toMatchObject({ truePositives: 4, falsePositives: 0, falseNegatives: 1 });
    expect(result.score!.falseNegativeDetails[0].truth).toBe(4);
    expect(result.gates.passed).toBe(false);
  }, 60_000);

  it("rejects labels placed on blank paper as an input error", async () => {
    const { spec, input } = await setup({ expected: [...symbols.map(s => topLeft(s)), { x: 380, y: 280, w: 10, h: 10 }] });
    const result = await runCase(spec, input);
    expect(result.status).toBe("input-error");
    expect(result.statusDetail).toMatch(/expected\[4\] contains no drawing/);
    expect(result.score).toBeNull();
    expect(result.gates.passed).toBe(false);
  }, 60_000);

  it("rejects a page the PDF does not have as an input error", async () => {
    const { spec, input } = await setup({ page: 3 });
    const result = await runCase(spec, input);
    expect(result).toMatchObject({ status: "input-error", score: null });
    expect(result.statusDetail).toMatch(/out of range/);
  }, 60_000);

  it("reports operator cancellation without scoring partial results", async () => {
    const { spec, input } = await setup();
    const controller = new AbortController();
    controller.abort();
    const result = await runCase(spec, input, { signal: controller.signal });
    expect(result).toMatchObject({ status: "cancelled", score: null, detections: [], apiCalls: 0 });
    expect(result.gates.passed).toBe(false);
  }, 60_000);

  it("reports an exhausted harness budget as timed-out", async () => {
    const { spec, input } = await setup();
    const result = await runCase(spec, input, { caseTimeoutMs: 1 });
    expect(result).toMatchObject({ status: "timed-out", score: null, detections: [] });
    expect(result.statusDetail).toMatch(/harness case budget of 1 ms/);
  }, 60_000);
});
