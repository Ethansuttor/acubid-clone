# Known-estimate acceptance packet — track A

Updated September 7, 2026. Status: protocol ready; real-job acceptance not yet
established by this review. Coordinate through [the parallel plan](18-parallel-execution-plan.md).

## The question this answers

Can the estimator use Voltline to reproduce their own completed electrical bid,
recover it, and obtain the same supported quantities, labor, and commercial
results? Synthetic tests establish useful properties, but they do not define
the contractor's estimating practice.

Start with one completed job whose inputs and outputs are available and
trusted. Expand to medium/large and revised jobs after the first reconciles.
Do not block desktop/storage work while waiting for reference data.

## A1 — Prepare inputs and a comparison harness

Dependencies: C0. Own: tests/acceptance/**, scripts/acceptance/**,
e2e/acceptance/** after the coordinator reserves test configuration.

Required real-job inputs:
- Original PDFs with sheet/page identifiers and addendum versions.
- Known-dimension calibration references per measured sheet.
- Checked counts, runs, rise/drop allowances, areas, and typical multipliers.
- Contractor-provided catalog/assemblies, units, prices, labor units, and the
  pricing date. Use data the user has supplied or authorized.
- Rates, waste, escalation, tax, burden, small tools, contingency, overhead,
  profit, bond, direct-cost treatment, allowances, alternates, and exclusions.
- A trusted line-level export and final bid/proposal, not just a total.

Keep private source data outside tracked fixtures unless explicitly intended
for the repo. Reports use a job alias and checksums; preserve source locations
in a private manifest. Never upload drawings merely to label them.

Build the comparison/report scaffolding using the existing hand-calculated
fixture while real data is unavailable. Label that run synthetic. Do not
fabricate a customer estimate.

Suggested manifest fields:
jobAlias, sourceHashes, sourceRevision, expectationAuthor, expectationDate,
calibrationReferences, catalogSource, commercialPolicy, expectedLineFile,
expectedTotals, measurementTolerances, knownUnsupportedFeatures.

Use CSV/JSON inputs for automated comparisons; do not embed customer financial
data into source code or use UI screenshots as the only expected values.

## A2 — Reproduce the browser estimate

Dependencies: A1 and complete real inputs.

1. Create a fresh isolated workspace and import the supplied catalog using
   the existing supported format. Verify price/labor units (EA/FT/SF and any
   per-hundred/per-thousand conversions) instead of guessing.
2. Load PDFs, select the intended revision, and calibrate against known
   dimensions. Spot-check an independent dimension. Mixed-scale details
   require explicit treatment; do not apply one sheet scale by assumption.
3. Recreate layers and their item/assembly links, rise/drop, multipliers, and
   area/system/phase tags. Count manually first when needed to separate
   estimating correctness from detection quality.
4. Compare raw quantity, multiplied quantity, assembly components, material
   extension, labor hours, and rollups line by line. Report unpriced and
   unmapped quantities.
5. Enter the commercial settings. Compare every intermediate subtotal and
   final price. Explain the existing reference-only allowance/alternate
   behavior; do not silently include amounts in the base bid.
6. Compare Scope proposal, Summary, Excel, and a frozen revision. Breakdown
   groups including Unassigned/direct costs must reconcile to the total.
7. Change a catalog price after freezing a revision and confirm the captured
   revision is unchanged. The live estimate may reprice; document that
   distinction.
8. Resolve blockers before issuing output, and verify that pending detections,
   invalid inputs, missing quantity, and failed saves cannot produce a
   clean issued bid through export or browser printing.

## Comparison rules

| Value | Acceptance |
| --- | --- |
| Counts and assembly references | Exact agreement after explicit scope mapping |
| PDF identity and restored bytes | Exact hash agreement |
| Stored geometry/settings/snapshot payload | Exact logical preservation through migration |
| Manually traced lengths/areas | Estimator-defined tolerance recorded before comparison |
| Deterministic formula fixtures | Existing precision expectations; no mid-chain rounding |
| Currency shown/exported | Expected rounded output under the agreed policy |
| Commercial subtotal differences | Explained by a documented policy difference or fixed |
| Unsupported scope/alternates | Visible open item; never counted as a pass |

Do not pick a percentage tolerance that makes a wrong bid pass. A matching
grand total can conceal offsetting material and labor errors. Compare both
components and totals.

## A3 — Turn discrepancies into bounded tasks

For each discrepancy record:
- reference line/sheet and expected source;
- exact reproduction steps and input values;
- expected versus actual, units, and difference;
- classification: missing feature, arithmetic, measurement, mapping, stale
  source, policy difference, persistence, or output formatting;
- severity and proposed acceptance example;
- code owner and related D/S/V task.

Independently calculate an example before changing formulas. If the existing
app and reference use different commercial policies, present the example to
the estimator and preserve both results until the intended rule is established.
A preference question does not block unrelated shell or recovery work.

Do not refactor core math just to make one grand total match. Implement fixes
as separately assigned work with meaningful regression cases and shared-file
coordination. Snapshot history must not be rewritten by a correction.

## A4 — Repeat in the installed Windows candidate

Dependencies: D4 candidate, I1/I2 integration, S3 migration, A2 reference.

- Install as a standard Windows user with no Node/development environment.
- Import the browser .voltline.json backup and check all IDs, records,
  calibration, statuses, frozen revisions, PDF hashes, and live totals.
- Work offline: open PDFs, edit a takeoff, save, restart, and re-export.
- In an isolated test profile, terminate after acknowledged save and reopen.
  Verify the last committed edit and unchanged totals.
- Back up, restore into a separate empty desktop workspace, and reproduce
  the same report. Never overwrite the only real-job copy for this drill.
- Try a damaged backup and an occupied target; both must preserve existing
  data and report why restoration cannot proceed.
- Upgrade from the previous candidate and repeat the integrity comparison.
- Time common operations: opening a plan, switching sheets, placing marks,
  navigating layers, editing rates, and reviewing search hits. Record the
  estimator's friction, not just engine benchmark time.

## Completion report

Job alias/reference hashes:
App version and commit/tree identity:
Machine/Windows/runtime:
Matched lines and totals:
Measurement tolerances:
Unmapped/unsupported scope:
Discrepancies accepted by estimator:
Discrepancies fixed and regression tests:
Offline/restart/crash evidence:
Migration/backup/restore/upgrade evidence:
Export artifacts (private location where applicable):
Estimator acceptance: pending / accepted with limits / accepted
Remaining release blockers:

A missing real dataset means "protocol implemented; real acceptance pending."
It does not mean Voltline has passed the contractor's workflow.
