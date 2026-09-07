# Image detection pipeline — September 7, 2026

> Implementation/evidence record for the September 7 detector fixes.
> These measurements are historical observations, not a fresh run on every
> subsequent change. Continue with [track V](17-autocount-accuracy-plan.md);
> current overall checks are recorded in [07-verification.md](07-verification.md).

## Current flow

`SymbolSearch` renders the selected PDF page locally, captures the example,
and calls `detectOnCanvas`. The page is split into overlapping tiles. A Web
Worker prepares rotations, mirrors and optional ±10% scale variants, proposes
matches with sampled normalized cross-correlation (NCC), then verifies them
against every template pixel. Overlapping hits and existing marks on the same
sheet/layer are suppressed. Results become pending takeoffs in PDF coordinates.
Only explicit human acceptance adds their quantities to the estimate.

Local mode sends no images or API requests. Optional AI review sends at most
48 ambiguous crops in batches of 12. Missing, malformed and failed decisions
remain available for human review; negative AI decisions do not delete hits.
There are no automatic retries or automatic acceptance.

## Missed-match defects fixed

- The stride-2 proposal grid could miss a perfect thin symbol at odd/odd
  coordinates because all neighboring scores fell below its refinement gate.
  Every integer alignment is now evaluated, including the last row and column.
- Absolute feature-point contrast cutoffs could exclude every white pixel in
  a sparse template. The remaining all-dark sample had zero variance, returning
  no matches. Feature points now include both sides of the template mean.
- The tile shortcut treated all pixels above brightness 200 as blank, even
  though faint linework can correlate perfectly. Only uniform tiles are skipped.

Regression tests cover each defect, both sheet edges, tile seams, duplicate
suppression, uniform tiles of different brightness, rotations, mirrors, size
tolerance, AI request limits, invalid AI decisions and cancellation.

## Verification

- `npm test`: 412 tests passed across 24 files.
- `npm run typecheck`, `npm run lint`, `npm run build`: passed.
- `npm run bench`: passed all estimate invariants; full estimate pipeline
  median 16.39 ms and p95 21.39 ms on this machine.
- `npm run test:e2e`: all 16 tests passed after the alignment and faint-tile
  fixes. The detector test uses real PDF pixels and the real browser worker,
  checks zero API calls, pending quantities, repeat-search deduplication,
  acceptance/rejection, undo/redo and resulting estimate totals.
- The final matcher then passed the targeted auto-count E2E again (17.3 s),
  including a new cancellation-and-restart check that adds no partial candidates.
- The rendered Projects page and detector review screenshot were inspected;
  the Projects page had no captured browser errors.

`npm run eval:local` reads the saved synthetic raster fixtures and writes
`eval-out/local-detection-results.json`. It now exits nonzero if any fixture
has missed or extra symbols, while preserving the report for diagnosis.

Final evaluation: **90/90 symbols, zero false positives, zero false negatives,
zero API calls** at the default 0.72 threshold.

| Synthetic fixture | Expected / found | Previous scan (s) | Corrected scan (s) |
| --- | --- | --- | --- |
| E-102 troffer | 50 / 50 | 15.25 | 51.18 |
| E-101 duplex | 27 / 27 | 19.03 | 67.65 |
| E-102 switch | 9 / 9 | 34.41 | 125.39 |
| E-102 exit | 4 / 4 | 22.08 | 66.58 |

These are single runs on this machine, with other verification work also
running during parts of each run. Total elapsed time increased from 90.76 s
to 310.79 s (about 3.4×). The original fixtures pass with either implementation;
the newly added thin and sparse unit fixtures reproduce misses before the fixes.

## Limits and next work

Checking every alignment increases runtime. The detector still runs off the UI
thread, supports cancellation, and has a 60-second timeout per worker operation.
Performance observations belong to these fixtures and this machine; they are
not a production latency guarantee. Future acceleration must retain the thin,
sparse and boundary regressions.

The accuracy fixtures are synthetic drawings. No representative real plan set
has been labeled and evaluated, and live AI review remains unverified. Sampled
NCC proposals and full-pixel verification do not guarantee recall on scans,
skewed symbols, occlusion, differing line weights or nearby annotations. Scores
are visual similarity, not probabilities. Next accuracy work should add labeled
real-plan crops and measure both misses and false positives before tuning.
