// Run-status classification and API-call counting in the evaluation harness.
// detectOnCanvas is replaced so each outcome can be forced; the real pipeline
// path is covered by eval-harness.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, rgb } from "pdf-lib";
import { parseManifest, sha256, type ResolvedInput } from "../scripts/eval/manifest";

const detect = vi.hoisted(() => vi.fn());
vi.mock("@/lib/autocount/pipeline", async importOriginal => ({ ...(await importOriginal<object>()), detectOnCanvas: detect }));
const { runCase } = await import("../scripts/eval/harness");

async function setup() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 100]);
  page.drawRectangle({ x: 40, y: 40, width: 20, height: 10, borderWidth: 1, borderColor: rgb(0, 0, 0) });
  const bytes = await doc.save();
  const box = { x: 40, y: 50, w: 20, h: 10 };
  const manifest = parseManifest(JSON.stringify({
    format: "voltline-detection-eval", version: 1, id: "status", description: "d", evidenceClass: "synthetic", coordinateConvention: "pdf-top-left-points",
    inputs: { plan: { kind: "pdf", fixtureId: "status", redistributable: true, path: "x.pdf", sha256: sha256(bytes) } },
    cases: [{
      id: "c", input: "plan", page: 1, sheet: "S", symbolClass: "rect", labelProvenance: "synthetic-generator",
      split: { project: "p", source: "s", set: "regression" }, example: { box }, expected: [box],
      detector: { minScore: 0.72, scaleTolerance: false }, render: { scale: "symbol-search" },
      scoring: { rule: "center-distance", radius: "truth-half-diagonal", radiusScale: 1 },
      gates: { minRecall: 1, maxFalsePositives: 0, maxApiCalls: 0, allowedStatus: ["completed"] },
    }],
  }));
  const input: ResolvedInput = { key: "plan", spec: manifest.inputs.plan, absolutePath: "x.pdf", bytes, sha256: sha256(bytes) };
  return { spec: manifest.cases[0], input };
}

const stats = { tiles: 1, skipped: 0, duplicates: 0, sentCrops: 0, requests: 0, payloadBytes: 0 };
// Block body: a returned function would be run by Vitest as a cleanup hook.
beforeEach(() => { detect.mockReset(); });

describe("run status classification", () => {
  it("distinguishes a zero-match run from a failure and scores it as all misses", async () => {
    detect.mockResolvedValue({ detections: [], model: "Local image matcher", warning: "", stats });
    const { spec, input } = await setup();
    const result = await runCase(spec, input);
    expect(result.status).toBe("zero-match");
    expect(result.score).toMatchObject({ truePositives: 0, falseNegatives: 1, precision: null, recall: 0 });
    expect(result.gates.violations.join()).toMatch(/status "zero-match"/);
  });

  it("reports the production worker's tile timeout as timed-out", async () => {
    detect.mockRejectedValue(new Error("A detection tile timed out. Try a smaller symbol or disable size tolerance."));
    const { spec, input } = await setup();
    const result = await runCase(spec, input);
    expect(result).toMatchObject({ status: "timed-out", score: null });
    expect(result.statusDetail).toMatch(/tile timed out/);
  });

  it("reports any other detector error as failed", async () => {
    detect.mockRejectedValue(new Error("More than 2,500 candidates found."));
    const { spec, input } = await setup();
    const result = await runCase(spec, input);
    expect(result).toMatchObject({ status: "failed", statusDetail: "More than 2,500 candidates found.", score: null });
  });

  it("counts every attempted network request and fails the zero-API gate", async () => {
    detect.mockImplementation(async (canvas: { width: number }) => {
      await fetch("/api/autocount").catch(() => undefined);
      // Render scale is 72 / 20 = 3.6: the labeled 20 × 10 box centred at (50, 55) pt is (180, 198) px.
      return { detections: [{ x: 144, y: 180, w: 72, h: 36, confidence: 1, review: "local" }], model: "m", warning: "", stats: { ...stats, tiles: canvas.width > 0 ? 1 : 0 } };
    });
    const { spec, input } = await setup();
    const originalFetch = globalThis.fetch;
    const result = await runCase(spec, input);
    expect(result.status).toBe("completed");
    expect(result.score).toMatchObject({ truePositives: 1, falsePositives: 0 });
    expect(result.apiCalls).toBe(1);
    expect(result.gates.violations).toEqual(["1 provider/API call(s); local-only evaluation allows 0"]);
    expect(globalThis.fetch).toBe(originalFetch); // the harness restores the global afterwards
  });
});
