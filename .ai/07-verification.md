# How to verify

Run these before claiming anything works. Report what actually happened,
including failures and their output.

```sh
npm test                # 324 unit tests, 15 files   (~1s)
npm run typecheck       # TypeScript (0 errors)
npm run lint            # eslint flat config (0 errors, 0 warnings)
npm run bench           # large-scale estimate benchmark (~5s)
npm run test:e2e        # 10 E2E specs               (~25s)
npm run build           # production build
```

The E2E config starts or reuses a dev server on port 3000 in local mode. It
prefers `PLAYWRIGHT_CHROMIUM_PATH`, Chrome, or Edge when present, then falls
back to Playwright's managed Chromium.

Last complete verification: **August 26, 2026**. All commands above passed.
The default benchmark's 10,000-takeoff full pipeline measured **14.03 ms
median** and **15.56 ms p95** on an i7-12700H. Treat those numbers as one
machine's observation, not a CI performance contract.

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
- Full end-to-end estimating pipeline latency

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
- The AI specs mock `/api/autocount` and `/api/sheetinfo` with `page.route`,
  because there is no API key in the dev environment.
- Sheet-analysis and auto-count both require a **count** layer to be the
  active layer; clicking a layer row makes it active.
- Numeric cells render formatted (`$1,250.00`), so match the formatted string.

## What is NOT verified

Both AI features have only ever run against mocked responses. Real-world
detection accuracy, title-block reading, tiling behaviour on large sheets,
and cost per sheet are **unknown**. Say so rather than implying otherwise.
