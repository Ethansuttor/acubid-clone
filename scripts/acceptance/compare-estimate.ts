/**
 * A1 runner: drive an estimate through Voltline's real math and reconcile it
 * against an estimator's recorded expectations.
 *
 *   npm run acceptance -- scripts/acceptance/jobs/synthetic-fixture.json
 *
 * With no argument it runs the synthetic fixture job, which exists so the
 * harness itself can be exercised while real inputs are unavailable. A
 * synthetic run proves the harness works. It does not establish gate G5 and
 * the report says so.
 *
 * A real job uses the same file shape with the estimator's own values, kept
 * outside this repository. Point the runner at that file.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extendEstimate,
  layerQuantities,
  materialRollup,
  estimateTotals,
  summarize,
} from "../../src/lib/estimate";
import {
  assemblies,
  assemblyItems,
  items,
  layers,
  sheet,
  summaryInputs,
  takeoffs,
} from "../../tests/fixtures/fixture-project";
import {
  exitCodeFor,
  reconcile,
  renderReport,
  type ActualLine,
  type ExpectedLine,
  type ExpectedTotals,
  type OpenItem,
  type Tolerances,
} from "./reconcile";

interface JobFile {
  jobAlias: string;
  provenance: "synthetic" | "real";
  measurementTolerances: Tolerances;
  knownUnsupportedScope: string[];
  expectedTotals: ExpectedTotals;
  expectedLines: ExpectedLine[];
}

/**
 * Produce the actual side of the comparison from the fixture project, using
 * the same functions the application uses. Nothing here re-implements the
 * math: a harness with its own arithmetic proves only that it agrees with
 * itself.
 */
export function runSyntheticFixture(): {
  lines: ActualLine[];
  totals: ExpectedTotals;
  openItems: OpenItem[];
} {
  const quantities = layerQuantities(layers, takeoffs, [sheet]);
  const { lines, issues } = extendEstimate(quantities, items, assemblies, assemblyItems);
  const rollup = materialRollup(lines);
  const { materialBase, laborHoursBase } = estimateTotals(lines);
  const summary = summarize({ materialBase, laborHoursBase, ...summaryInputs });

  return {
    lines: rollup.map((row) => ({
      code: row.item.code,
      unit: row.item.unit,
      quantity: row.quantity,
      materialCost: row.materialCost,
      laborHours: row.laborHours,
    })),
    totals: { materialBase, laborHoursBase, bidPrice: summary.bidPrice },
    openItems: issues.map((issue) => ({
      kind: issue.kind,
      detail: `${issue.layerName}: ${issue.detail}`,
      severity: issue.severity,
    })),
  };
}

export function loadJob(path: string): JobFile {
  const job = JSON.parse(readFileSync(path, "utf8")) as JobFile;
  if (!job.measurementTolerances) {
    throw new Error(
      `${path} has no measurementTolerances. The estimator records tolerances before the comparison; the harness will not choose them.`
    );
  }
  return job;
}

function main(): void {
  const path = process.argv[2] ?? "scripts/acceptance/jobs/synthetic-fixture.json";
  const job = loadJob(path);

  if (job.provenance !== "synthetic") {
    // A real job's actual side comes from a workspace export, which A2 produces.
    // Refuse rather than quietly reconciling a real expectation against fixture
    // numbers, which would manufacture a passing report for a job never run.
    console.error(
      `${path} is a real job. Reconciling it needs an exported workspace from the A2 run; this runner currently drives only the repository fixture.`
    );
    process.exit(2);
  }

  const actual = runSyntheticFixture();
  const result = reconcile({
    jobAlias: job.jobAlias,
    provenance: job.provenance,
    tolerances: job.measurementTolerances,
    expectedLines: job.expectedLines,
    actualLines: actual.lines,
    expectedTotals: job.expectedTotals,
    actualTotals: actual.totals,
    openItems: actual.openItems,
    knownUnsupportedScope: job.knownUnsupportedScope ?? [],
  });

  console.log(renderReport(result));
  process.exit(exitCodeFor(result));
}

// Run only when invoked directly, so tests can import the harness functions.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
