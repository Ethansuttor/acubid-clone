# QA-diff: takeoff quality checks in bid preflight

Task ID / owner: QA-diff, feature worker (single-agent session).
Base commit `567733e`, branch `worktree-agent-aa62c5ef9f0fc055e`.

## Status

| Piece | State |
| --- | --- |
| Feature 1: takeoff quality checks in preflight (duplicate counts, calibrated sheets with no takeoffs) | Implemented and verified as described below |
| Stretch: calibration versus printed scale | Not done. The coordinator removed it from this session. |
| Feature 2: revision diff and bid-price walk | **Not started.** The coordinator deferred it to a later session. No file for it exists and nothing in the UI mentions it. |

Nothing was verified against a real estimate. Every distance and threshold below
is checked against hand-worked geometry and one sample PDF, not against a real
takeoff. See "Not verified".

## What was built

| File | Change |
| --- | --- |
| `src/lib/takeoffQa.ts` | New, pure. `findDuplicateCounts`, `findEmptyCalibratedSheets`, `takeoffQaChecks`, `duplicateCountThreshold`, and the three named threshold constants |
| `src/lib/preflight.ts` | `bidPreflight` calls `takeoffQaChecks` and adds each result as a `"warning"`. 11 lines added, nothing else touched |
| `tests/takeoffQa.test.ts` | New, 56 tests |
| `tests/preflight.test.ts` | Additive only: matrix rows 16 and 17, a "Takeoff quality warnings" block (10 tests), and the matrix title changed from "15-Rule" to "17-Rule". No assertion was changed or weakened |
| `e2e/takeoff-qa.spec.ts` | New, 2 browser tests |

No change to `SummaryView.tsx` or `EstimateSetup.tsx`: the existing preflight panel
renders any check by id, with the warning icon and detail text, so the new
warnings appear without UI work. No change to `src/store/**`, `types.ts`,
`estimate.ts`, persistence, `DatabaseView.tsx`, `csv.ts` or `package.json`.

## The two checks

Both are warnings. `TakeoffQaCheck` has no severity field, so nothing in
`takeoffQa.ts` can be promoted to a blocker by accident. Both appear in
`preflight.warnings`, so `ready` is unaffected.

### `duplicate-counts`: "Possible duplicate counts"

Two **confirmed** count takeoffs on the **same sheet and same layer** closer than
a threshold. One finding per sheet and layer, with its clusters, never one
warning per point. The check's detail names the sheet and layer of up to five
findings and summarises the rest ("2 more sheet and layer combinations").

Ignored: pending and rejected takeoffs (`countableTakeoffs` allowlist), linear and
area takeoffs, different layers at one point, the same point on different sheets,
non-finite coordinates, and takeoffs whose sheet or layer no longer exists (the
bid does not count those either).

Clusters are single-linkage: three counts each 1.5 units apart in a row are one
cluster of 3 even though the ends are 3 units apart. A cluster of `k` counts
reports `k - 1` as the most that could be duplicates.

Typical layers: the finding carries `countMultiplier` and `suspectQuantity`, both
taken from `layerQuantities()` (the bid's own function), and the detail says
"This layer is typical x3, so each extra count is multiplied and adds 3 to the bid
quantity." A test proves `suspectQuantity` equals the drop in the bid quantity
when the suspects are removed.

### `empty-calibrated-sheets`: "Calibrated sheets have no takeoffs"

A calibrated sheet (`scale_ft_per_unit` finite and greater than 0, the same test
`takeoffQuantity` uses) with no confirmed and no pending takeoff. Uncalibrated
sheets are never reported: covers, legends, schedules and details normally have no
scale. Decisions:

- **Pending only** is not empty. The sheet is mid-review and `pending-ai` already
  blocks the bid.
- **Rejected only** is reported, with "(N rejected candidates)": nothing from the
  sheet is in the bid.
- Any takeoff kind counts as work on the sheet.

## Thresholds and rationale

| Constant | Value | Applies to |
| --- | --- | --- |
| `DUPLICATE_COUNT_MAX_FT` | 0.25 ft (3 in), strict "closer than" | Calibrated sheets. Real distance. |
| `DUPLICATE_COUNT_MAX_UNITS` | 3 PDF units | Sheets with no scale |
| `DUPLICATE_COUNT_UNITS_CAP` | 6 PDF units | Ceiling on the calibrated threshold once converted to units |

- **3 in**: a one-gang plate is about 2.75 in wide, so separate devices on one layer
  are normally further apart. Closer is almost always one symbol counted twice
  (clicked twice, or a manual count plus an accepted auto-count candidate). It is
  2.25 PDF units at 1/8 in = 1 ft and 4.5 at 1/4 in = 1 ft, well under a drawn
  symbol (7 or more units), so real neighbours are not swept in.
- **3 units**: counts need no scale, so an uncalibrated sheet can still hold a
  double click. It is 0.04 in of paper, about three screen pixels at 100% zoom, and
  what the 3 in rule works out to at 3/16 in = 1 ft (3.4 units).
- **Cap of 6 units**: a mistyped calibration distance makes feet-per-unit far too
  small and would turn 3 in into hundreds of units, flagging every neighbour. The
  cap never binds at 1/8 in to 1/4 in = 1 ft and binds only above 3 ft per inch of
  paper (3/8 in = 1 ft and up), where it is a tighter physical distance.

Worked boundary (in the tests): sheet at 0.125 ft/unit gives a threshold of
0.25 / 0.125 = 2 units exactly. 1.9 units = 0.2375 ft = 2.85 in is flagged; 2.1
units = 3.15 in is not; exactly 2 units = 3 in is not.

## Stored revisions

`bidPreflight` output is what `createBidSnapshot` already stores. Revisions created
after this change will carry the new warnings in `payload.preflight`, and
`warning_count` will include them. Nothing reads or rewrites an existing snapshot,
so older revisions keep the preflight they were issued with. The E2E asserts a
frozen revision still shows "1 warning" after the duplicate is undone.

## Commands and exact results

All in the worktree, Node 24 (`/opt/node24/bin`), after the last code edit except
where noted.

| Command | Result |
| --- | --- |
| `npx vitest run` | 35 files, 614 tests passed, 0 failed |
| `npm run typecheck` | exit 0, no output beyond the command echo |
| `npm run lint` | exit 0, no output beyond the command echo |
| `E2E_PORT=3220 npx playwright test` | 19 tests: **18 passed, 1 failed**. The failure is not a regression, see below |
| `E2E_PORT=3220 npx playwright test e2e/takeoff-qa.spec.ts` | 2 passed |
| `npm run bench` | Invariants passed. `bidPreflight` median 9.68 ms, p95 13.24 ms over the 10,000-takeoff fixture on this machine. No pre-change run on this machine, so no before/after claim |

Vitest, typecheck and lint were run again on the two touched test files after a
comment-only edit to `takeoffQa.ts` (164 tests passed, typecheck and lint exit 0);
the full vitest and Playwright runs were before that comment edit.

**The one E2E failure**: `e2e/product-recovery.spec.ts:5`, "archive and portable
recovery preserve a bid, revision and plan PDF". Line 44 hardcodes
`recovered.goto("http://localhost:3000/login")`, so it ignores `E2E_PORT` and
fails with `ERR_CONNECTION_REFUSED` when the server is on 3220. Port 3000 was
deliberately not used. To check the failure is only the port, a temporary copy of
the spec with that one URL pointed at 3220 was run and deleted (not committed): all
3 tests in the file passed (archive and recovery 6.9 s). This is a defect in the
spec left by the per-checkout-port change. The coordinator reports it is fixed on
the integration branch in `c35f38e` (the fresh context gets the configured base
URL). That commit is not in this branch (base `567733e`), so running this branch's
Playwright suite on a non-default port will still show this one failure until the
branches are merged. `product-recovery.spec.ts` was not edited here and the
temporary copy was deleted before committing.

Checks that guard the tests themselves:

- Six deliberate mutations of `takeoffQa.ts` (non-strict boundary, no status
  filter, grouping by sheet only, no cap, warning on uncalibrated sheets, a
  neighbourhood search that skips cells) each made 2 to 6 tests fail. The module was
  restored and re-verified.
- With the `bidPreflight` wiring temporarily removed, both new E2E tests failed;
  the wiring was restored.
- A grid-search test compares cluster membership against an independent O(n^2)
  reference on 400 random points, for four scales.

## Not verified

- **Real plans.** No real takeoff or drawing was used. Whether 3 in and 3 units
  produce useful results, or too much noise, on real estimates is unknown.
  Ganged devices counted with two clicks at one symbol will be reported; that is
  intended and why these are warnings.
- The E2E uses `e2e/fixtures/sample-plan.pdf`; auto-count candidates accepted onto
  manual counts were not exercised in the browser.
- Not run: packaged desktop, migration/recovery, real-estimate acceptance.
- `EstimateSetup.tsx` and the Excel export were not changed and were not checked
  for the new warnings.

## Gaps

- The findings name a sheet and layer but the UI cannot jump to them or highlight
  the suspect points. Selecting the cluster on the sheet is the obvious follow-up.
- The detail names five findings. A project with many affected sheets shows the
  rest only as a count.
- Single-linkage can chain: a long row of counts each within 3 in of the next is one
  large cluster. Acceptable for a warning, but the "up to N extra" figure is an upper
  bound.

## Patch requests

None outstanding. The one found (the hardcoded `http://localhost:3000/login` in
`e2e/product-recovery.spec.ts:44`) is already fixed on the integration branch in
`c35f38e`, per the coordinator.

## Questions for the estimator

1. Is 3 in the right real distance? Do you count ganged devices (two receptacles in
   one two-gang box) as two clicks on one symbol? If so this will warn on them.
2. Should a calibrated sheet whose auto-count candidates were all rejected still be
   called empty? It is now, on the view that nothing from it is in the bid.
3. Do you calibrate every sheet up front, including covers and legends? If yes the
   empty-sheet warning will be noisy and may need a per-sheet "no takeoff needed" mark
   (that would need a stored field and is not built).

## Feature 2: revision diff (not started)

Not started, per the coordinator. Nothing below is implemented. Findings that
matter to whoever builds it:

- `createBidSnapshot` (in `src/store/workspace.ts`) assembles the payload from the
  store arrays and computes the summary with `layerQuantities`, `extendEstimate`,
  `estimateTotals`, `summarize`, so a pure helper in `src/lib` can rebuild the same
  shape for the working estimate without touching the store.
- Snapshot payloads hold the **whole** item and assembly tables, not only the used
  ones, so "catalog changes affecting this bid" has to be filtered to items the
  layers reach.
- `schema_version` 1 has no `proposal_entries`.
- The stored `bid_price` is what a walk must land on for a snapshot the app created;
  the browser flow, not a hand-built object, is the honest evidence for that.
