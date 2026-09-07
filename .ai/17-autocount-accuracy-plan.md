# Detection evaluation and optimization packet — track V

Updated September 7, 2026. Status: current local matcher implemented;
representative real-plan validation and performance improvements remain open.
Coordinate with [parallel execution](18-parallel-execution-plan.md).

## Current pipeline and evidence

The old whole-tile LLM localization task queue is retired. Do not rebuild it
or apply its old confidence blending and automatic filtering instructions.

Current entry points:
- SymbolSearch.tsx renders the PDF and captures a boxed example.
- pipeline.ts tiles the rendered sheet and orchestrates detection/review.
- worker-client.ts and local.worker.ts keep matching off the UI thread.
- local.ts/ncc.ts generate and verify matches at rotations/mirrors and optional
  scale variants; dedupe/mapping convert results into pending takeoffs.
- Optional AI reviews bounded ambiguous crops. It does not locate all symbols
  or approve bid quantities. Failed and negative decisions remain reviewable.

See [current image-detection evidence](13-image-detection.md).
The saved four-fixture local evaluation found 90/90 synthetic symbols with no
extras; individual runs were approximately 51–125 seconds on the recorded
machine. These are prior observations, not a new run or a guarantee.
The worker timeout is 60 seconds per operation/tile, not per whole sheet.

An earlier realistic-sheet failure belongs to a previous pipeline and was
not recorded with enough detail to benchmark the current matcher. Keep it as
motivation; do not call either pipeline accurate on real jobs without labels.

## V1 — Reproducible evaluation inventory

Dependencies: C0; independent of Electron and SQLite.

1. Inventory scripts/eval-local-detection.ts, saved raster manifests, the
   synthetic plan truth, and autocount regression tests. Document which
   scripts exercise local matching versus mocked/live provider behavior.
2. Define a versioned evaluation manifest: input checksum, private local
   path or redistributable fixture ID, page, crop/example box, coordinate
   convention, render scale, expected symbol class/boxes, ignored regions,
   and source/project split. Keep real customer assets outside Git by default.
3. Make the harness use production matcher/tiling/mapping helpers where
   possible; test equivalence where an offline renderer differs.
4. Match predictions to truth one-to-one using a documented distance/overlap
   rule. One prediction cannot satisfy several nearby symbols; extra hits
   are false positives. Count legend swatches as negatives where labeled.
5. Output TP/FP/FN, precision, recall, count error, runtime, option values,
   input hashes, render dimensions, hardware/runtime, and API calls.
   Distinguish cancelled, timed-out, failed, and zero-match runs.
6. Keep regression evaluation offline and deterministic. Add a failing exit
   status for violated accuracy gates; do not hide failures in averages.

Acceptance: existing synthetic totals reproducible; deliberate extra/missing
hits are scored correctly; invalid/unavailable inputs fail clearly. The report
does not suggest it evaluates real plans when only synthetic fixtures ran.

## V2 — Real-plan baseline

Dependencies: V1 and authorized representative drawings/verified labels.

Begin with a few representative projects: clean vector drawings, dense
annotated drawings, and scans/varied line weights. Include rotations,
mirrors, scale changes, nearby text, occlusion, legend examples, sheet edges,
and tile seams. Record intentional exclusions.

The estimator checks the labels independently. AI-generated labels remain
unverified until reviewed. Split by project or design source, not random
near-identical crops; keep the evaluation holdout out of tuning.

Run current defaults before optimizing. Measure per-class/per-sheet results
as well as aggregates, and measure elapsed human review time versus manual
counting. Preserve bad cases as reproducible fixtures when redistribution
is permitted.

Provisional target for useful assisted search: at least 95% precision and
95% recall for each supported class on the held-out set, with visible failure
cases and faster total count-plus-review time than manual work. This is an
engineering target to confirm with the estimator, not achieved accuracy or
permission to auto-accept. Report sample counts; 100% on two symbols says
little about a whole plan set.

If no real plans/labels are available, finish V1 and synthetic benchmarks,
record V2 as awaiting data, and continue independently useful work. Never
invent labels or claim a synthetic result satisfies V2.

## V3 — Profile and improve the measured bottleneck

Dependencies: V1; V2 preferred for acceptance on real data.

- Profile rendering, grayscale conversion, variant preparation, proposal
  scanning, full-pixel verification, deduplication, and UI transfer separately.
- Benchmark a quiet machine, with warmup and repeated runs. Record median/p95
  over enough iterations to make the percentile meaningful; retain raw
  timings, and compare the same inputs/options/runtime.
- Start with avoidable allocations, reusable prepared templates, reduced
  repeated work, and bounded parallelism. Keep the UI responsive and retain
  cancellation; define a memory budget for large pages.
- Consider coarse-to-fine/vector/WASM/GPU approaches only with evidence that
  they improve this workload and preserve recall. No mandatory new model
  runtime or training project is implied by this assignment.
- Preserve thin/sparse/odd-coordinate, faint-line, last-row/column,
  seam, rotation/mirror, and size-tolerance regressions. The earlier stride
  shortcut missed real alignments; restoring it to gain speed is not a fix.
- Keep candidates pending, same-layer deduplication, all-or-nothing
  cancellation, and review/undo behavior. Similarity is not a probability.
- Maintain zero network calls in local-only mode. Optional verification
  remains capped at 48 crops/run and 12/request unless a separately
  justified transport change is coordinated with D3.

Acceptance: no accuracy regression on existing synthetic cases or held-out
real data; reproducible timing evidence and responsive cancellation. If
throughput improves but recall falls, report the tradeoff and do not silently
replace the default.

## V4 — Integration verification

Dependencies: V3 and coordinator integration.

Use the real PDF worker path in browser and packaged Electron: box example,
search, cancel/restart, review hits, accept/reject, undo/redo, save/reload, and
verify resulting estimate quantity. Test repeated search creates no duplicate
marks on the same layer. A provider failure leaves candidates reviewable.
Use mock provider responses only to test transport/review semantics.

Coordinate changes to pipeline.ts, SymbolSearch.tsx, AutoCount.tsx, and API
services with D3; workers do not independently edit the shared transport.

Commands available now:
- npm test
- npm run typecheck
- npm run lint
- npm run eval:local
- npm run test:e2e -- e2e/phase4-autocount.spec.ts

New real-eval/benchmark commands are proposed deliverables; document exact
names after implementing them. A local evaluation can take several minutes.
Do not run expensive sweeps or paid calls merely to refresh a status number.

## Handoff

Input identities/splits, labeling provenance, TP/FP/FN per class, runtime
distributions, review-time comparison, regression outcomes, API calls/cost
when measured, and remaining unsupported cases. Separate current code facts,
historical results, new observations, and proposed targets.
