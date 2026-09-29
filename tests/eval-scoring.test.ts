// One-to-one detection scoring and accuracy gates for the evaluation harness.
// Deliberately injected extra, missing, duplicate and legend hits must be
// scored exactly; gates must fail on any single bad case.
import { describe, expect, it } from "vitest";
import { evaluateMatches, scoreDetections } from "../scripts/eval/scoring";
import { evaluateGates } from "../scripts/eval/gates";
import { buildReport, exitCodeFor, renderText, scopeStatement, totalsOf, EXIT } from "../scripts/eval/report";
import type { Gates, Manifest } from "../scripts/eval/manifest";
import type { CaseResult } from "../scripts/eval/harness";

// Three 72 × 36 troffers 200 pt apart (half-diagonal ≈ 40.25 pt).
const truth = [0, 1, 2].map(i => ({ x: 100 + 200 * i - 36, y: 82, w: 72, h: 36 }));
const at = (cx: number, cy: number, w = 72, h = 36, confidence = 0.9) => ({ x: cx - w / 2, y: cy - h / 2, w, h, confidence });
const exact = () => [at(100, 100), at(300, 100), at(500, 100)];
const strict: Gates = { minPrecision: 1, minRecall: 1, maxFalsePositives: 0, maxFalseNegatives: 0, maxNegativeHits: 0, maxApiCalls: 0, allowedStatus: ["completed"] };

describe("one-to-one scoring", () => {
  it("scores exact detections as all true positives", () => {
    const s = scoreDetections(exact(), truth);
    expect(s).toMatchObject({ expected: 3, predicted: 3, truePositives: 3, falsePositives: 0, falseNegatives: 0, precision: 1, recall: 1, f1: 1, countError: 0 });
    expect(evaluateGates("completed", s, 0, strict)).toEqual({ passed: true, violations: [] });
  });

  it("counts an injected extra hit as a false positive", () => {
    const s = scoreDetections([...exact(), at(700, 400)], truth);
    expect(s).toMatchObject({ truePositives: 3, falsePositives: 1, falseNegatives: 0, countError: 1 });
    expect(s.precision).toBeCloseTo(0.75, 12);
    expect(s.falsePositiveDetails).toEqual([{ prediction: 3, center: { x: 700, y: 400 }, confidence: 0.9 }]);
    const gate = evaluateGates("completed", s, 0, strict);
    expect(gate.passed).toBe(false);
    expect(gate.violations.join()).toMatch(/1 false positive/);
  });

  it("counts an injected missing hit as a false negative", () => {
    const s = scoreDetections(exact().slice(0, 2), truth);
    expect(s).toMatchObject({ truePositives: 2, falsePositives: 0, falseNegatives: 1, precision: 1, countError: -1 });
    expect(s.recall).toBeCloseTo(2 / 3, 12);
    expect(s.falseNegativeDetails).toEqual([{ truth: 2, center: { x: 500, y: 100 } }]);
    expect(evaluateGates("completed", s, 0, strict).violations.join()).toMatch(/recall 66\.67%.*1 false negative/);
  });

  it("does not let two predictions satisfy one symbol", () => {
    const s = scoreDetections([at(100, 100), at(104, 101), at(300, 100), at(500, 100)], truth);
    expect(s).toMatchObject({ truePositives: 3, falsePositives: 1, falseNegatives: 0 });
    expect(s.falsePositiveDetails[0].prediction).toBe(1); // the farther duplicate
  });

  it("does not let one prediction satisfy two nearby symbols", () => {
    const close = [{ x: 0, y: 0, w: 20, h: 20 }, { x: 16, y: 0, w: 20, h: 20 }]; // centers 16 pt apart, radius 14.1
    const s = scoreDetections([at(18, 10, 20, 20)], close);
    expect(s).toMatchObject({ truePositives: 1, falsePositives: 0, falseNegatives: 1 });
  });

  it("finds the maximum one-to-one matching instead of a greedy one", () => {
    // P0 is nearest T0 but also within T1's radius; P1 can only reach T0.
    // Greedy nearest-first would pair P0-T0 and leave T1 and P1 unmatched.
    const symbols = [{ x: 0, y: 0, w: 20, h: 20 }, { x: 12, y: 0, w: 20, h: 20 }];
    const predictions = [at(15, 10, 20, 20), at(4, 10, 20, 20)];
    const s = scoreDetections(predictions, symbols);
    expect(s).toMatchObject({ truePositives: 2, falsePositives: 0, falseNegatives: 0 });
    expect(s.matches.map(m => [m.prediction, m.truth])).toEqual([[1, 0], [0, 1]]);
  });

  it("does not depend on prediction order", () => {
    const predictions = [at(100, 100), at(104, 101), at(300, 130), at(900, 900), at(500, 100)];
    const forward = scoreDetections(predictions, truth);
    const reversed = scoreDetections([...predictions].reverse(), truth);
    for (const key of ["truePositives", "falsePositives", "falseNegatives"] as const) expect(reversed[key]).toBe(forward[key]);
  });

  it("applies the documented half-diagonal radius", () => {
    const radius = 0.5 * Math.hypot(72, 36);
    expect(scoreDetections([at(100 + radius - 1e-9, 100)], truth).truePositives).toBe(1);
    expect(scoreDetections([at(100 + radius + 1e-6, 100)], truth).truePositives).toBe(0);
    expect(scoreDetections([at(100 + radius - 1e-9, 100)], truth, { radiusScale: 0.5 }).truePositives).toBe(0);
  });

  it("counts legend swatches as labeled negatives, never as matches", () => {
    const legend = [{ label: "legend swatch: troffer", box: { x: 261, y: 291, w: 38, h: 18 } }];
    const s = scoreDetections([...exact(), at(280, 300, 36, 16)], truth, { negatives: legend });
    expect(s).toMatchObject({ truePositives: 3, falsePositives: 1, negativeHits: 1 });
    expect(s.falsePositiveDetails[0].negativeLabel).toBe("legend swatch: troffer");
    expect(evaluateGates("completed", s, 0, strict).violations.join()).toMatch(/1 hit\(s\) on labeled negatives/);
  });

  it("excludes predictions inside ignored regions from both precision and recall", () => {
    const ignore = [{ label: "title block", box: { x: 800, y: 0, w: 200, h: 800 } }];
    const s = scoreDetections([...exact(), at(900, 400)], truth, { ignore });
    expect(s).toMatchObject({ predicted: 3, ignored: 1, truePositives: 3, falsePositives: 0, precision: 1 });
    expect(s.ignoredPredictions).toEqual([3]);
  });

  it("reports undefined ratios as null so an empty run cannot look perfect", () => {
    const none = scoreDetections([], truth);
    expect(none).toMatchObject({ precision: null, recall: 0, f1: null, falseNegatives: 3, countError: -3 });
    expect(evaluateGates("zero-match", none, 0, strict).violations.join()).toMatch(/status "zero-match".*precision undefined.*recall 0\.00%/);
    const negativeOnly = scoreDetections([], []);
    expect(negativeOnly).toMatchObject({ precision: null, recall: null, f1: null });
    expect(evaluateGates("zero-match", negativeOnly, 0, { ...strict, allowedStatus: ["completed", "zero-match"] }).passed).toBe(true);
  });

  it("fails the gate when a false positive and a false negative offset in the count", () => {
    const s = scoreDetections([at(100, 100), at(300, 100), at(700, 700)], truth);
    expect(s).toMatchObject({ countError: 0, falsePositives: 1, falseNegatives: 1 });
    expect(evaluateGates("completed", s, 0, { ...strict, maxAbsCountError: 0 }).passed).toBe(false);
  });

  it("rejects malformed boxes rather than scoring them", () => {
    expect(() => scoreDetections([{ x: NaN, y: 0, w: 1, h: 1 }], truth)).toThrow(/prediction\[0\]/);
    expect(() => scoreDetections([], [{ x: 0, y: 0, w: 0, h: 1 }])).toThrow(/truth\[0\]/);
  });

  it("keeps the historical evaluateMatches result shape for existing scripts", () => {
    const centered = [{ x: 100, y: 100, w: 72, h: 36 }, { x: 300, y: 100, w: 72, h: 36 }];
    expect(evaluateMatches([at(100, 100), at(900, 900)], centered)).toEqual({ truePositives: 1, falsePositives: 1, falseNegatives: 1, precision: 0.5, recall: 0.5, f1: 0.5 });
    expect(evaluateMatches([], [])).toEqual({ truePositives: 0, falsePositives: 0, falseNegatives: 0, precision: 0, recall: 0, f1: 0 });
  });
});

describe("gates and run status", () => {
  const perfect = scoreDetections(exact(), truth);
  it.each(["failed", "timed-out", "cancelled", "input-error"] as const)("a %s case fails even without a score", status => {
    const gate = evaluateGates(status, null, 0, strict);
    expect(gate.passed).toBe(false);
    expect(gate.violations[0]).toContain(`status "${status}"`);
  });
  it("fails any case that made an API call", () => {
    expect(evaluateGates("completed", perfect, 1, strict).violations).toEqual(["1 provider/API call(s); local-only evaluation allows 0"]);
  });

  function caseResult(id: string, status: CaseResult["status"], passed: boolean): CaseResult {
    return { id, status, gates: { passed, violations: passed ? [] : ["x"] }, score: passed ? perfect : null, apiCalls: 0, detections: [], expectedCount: 3 } as unknown as CaseResult;
  }
  it("does not let totals hide a failing case", () => {
    const cases = [caseResult("a", "completed", true), caseResult("b", "failed", false), caseResult("c", "completed", true)];
    expect(exitCodeFor(cases, false)).toBe(EXIT.gateFailure);
    expect(totalsOf(cases)).toMatchObject({ cases: 3, byStatus: { completed: 2, failed: 1 }, truePositives: 6, expected: 6 });
    const manifest = { id: "m", format: "voltline-detection-eval", version: 1, description: "d", evidenceClass: "synthetic", cases: cases.map(c => ({ id: c.id })) } as unknown as Manifest;
    const report = buildReport(manifest, "m.json", "0".repeat(64), {} as never, cases, false);
    expect(report.passed).toBe(false);
    expect(report.selection).toEqual({ manifestCases: 3, casesRun: 3, partial: false });
    expect(report.failingCases.map(f => f.id)).toEqual(["b"]);
    expect(report.scope).toEqual({ evidenceClass: "synthetic", statement: scopeStatement("synthetic"), g6: "unverified" });
  });
  it("labels a run of only some manifest cases as partial, in the data and the text", () => {
    const manifest = { id: "m", format: "voltline-detection-eval", version: 1, description: "d", evidenceClass: "synthetic", cases: [{ id: "a" }, { id: "b" }] } as unknown as Manifest;
    const env = { git: { commit: null, dirty: false }, loadAverage1m: [0], renderer: { pdfjsVersion: "x", canvasVersion: "y" } } as never;
    const report = buildReport(manifest, "m.json", "0".repeat(64), env, [caseResult("a", "completed", true)], false);
    expect(report.selection).toEqual({ manifestCases: 2, casesRun: 1, partial: true });
    expect(renderText({ ...report, cases: [] })).toMatch(/PARTIAL RUN: 1 of 2 manifest cases/);
    expect(renderText({ ...report, cases: [] })).toMatch(/\(PARTIAL RUN\)/);
  });
  it("orders exit codes: cancelled > input error > gate failure > ok", () => {
    expect(exitCodeFor([caseResult("a", "completed", true)], false)).toBe(EXIT.ok);
    expect(exitCodeFor([caseResult("a", "input-error", false), caseResult("b", "failed", false)], false)).toBe(EXIT.inputError);
    expect(exitCodeFor([caseResult("a", "input-error", false)], true)).toBe(EXIT.cancelled);
  });
  it("states the synthetic scope and that G6 stays unverified", () => {
    expect(scopeStatement("synthetic")).toMatch(/SYNTHETIC FIXTURES ONLY.*nothing about detection accuracy on real plans.*G6.*UNVERIFIED/);
    expect(scopeStatement("real")).toMatch(/estimator-verified labels on a project-level holdout/);
  });
});
