// Accuracy gates for one evaluation case. Pure; no I/O.
// Every case is judged on its own numbers. A run fails if any case fails;
// totals are reported for context but never used to pass a failing case.

import type { Gates, RunStatus } from "./manifest";
import type { Score } from "./scoring";

export interface GateResult { passed: boolean; violations: string[] }

const pct = (value: number) => `${(value * 100).toFixed(2)}%`;

export function evaluateGates(status: RunStatus, score: Score | null, apiCalls: number, gates: Gates): GateResult {
  const violations: string[] = [];
  if (!gates.allowedStatus.includes(status)) violations.push(`status "${status}" is not an allowed outcome (${gates.allowedStatus.join(", ")})`);
  if (apiCalls > gates.maxApiCalls) violations.push(`${apiCalls} provider/API call(s); local-only evaluation allows ${gates.maxApiCalls}`);
  if (!score) {
    if (!violations.length) violations.push("no score was produced");
    return { passed: false, violations };
  }
  if (gates.minPrecision !== undefined) {
    // Undefined precision (no predictions) only satisfies the gate when nothing was expected.
    if (score.precision === null ? score.expected > 0 : score.precision < gates.minPrecision) {
      violations.push(`precision ${score.precision === null ? "undefined (no predictions)" : pct(score.precision)} < required ${pct(gates.minPrecision)}`);
    }
  }
  if (gates.minRecall !== undefined && score.recall !== null && score.recall < gates.minRecall) {
    violations.push(`recall ${pct(score.recall)} < required ${pct(gates.minRecall)}`);
  }
  if (gates.maxFalsePositives !== undefined && score.falsePositives > gates.maxFalsePositives) violations.push(`${score.falsePositives} false positive(s) > allowed ${gates.maxFalsePositives}`);
  if (gates.maxFalseNegatives !== undefined && score.falseNegatives > gates.maxFalseNegatives) violations.push(`${score.falseNegatives} false negative(s) > allowed ${gates.maxFalseNegatives}`);
  if (gates.maxNegativeHits !== undefined && score.negativeHits > gates.maxNegativeHits) violations.push(`${score.negativeHits} hit(s) on labeled negatives > allowed ${gates.maxNegativeHits}`);
  if (gates.maxAbsCountError !== undefined && Math.abs(score.countError) > gates.maxAbsCountError) violations.push(`count error ${score.countError > 0 ? "+" : ""}${score.countError} exceeds ±${gates.maxAbsCountError}`);
  return { passed: violations.length === 0, violations };
}
