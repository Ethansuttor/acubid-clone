# Auto-count accuracy: diagnosis and fix plan

**Written:** August 26, 2026
**Trigger:** first real-world run. On a realistic lighting plan the detector
found **zero** of the highlighted fixtures (box-with-X troffers) and placed
its dots in unrelated locations. Update to invariant-12 honesty: detection
accuracy was "unknown"; it is now **known to be bad** in at least this case.
One safeguard worked exactly as designed: every wrong dot landed as
`status: "pending"` and none could reach a bid.

This file is (1) the diagnosis, (2) an evaluation harness so improvement is
*measured* instead of vibed, (3) the fix, cut into tasks sized for a fast
coding model (same rules and preamble as
[`16-desktop-task-queue.md`](16-desktop-task-queue.md)).

---

## 1. Diagnosis — why the dots are in random places

Read of the actual pipeline (`src/components/takeoff/AutoCount.tsx`,
`src/lib/autocount/{tiling,claude,dedupe}.ts`, `src/app/api/autocount/route.ts`):

1. The sheet is rendered so the user's example box is ~72 px, tiled into
   1280 px overlapping tiles.
2. Each tile goes to Claude with the template crop and a prompt asking for
   **absolute pixel bounding boxes**.
3. Boxes are clamped, deduped (NMS), mapped tile→canvas→scale-1 units, and
   landed as pending takeoffs.

**The core defect is architectural, not a bug:** step 2 asks a vision LLM to
do *coordinate regression* — output exact pixel positions on a large, dense,
line-art image. Vision LLMs are genuinely good at "is this crop the same
symbol as that template?" and genuinely bad at "give me the pixel
coordinates of every instance." They return plausible-looking, confidently
wrong positions — which is precisely the observed failure (dots near rooms
and corridors, none on a fixture). A realistic sheet makes it worse: ceiling
grids, furniture, and door swings are full of rectangles that pull the
model's attention.

Secondary factors, in likely order of impact:

- **Model tier.** If `ANTHROPIC_MODEL=claude-haiku-4-5` was set (the cheap
  first-test recommendation), that is the weakest localization case. Worth
  re-measuring on `claude-sonnet-5` / `claude-opus-5` — but a better model
  makes this failure smaller, not gone.
- **Symbol size vs. clutter.** ~72 px template in a 1280 px tile of dense
  linework is a needle-in-haystack task even for a strong model.
- **Coordinate mapping** (`(d.x + d.w/2) / S`): the aibox request and the
  detections share the same transform, so a systematic flip/offset is
  *unlikely* — but it has never been proven by a test. GA-1 settles it
  cheaply and permanently.

**The fix that actually works** (industry-standard for this exact problem):
split localization from recognition. A deterministic **template matcher**
(normalized cross-correlation — plain arithmetic on grayscale pixels)
proposes candidate positions with true pixel precision; the LLM then only
**verifies** candidate crops — the task it is good at. The
`SymbolDetector` interface was built for exactly this kind of swap.

---

## 2. The measurement rule

No prompt tweak, model change, or new matcher is "better" unless the eval
harness says so. Target on the synthetic sheet
(`test-assets/sample-plan-E101-E102.pdf`, exact truth in
`test-assets/GROUND-TRUTH.md`): **recall ≥ 0.9 and precision ≥ 0.9** before
re-testing on the realistic sheet. A hit = detection center within half a
symbol-diagonal of a true center; extras are false positives; legend
swatches are true negatives.

---

## 3. Task queue

Order: GA-1 → GA-2 → GA-3 (owner) → GA-4 → GA-5 → GA-6 → GA-7 → GA-8 (owner).
Use the preamble from [`16-desktop-task-queue.md`](16-desktop-task-queue.md).

### GA-1 — Prove the coordinate mapping with a fake detector

**Prompt:**

> Read `src/components/takeoff/AutoCount.tsx` (the run effect),
> `src/lib/autocount/tiling.ts`, and `dedupe.ts`. Extract the pure mapping
> logic — "detections in tile-local px + tile origin + render scale S →
> takeoff geometry points" — into a new pure function
> `mapDetectionsToSheet(detections, tile, S)` in a new file
> `src/lib/autocount/mapping.ts`, and use it in AutoCount.tsx (mechanical
> refactor, no behavior change). Add `tests/autocount-mapping.test.ts`:
> synthetic tiles at known offsets, fake detections at known local px,
> assert the resulting sheet coordinates to 8 decimals, including tiles at
> x=0/y=0, interior tiles, and the overlap region (same symbol seen by two
> tiles must map to the same sheet point before dedupe).

**Acceptance criteria:** no behavior change (Playwright unaffected); new
tests pass; `npm test`, typecheck, lint pass.

### GA-2 — Ground-truth JSON + offline eval harness

**Prompt:**

> Read `scripts/make_sample_plan.py`, `test-assets/GROUND-TRUTH.md`,
> `src/lib/autocount/{types,tiling,dedupe,claude}.ts`. (1) Extend the
> Python generator to also write
> `test-assets/sample-plan-truth.json`: for each sheet, every symbol's
> center in top-down page coordinates at scale 1
> (`y_topdown = 1728 - y_reportlab`) with its kind and symbol w/h in
> points. (2) Add `scripts/render_eval_tiles.py` (uses pypdfium2 +
> pillow): renders a chosen page at a given scale S, crops the template
> from given page coords, computes the SAME tile boxes as
> `computeTiles(width, height, {tileSize: 1280, overlap: 160})` (port the
> ~30-line function faithfully), and writes `eval-out/manifest.json`
> (scale, template png path + size, tiles with x/y/w/h + png paths).
> (3) Add `scripts/eval-autocount.ts` (run with `npx tsx`): reads the
> manifest, calls the REAL `ClaudeDetector.detectInTile` per tile (key
> from env), maps with the REAL `mapDetectionsToSheet`, dedupes with the
> REAL `dedupeDetections`, loads the truth JSON, and prints per-kind
> precision, recall, false-positive count, and per-tile timings, plus a
> `--json` mode writing the scores to a file. Hit tolerance: center within
> half the symbol diagonal. No new npm packages.

**Acceptance criteria:** `python scripts/render_eval_tiles.py --page 2
--symbol troffer` then `npx tsx scripts/eval-autocount.ts` runs end-to-end
with a key; typecheck/lint/test untouched suites pass; the tiling port has
a unit test comparing its output to `computeTiles` for 3 canvas sizes.

### GA-3 — Baseline matrix (owner runs, ~$2–5 of API)

Owner runs the GA-2 harness on E-102 troffers and E-101 receptacles with
`ANTHROPIC_MODEL` set to `claude-haiku-4-5`, `claude-sonnet-4-6`,
`claude-sonnet-5`, `claude-opus-5`. Record the four precision/recall rows
in this file under "Results". This is the baseline every later change is
judged against. Expectation to be confirmed: all four are well below the
0.9/0.9 target, differing mainly in *how* wrong.

### GA-4 — Grid-anchored prompting (cheap improvement attempt)

**Prompt:**

> Read `src/lib/autocount/claude.ts` and `AutoCount.tsx` tile creation.
> Implement grid anchoring: before a tile is sent, draw light-red 1 px
> gridlines every 128 px onto a COPY of the tile, labeling columns A–J and
> rows 1–10 in small red text in each cell's top-left. Change the prompt to
> ask, per instance: the cell label plus offset-within-cell in px
> (`{"cell":"C4","dx":40,"dy":90,"w":..,"h":..,"confidence":..}`), and
> update `parseDetections` to convert cell+offset to tile px (keep
> accepting the old x/y form). Put the grid drawing in a pure function
> `annotateTileWithGrid(canvas)` in `src/lib/autocount/grid.ts` with a
> unit test on a small synthetic canvas (assert pixel colors at expected
> gridline positions). Also send the ORIGINAL un-gridded tile image first
> and the gridded copy second, telling the model the second image is the
> same tile with a reference grid.

**Acceptance criteria:** unit tests pass; suite/typecheck/lint pass; owner
re-runs GA-2 harness — keep the change only if precision AND recall improve
on the baseline model, and record the numbers here.

### GA-5 — NCC template matcher (the real fix, part 1: pure math)

**Prompt:**

> Create `src/lib/autocount/ncc.ts` — pure TypeScript, no DOM, no deps.
> Exports: `toGray(data: Uint8ClampedArray, w, h): Float32Array`;
> `matchTemplate(image: {g: Float32Array, w, h}, template: {g, w, h},
> minScore: number): Detection[]` implementing normalized cross-correlation:
> slide the template (stride 1), score = zero-mean NCC in [-1,1], collect
> local maxima ≥ minScore with greedy suppression of peaks closer than half
> the template's smaller edge, confidence = score. Also
> `rotations(template)` returning the 4 rotations + horizontal mirror
> (Float32Array index remapping — no canvas), and `matchAll(image,
> template, minScore)` = matchTemplate over all variants, merged and
> suppressed. Performance: precompute image integral images (sum and
> sum-of-squares) so each window's mean/variance is O(1); target ≤ 3 s for
> a 1280×1280 tile with a 72×72 template in Node. Add
> `tests/autocount-ncc.test.ts` with procedurally generated images: blank
> image → no matches; template stamped at 5 known positions (plus one
> rotated, one mirrored) with light noise → exactly those positions within
> 2 px; a different-shape decoy → not matched at minScore 0.6. Include a
> timing assertion with a generous ceiling (10 s) marked as a smoke check.

**Acceptance criteria:** tests pass in `npm test`; no DOM/API imports in
`ncc.ts` (grep proves it); typecheck, lint pass.

### GA-6 — NCC + LLM-verify detector (part 2: the pipeline)

**Prompt:**

> Read `src/lib/autocount/{ncc,types,claude}.ts`, `AutoCount.tsx`, and
> `src/app/api/autocount/route.ts` (and `src/lib/autocount/service.ts` if
> GD-9 has landed). Build the two-stage path: (1) in AutoCount.tsx, after
> rendering, run `matchAll` per tile in the browser with `minScore` 0.5 —
> candidates are now REAL positions; (2) crop a 1.6×-template-sized patch
> around each candidate; (3) send template + up to 24 numbered candidate
> crops per request to a NEW server mode `verify` on the autocount route:
> the model returns, per numbered crop, `{"i": n, "match": true|false,
> "confidence": 0..1}` — it never produces coordinates; (4) final
> detections = candidates whose verify is true, confidence = 0.5·ncc +
> 0.5·model, then existing dedupe + mapping. Implement the verifier as
> `class ClaudeVerifier` in `src/lib/autocount/verify.ts` with the same
> narrow-interface style as `SymbolDetector`; keep the old whole-tile
> detector code path behind a constant `DETECTION_STRATEGY:
> "ncc-verify" | "tile-scan"` in `src/lib/autocount/types.ts` (default
> `"ncc-verify"`). Server-side: validate the verify body (crop count cap
> 24, size caps) exactly as strictly as the existing route validates.
> Unit-test the verify response parser and the confidence blend.

**Acceptance criteria:** review queue, pending status, and undo behavior
unchanged; `npm test`, typecheck, lint, Playwright pass; GA-2 harness gains
a `--strategy` flag exercising the new path end-to-end (candidates from
`ncc.ts` in Node against the rendered PNGs).

### GA-7 — Harness re-run + threshold tuning

**Prompt:**

> Run nothing yourself. Add `--min-score` and `--verify-model` flags to
> `scripts/eval-autocount.ts`, and a `--sweep` mode that evaluates minScore
> 0.4/0.5/0.6/0.7 from ONE cached candidate-generation pass (cache NCC
> candidates to eval-out/ so the sweep re-uses them and only re-verifies).
> Print a table: strategy × model × minScore → precision/recall/cost-ish
> (tiles or crops sent).

**Acceptance criteria:** typecheck, lint pass; sweep runs against cached
files without re-rendering.

### GA-8 — Acceptance run (owner)

Owner runs the sweep on both synthetic sheets, records the table under
"Results" below, and picks the default `minScore` + verify model. Gate:
**≥ 0.9 / 0.9 on the synthetic set** → then re-test the realistic sheet
that started this file. If the synthetic set passes and the realistic sheet
still fails, the gap is documented here with the failing tiles saved to
`eval-out/failures/` — that becomes the next diagnosis, with evidence.

---

## Results (append-only)

| Date | Sheet / symbol | Strategy | Model | minScore | Precision | Recall | F1 | Wall time | Crops Sent | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-08-26 | E-102 / troffer | tile-scan (baseline) | claude-sonnet-4-6 | — | — | — | — | — | — | baseline whole-tile scan |
| 2026-08-26 | E-102 / troffer | ncc-verify | claude-sonnet-4-6 | 0.6 | 100.0% | 100.0% | 1.000 | 14.08s | 50 | 50/50 ground truth troffers found, 0 FP |
| 2026-08-26 | E-102 / exit | ncc-verify | claude-sonnet-4-6 | 0.5 | 16.0% | 100.0% | 0.276 | 21.95s | 25 | 4/4 ground truth exits found, 0 FN |
| 2026-08-26 | E-102 / switch | ncc-verify | claude-sonnet-4-6 | 0.5 | 8.1% | 100.0% | 0.150 | 42.58s | 111 | 9/9 ground truth switches found, 0 FN |
| 2026-08-26 | E-101 / duplex | ncc-verify | claude-sonnet-4-6 | 0.5 | 90.0% | 100.0% | 0.947 | 20.64s | 30 | 27/27 ground truth duplexes found, 0 FN |

## Honesty notes

- The realistic-sheet failure was observed on one sheet, one symbol, one
  (unrecorded) model setting. GA-3 exists to replace that anecdote with
  numbers — record the model that produced the original failure if known.
- NCC is scale-sensitive: it finds symbols at the template's rendered size
  (±~15%). Same-sheet auto-count is safe (one render scale); cross-sheet
  reuse of a template needs a scale-ratio correction — out of scope here,
  noted for later.
- The synthetic sheet is *easier* than reality (clean vectors, no ceiling
  grid). Passing it is necessary, not sufficient — which is why GA-8 ends
  on the realistic sheet.
