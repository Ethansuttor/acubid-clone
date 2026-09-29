# Detection evaluation

Offline, deterministic evaluation of Voltline's local symbol search. It makes
no network or provider calls. **The tracked manifests cover synthetic fixtures
only**: a pass says the matcher still finds every generator-labeled symbol on
those drawings. It says nothing about real plans, and release gate G6 (real-plan
precision/recall) stays unverified until estimator-verified labels exist.

## Commands

| Command | What it does |
| --- | --- |
| `npm run eval:detection` | Regenerates everything from tracked inputs and evaluates every manifest in `evaluation/manifests/`. Exit 0 only if every case meets its gates. |
| `npm run eval:detection -- --case E-102-switch --no-artifacts` | One case (report is marked PARTIAL). Other flags: `--manifest <file>`, `--out <dir>`, `--case-timeout-ms <n>`, `--summary-out <file>`. |
| `npm run eval:manifests` | Fails if the committed synthetic manifests are stale relative to their generator. Regenerate with `npx tsx scripts/eval/make-synthetic-manifests.ts`. |
| `npm run eval:local` | Legacy reproduction of the September 7 result on Python-rendered rasters (needs `pip install -r scripts/requirements-eval.txt`). Not the application path; see below. |

Output goes to `eval-out/detection-eval/<manifest id>/` (git-ignored): `report.json`,
`report.md`, and diagnostic PNGs (template, false-positive and false-negative
crops). The recorded full synthetic run took 6 min 53 s on a shared 4-core
machine (sample-plan cases 85-119 s each, E2E-plan cases about 10 s each);
timings are single runs and indicative only. Its compact summary is committed
as `evaluation/results/synthetic-baseline.json` (`--summary-out` writes one).

Exit status: `0` all gates met; `1` a gate was violated (including a failed,
timed-out or zero-match case); `2` a manifest or input is missing, invalid, has
the wrong checksum, or a label lies off the page or on blank paper; `3` harness
crash; `130` cancelled.

## What runs

`scripts/eval/harness.ts` renders the page with pdf.js (same package version as
the app, Node build, `@napi-rs/canvas`) at the scale `SymbolSearch.tsx` would
choose, crops the example exactly as the component does, then calls the
production `detectOnCanvas` (tiling, uniform-tile skip, cross-tile dedupe),
`worker-client.ts` and `local.worker.ts` (in a Node worker thread through
`scripts/eval/node-worker.ts`), `local.ts`/`ncc.ts` and `mapDetectionsToSheet`.
Detections stay pending candidates in PDF units, as in the app. `fetch` is
replaced by a counting stub that always fails, so any request shows up as an
API call and fails the zero-call gate.

Not exercised: the browser canvas and its font substitution (see
"Renderer differences" in every report), the React UI, and any optional AI review
(the count of crops it *would* send is reported; nothing is sent).

## Manifest format (version 1)

`scripts/eval/manifest.ts` is the validator; unknown fields, missing values,
duplicate IDs and contradictory labels are errors, not guesses.

- **inputs**: each has a `sha256`, a `kind` (`pdf`), and either a redistributable
  repository `path` plus a `fixtureId`, or a private `privatePath` resolved
  under `$VOLTLINE_EVAL_PRIVATE_DIR`. Private inputs must live outside the
  repository and are reported by relative path only. Real customer drawings are
  never committed.
- **cases**: `page` (1-based), `sheet`, `symbolClass`, `example.box`, `expected`
  boxes, `negatives` (labeled regions such as legend swatches; a hit there is a
  false positive that is also counted separately), `ignore` (predictions centered
  in these regions are excluded from scoring), `detector` options, `render`
  scale policy, `scoring` rule, `gates`, and `split` (`project`, `source`,
  `set`: `regression` | `tuning` | `holdout`) plus `labelProvenance`
  (`synthetic-generator` | `estimator-verified` | `unverified`).
- **Coordinates** (`pdf-top-left-points`): PDF user-space units at scale 1,
  origin at the top-left of the page as pdf.js presents it, y increasing
  downward, boxes as `{ x, y, w, h }` from the top-left corner. This is the
  convention `SymbolSearch.tsx` uses for the example box and stored geometry.
  Pages with a `/Rotate` entry are rejected rather than converted.
- Every label must sit on drawn content inside the page (checked against the
  rendered raster) so a wrong coordinate convention fails loudly.
- **Real-plan cases** use `evidenceClass: "real"` and private inputs. The
  validator rejects the synthetic-generator label provenance for them; it does
  not check that labels were estimator-verified or that the split is by project,
  so those remain the author's responsibility and a real report says so.

## Scoring rule

`scripts/eval/scoring.ts`. A prediction can match a labeled symbol when the
distance between their centers is at most `radiusScale` (1 in the tracked
manifests) times half the labeled box's diagonal. Matching is one-to-one and of
maximum cardinality (greedy by distance, then augmenting paths), independent of
prediction order: one prediction never satisfies two symbols and two predictions
never satisfy one. Every unmatched prediction is a false positive and every
unmatched symbol a false negative. Precision and recall are `null`, not 0 or 1,
when undefined. Count error is `predicted - expected` and can be zero while a
false positive and a false negative offset, so gates check them separately.

## Run status

`completed`, `zero-match` (ran, found nothing: scored as all misses, fails
gates that allow only `completed`), `failed`, `timed-out` (the production worker's
60 s tile limit or the harness case budget), `cancelled` (operator interrupt; no
partial detections are scored) and `input-error`. Only `completed` and
`zero-match` can be allowed by a manifest. Gates are applied to each case
separately; totals are context and never pass a failing case.

## Legacy scripts

`npm run eval:local` uses pypdfium2 rasters and a Python port of the tiling, then
the production `local.ts` matcher. `scripts/run_all_evals.ts` (through
`scripts/eval-autocount.ts`) uses the same rasters but calls `ncc.ts`
`matchAll()` directly and a mock verifier, not the `local.ts` path the product
uses; its metrics say nothing about a model. Both remain to reproduce the recorded
September 7 numbers and are labeled LEGACY in their output. Prefer
`eval:detection`.
