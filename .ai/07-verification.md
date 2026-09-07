# Verification and evidence ledger

Updated September 7, 2026. Report exactly what ran against which source tree.
A documentation-only edit needs link/consistency/diff checks, not a fresh
application build merely to update prose.

## Commands currently available

```sh
npm test
npm run typecheck
npm run lint
npm run bench
npm run test:e2e
npm run build
npm run eval:local
```

Desktop, storage benchmark, real-estimate, and docs:check npm commands are
planned, not currently available. Document them after implementing them.

## Evidence as observed

| Date/source | Check | Result and limits |
| --- | --- | --- |
| September 7, this task's code review | npm test | 433 tests passed across 25 files |
| September 7, this task's code review | typecheck, lint, build | All passed; build used Next.js 16.3.2 |
| September 7, this task's code review | npm run bench | Invariants passed; 10,000-takeoff pipeline median 14.47 ms, p95 41.87 ms, i7-12700H / Node 24.14.1 |
| September 7, this task's code review | Browser E2E | Not rerun in that review |
| September 7, prior detection work | Synthetic detector and browser workflow | See 13-image-detection.md for its recorded results and limits |
| Current review | Installed desktop, physical power loss, real-job acceptance, live provider accuracy | Not verified |

The reviewed working tree had uncommitted changes and no immutable checkpoint
for this run. These results do not certify later edits by concurrent agents.
Test counts in old documents are historical, not required totals.

## Scope checks to the change

- Documentation only: inspect the diff, relative links, stale instructions,
  and whether future commands/features are clearly labeled proposed.
- Pure estimating/parsing changes: independent expected values, unit tests,
  typecheck/lint, and the affected UI/export path.
- Storage changes: real-backend contract tests, failure injection, reload,
  migration/restore, and relevant browser/packaged desktop tests.
- UI/transport changes: targeted browser tests and visual interaction checks,
  plus client/server build boundaries.
- Integrated release candidate: full unit/typecheck/lint/build/web E2E,
  packaged Electron flow, backup/upgrade/crash checks, and
  [real-estimate acceptance](19-real-estimate-acceptance.md).

Run builds and E2E only in the assigned checkout. The current Playwright config
uses localhost:3000 and reuses an existing server. Until configurable per-worker
ports land, serialize E2E. Do not mistake another worker's server for this build.
Use disposable browser profiles and desktop data directories for destructive tests.

For every new evidence record include date, task ID, commit plus dirty-diff
identity, command, exit status, environment, artifact path, and limitations.
Separate prior reported results from checks you personally ran.

## The fixture project — the ground truth

`tests/fixtures/fixture-project.ts` is a small hand-calculated bid. Every
figure in it was worked out by hand and is asserted line by line. When you
change estimating math, this is what tells you whether you broke it.

Sheet scale: 200 PDF units = 20 ft, so **0.1 ft per unit**.

Takeoff:
- 8 receptacle assemblies (`A-REC`) — plus one **pending** AI detection that
  must not count
- 4 troffers (direct item link)
- lighting wire: 1200 units → **120 FT**
- feeder EMT: 400 + 150 units = 550 units = 55 ft, `rise_drop_ft` 5 → **60 FT**

`A-REC` expands per each into: 1 duplex ($2.85 / 0.20 hr), 1 plate
($0.55 / 0.05), 1 box ($3.10 / 0.25), 1 mud ring ($1.85 / 0.06),
6 FT of ½" EMT ($0.68 / 0.032), 18 FT of #12 ($0.18 / 0.008).

Expected:

| | |
|---|---|
| Material (extended) | **$566.16** |
| Labor (extended) | **13.528 hr** |
| `W-12` rollup across assembly + direct run | 264 FT → $47.52 |
| At $95/hr, 12% OH, 10% profit | labor $1,285.16 · prime $1,851.32 · OH $222.1584 · subtotal $2,073.4784 · profit $207.34784 · **bid $2,280.82624** |

With waste 5%, tax 8.25%, labor factor +15%, a $12,000 quote (O&P applies)
and an $850 permit (at cost): **bid $18,247.62099152**.

## Performance Benchmark & Fixture

`tests/fixtures/large-estimate-fixture.ts` defines a deterministic seeded PRNG
large commercial project:
- 5 plan documents, 50 calibrated sheets
- 1,000 database items, 200 assemblies (1,200 component links)
- 200 layers, 10,000 takeoff objects (polylines, areas, counts)
- 50 direct vendor & subcontractor costs

Run `npm run bench` to benchmark:
- `layerQuantities` throughput & latency
- `extendEstimate` assembly expansion
- `summarize & rollup` commercial calculations
- `bidPreflight` readiness evaluation
- Full in-memory estimating pipeline latency (not database, rendering, or file I/O)

The generated fixture intentionally contains pending AI detections and
unlinked quantified layers. Its preflight result is therefore blocked by the
known `pending-ai` and `missing-quantity` checks. The benchmark's integrity
test expects exactly those blockers and fails on unexpected drift.

## Rules for changing the math

1. **Do the arithmetic by hand first**, then write the assertion, then run it.
   Twice during this project a test expectation was wrong and the app was
   right — the fixture caught it both times.
2. Assert to 8+ decimal places. `money()` rounding is display-only.
3. If you add a bid-math term, add a case where it is zero and prove the
   fixture's original numbers are unchanged.
4. New estimating behaviour needs a unit test **and** an E2E that drives it
   through the real UI. Unit tests prove the math; E2E proves it is wired up.

## Writing E2E tests

`e2e/helpers.ts` provides reusable test utilities:
- `signIn(page, userIndex)`
- `clickPdf(page, vx, vy)`
- `waitSaved(page)`
- `expectPreflightReady(page)`
- `expectPreflightBlocker(page, checkId)`
- `createBidSnapshot(page, label)`
- `expectRevision(page, revision, priceFormatted, label)`

Key principles:
- Prefer `data-testid` over positional selectors.
- Provider integration specs mock `/api/autocount` and `/api/sheetinfo` with `page.route`,
  to avoid paid calls and make response behavior deterministic.
- Local symbol search needs an active count layer. Inspect each sheet-analysis
  test's setup rather than assuming all AI features have identical prerequisites.
- Numeric cells render formatted (`$1,250.00`), so match the formatted string.

## Symbol detection verification

`npm run eval:local` evaluates the saved synthetic raster fixtures and exits
nonzero on missed or extra symbols. The browser auto-count test uses the real
local worker and PDF pixels with zero API requests. See
[`13-image-detection.md`](13-image-detection.md) for current regression coverage,
verification results and the performance tradeoff of checking every alignment.

## What is NOT verified

Current automated provider integration tests use mocked responses; historical
experiments are not acceptance evidence for the current pipeline. Accuracy on
real drawings and actual provider cost per sheet remain
**unknown**. Synthetic local-matcher success does not establish those claims.

## September 7 documentation reconciliation

Updated 35 Markdown files, including two new execution/acceptance packets.
Checked local Markdown links, fenced-code balance, required skill metadata,
and documentation diffs. All seven repository skills passed the skill-creator
validator. Reviewed current source for disputed architecture statements.
No application code was changed by this documentation task, and no new
application test/build run or implementation-agent dispatch is claimed.

## September 7 — C1 contract implementation

Added the platform seam (`src/lib/platform/**`), the desktop IPC contract
(`desktop/contracts.ts`), runnable fake adapters, and an executable storage
contract suite (`tests/storage-contract/**`). No existing call site was
rewired, so browser behavior is unchanged.

The contract suite runs against both the in-memory fake and the real browser
adapter on a live IndexedDB (`fake-indexeddb`, new devDependency). Node 24
supplies the real Web Locks implementation, so the workspace lock and the
per-mutation database lock are exercised rather than stubbed.

Run on commit `0f1a154` plus the pre-existing dirty tree:
`npm test` 542 tests across 33 files passed (433/25 at the September 7
baseline), `npm run typecheck`, `npm run lint`, `npm run build`, and
`npm run bench` clean.
A deliberate mutation of one adapter error mapping failed exactly one contract
test, then was reverted and re-verified.

Not run and not claimed: browser E2E, packaged desktop, migration/recovery
drills, real-estimate acceptance. `fake-indexeddb` is not a browser engine —
storage quotas, eviction, genuine cross-tab behavior and engine-specific Blob
handling remain E2E territory. The web-route AI transport is tested with
`fetch` stubbed, so no live provider call is claimed; two route bounds are
asserted against route source rather than by executing the routes. Details in
[`handoffs/C1.md`](handoffs/C1.md).

## September 7 — A1 acceptance harness

Added the known-estimate comparison engine, job-file format, runner
(`npm run acceptance`) and 19 engine tests. The synthetic run drives the
hand-calculated fixture through the application's own estimating functions and
reconciles 8/8 lines and 3/3 totals, exit 0.

This establishes the harness only. No customer job, catalog, drawing or
expected export was available; none was invented. **Gate G5 remains
unverified** and the report prints that on every synthetic run. Details in
[`handoffs/A1.md`](handoffs/A1.md).
