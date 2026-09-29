// One-to-one scoring of detections against labeled symbols. Pure; no I/O.
//
// Rule (manifest scoring "center-distance" / "truth-half-diagonal"):
//   1. A prediction whose center lies inside an ignored region is excluded
//      from scoring entirely (neither true nor false positive).
//   2. A prediction may match a labeled symbol when the distance between the
//      prediction's center and the symbol's center is at most
//      radiusScale × half the symbol box's diagonal.
//   3. Matching is one-to-one and of maximum cardinality: each prediction
//      satisfies at most one symbol and each symbol at most one prediction.
//      Pairs are first taken greedily by increasing distance, then augmenting
//      paths raise the matching to maximum size, so the result never depends
//      on prediction order and a stray prediction cannot "steal" a symbol that
//      would leave another symbol unmatched.
//   4. Every unmatched prediction is a false positive. If its center lies in a
//      labeled negative region (e.g. a legend swatch) it is also counted as a
//      negative hit; it is never excused.
//   5. Every unmatched labeled symbol is a false negative.
// Precision/recall are null (not 0 or 1) when undefined, so an empty run
// cannot look perfect or be averaged away.

import type { LabeledRegion, PageBox } from "./manifest";

export interface ScoredBox extends PageBox { confidence?: number }

export interface ScoringOptions { radiusScale: number }

export interface Match { prediction: number; truth: number; distance: number }
export interface FalsePositive { prediction: number; center: { x: number; y: number }; confidence?: number; negativeLabel?: string }
export interface FalseNegative { truth: number; center: { x: number; y: number } }

export interface Score {
  expected: number;
  /** Predictions that were scored (not in ignored regions). */
  predicted: number;
  ignored: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  /** False positives whose centers fall in labeled negative regions. */
  negativeHits: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  /** predicted − expected: positive means over-count. Can be 0 while FP and FN offset. */
  countError: number;
  matches: Match[];
  falsePositiveDetails: FalsePositive[];
  falseNegativeDetails: FalseNegative[];
  ignoredPredictions: number[];
}

export interface CenteredSymbol { x: number; y: number; w: number; h: number }

/**
 * Compatibility wrapper for the historical scripts (eval-autocount.ts,
 * eval-local-detection.ts). Their truth symbols are centre points with sizes,
 * as in test-assets/sample-plan-truth.json, and they report undefined ratios
 * as 0. Matching uses the same one-to-one rule as scoreDetections.
 */
export function evaluateMatches(detections: PageBox[], truths: CenteredSymbol[]) {
  const score = scoreDetections(detections, truths.map(t => ({ x: t.x - t.w / 2, y: t.y - t.h / 2, w: t.w, h: t.h })));
  return {
    truePositives: score.truePositives,
    falsePositives: score.falsePositives,
    falseNegatives: score.falseNegatives,
    precision: score.precision ?? 0,
    recall: score.recall ?? 0,
    f1: score.f1 ?? 0,
  };
}

export const boxCenter = (box: PageBox) => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
const inside = (box: PageBox, p: { x: number; y: number }) => p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;

function assertBoxes(boxes: PageBox[], name: string) {
  boxes.forEach((b, i) => {
    if (![b.x, b.y, b.w, b.h].every(Number.isFinite) || b.w <= 0 || b.h <= 0) throw new Error(`${name}[${i}] is not a finite box with positive size.`);
  });
}

export function scoreDetections(
  predictions: ScoredBox[],
  truths: PageBox[],
  { negatives = [], ignore = [], radiusScale = 1 }: { negatives?: LabeledRegion[]; ignore?: LabeledRegion[] } & Partial<ScoringOptions> = {},
): Score {
  assertBoxes(predictions, "prediction");
  assertBoxes(truths, "truth");
  if (!Number.isFinite(radiusScale) || radiusScale <= 0) throw new Error("radiusScale must be positive.");

  const ignoredPredictions: number[] = [];
  const scored: number[] = [];
  predictions.forEach((p, i) => (ignore.some(r => inside(r.box, boxCenter(p))) ? ignoredPredictions : scored).push(i));

  // Candidate pairs within the radius, nearest first; ties broken by index for determinism.
  const pairs: Match[] = [];
  for (const pi of scored) {
    const pc = boxCenter(predictions[pi]);
    truths.forEach((t, ti) => {
      const tc = boxCenter(t);
      const distance = Math.hypot(pc.x - tc.x, pc.y - tc.y);
      if (distance <= radiusScale * 0.5 * Math.hypot(t.w, t.h)) pairs.push({ prediction: pi, truth: ti, distance });
    });
  }
  pairs.sort((a, b) => a.distance - b.distance || a.truth - b.truth || a.prediction - b.prediction);

  const truthOf = new Map<number, number>(); // prediction -> truth
  const predictionOf = new Map<number, number>(); // truth -> prediction
  for (const pair of pairs) {
    if (truthOf.has(pair.prediction) || predictionOf.has(pair.truth)) continue;
    truthOf.set(pair.prediction, pair.truth);
    predictionOf.set(pair.truth, pair.prediction);
  }

  // Augmenting paths (Kuhn) from each unmatched truth: raises the greedy
  // matching to maximum cardinality without unmatching any symbol.
  const neighbors = new Map<number, number[]>();
  for (const pair of pairs) {
    const list = neighbors.get(pair.truth) ?? [];
    list.push(pair.prediction);
    neighbors.set(pair.truth, list);
  }
  const augment = (truth: number, visited: Set<number>): boolean => {
    for (const prediction of neighbors.get(truth) ?? []) {
      if (visited.has(prediction)) continue;
      visited.add(prediction);
      const holder = truthOf.get(prediction);
      if (holder === undefined || augment(holder, visited)) {
        truthOf.set(prediction, truth);
        predictionOf.set(truth, prediction);
        return true;
      }
    }
    return false;
  };
  truths.forEach((_, ti) => { if (!predictionOf.has(ti)) augment(ti, new Set()); });

  const distanceOf = new Map(pairs.map(p => [`${p.prediction}:${p.truth}`, p.distance]));
  const matches: Match[] = [...predictionOf.entries()]
    .map(([truth, prediction]) => ({ prediction, truth, distance: distanceOf.get(`${prediction}:${truth}`)! }))
    .sort((a, b) => a.truth - b.truth);

  const falsePositiveDetails: FalsePositive[] = scored.filter(pi => !truthOf.has(pi)).map(pi => {
    const center = boxCenter(predictions[pi]);
    const negative = negatives.find(r => inside(r.box, center));
    return { prediction: pi, center, ...(predictions[pi].confidence !== undefined ? { confidence: predictions[pi].confidence } : {}), ...(negative ? { negativeLabel: negative.label } : {}) };
  });
  const falseNegativeDetails: FalseNegative[] = truths.map((t, truth) => ({ truth, center: boxCenter(t) })).filter(({ truth }) => !predictionOf.has(truth));

  const tp = matches.length, fp = falsePositiveDetails.length, fn = falseNegativeDetails.length;
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = truths.length > 0 ? tp / truths.length : null;
  const f1 = precision !== null && recall !== null ? (precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0) : null;
  return {
    expected: truths.length,
    predicted: scored.length,
    ignored: ignoredPredictions.length,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    negativeHits: falsePositiveDetails.filter(d => d.negativeLabel).length,
    precision,
    recall,
    f1,
    countError: scored.length - truths.length,
    matches,
    falsePositiveDetails,
    falseNegativeDetails,
    ignoredPredictions,
  };
}
