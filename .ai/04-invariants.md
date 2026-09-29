# Invariants

These are correctness and data-integrity requirements for the current product.
The user's instructions may change product policy; implement such changes
explicitly, with reference examples and migration/verification where needed.
Existing architectural mechanisms are replaceable while preserving these outcomes.

---

## 1. Quantity is never silently dropped from a bid

If a layer carries takeoff quantity that cannot be turned into money, the app
**reports it**. It must never contribute zero in silence.

`extendEstimate()` returns `{ lines, issues }`. Every issue has a `kind` and
a `severity`:

- `severity: "missing"` — quantity is absent or short. Kinds: `unlinked`,
  `missing-item`, `missing-assembly`, `empty-assembly`, `missing-component`,
  `uncalibrated`.
- `severity: "warning"` — priced, but suspect. Kind: `unit-mismatch`.

Issues surface in the Estimate tab banner, the Summary tab banner, and the top
of the Excel Summary sheet in red. The proposal does not duplicate those
details, but its print surface must fail closed to a not-ready notice whenever
bid preflight has a blocker. An issued bid that is quietly incomplete is worse
than no output.

The nastiest case is `missing-component`: an assembly whose component item
was deleted still produces lines, just **short**. That is the plausible
looking wrong number. If you add a new way for a layer to fail to price,
add a matching issue kind.

The same rule governs any *split* of the bid. `bidBreakdown()` reports
untagged layers under "Unassigned" rather than spreading them across the
tagged groups, and it carries a `reconciles` flag: when the group shares fail
to sum to `summary.bidPrice`, the Summary panel and the Excel "Breakdown"
sheet both withhold the split and say why. A breakdown that silently
disagrees with the total printed beside it is the same class of defect as a
dropped quantity. See `05-decisions.md` for why the allocation is exact
rather than pro-rata.

## 2. Nothing an AI produces reaches the bid unreviewed

- Auto-count detections are written with `status: "pending"` and
  `source: "ai"`. Only `status === "confirmed"` takeoffs are counted — see
  `countableTakeoffs()`, which is an allowlist, not a blocklist.
- Sheet analysis returns **proposals**; applying one is an explicit click and
  is undoable.
- Review is keyboard-driven and supports bulk accept, because a review step
  people won't use is not a safeguard.

Any future AI feature (spec reading, scope audit, quote leveling) inherits
this rule. See the `ai-feature` skill.

## 3. Geometry is stored in PDF user-space units, never in feet

Measurements are derived at read time from the sheet's calibration.
Recalibrating a sheet re-derives everything correctly. Never persist a
computed length.

## 4. All arithmetic and diagnostics live in pure modules

`src/lib/geometry.ts`, `src/lib/estimate.ts`, `src/lib/preflight.ts`, and
`src/lib/catalogDiagnostics.ts` are the single source of truth. They have
zero React and zero I/O dependencies. Components render and collect input;
they do not calculate. If you find yourself doing arithmetic in a `.tsx` file,
it belongs in `lib` with a test.

## 5. Rounding is for display only

`money()` rounds to cents for display and export. Internal math stays at full
precision — the fixture asserts to 8+ decimal places. Never round mid-chain.

## 6. Parsers reject rather than guess

Every parser in this codebase returns `null` / an error for input it cannot
confidently read, and callers keep the previous value rather than committing
a guess:

- `parseDrawingScale` returns `null` on ambiguity — it will not pick between
  two scales printed on one sheet.
- `parseNumericInput` returns `null` for unreadable text so a field keeps its
  old value instead of silently becoming `0`.
- CSV import reports unusable rows **by line number** and refuses to persist
  a partially-resolved assembly.

A parser that quietly produces a plausible number is the most expensive kind
of bug this project can have.

## 7. The Anthropic key never reaches the browser

In the running web app, `ANTHROPIC_API_KEY` is read in the two API route
handlers. Provider modules, including autocount/verify.ts, stay outside client bundles.
No client component may import them. Planned desktop key storage belongs in
a privileged process, with no key-read interface exposed to the renderer.

## 8. Local-first persistence and explicit backend contracts

The active application operates in local-first mode (`LOCAL_ONLY = true` in
`src/lib/local-config.ts`), backed by IndexedDB plus an append-only local outbox
(`src/lib/localdb.ts`). Legacy localStorage records are migrated on first open.
Most database calls use a narrow Supabase-shaped query builder; compound
assembly replacement and backup/restore also call local helpers directly.
A new backend must cover every path and prove behavioral compatibility with
contract tests. The current adapter does not provide full SDK parity or sync.
A saved acknowledgement follows the committed local transaction, not an
in-memory queue or independently appended log. Desktop SQLite may replace
the mechanism while preserving the outcome.

## 9. Fail-closed workspace loading across all 11 entities

`load(projectId)` in `src/store/workspace.ts` evaluates 11 parallel queries:
`projects`, `documents`, `sheets`, `layers`, `takeoffs`, `items`, `assemblies`,
`assembly_items`, `direct_costs`, `proposal_entries`, and `bid_snapshots`.
- If any single query returns an error or if the project record is missing,
  the workspace **fails closed**.
- It zeroes all entity collections and sets `loadError`.
- It **never** falls back to partial arrays or renders an incomplete project,
  preventing deflated low-dollar estimates from ever being viewed or exported.

## 10. Durable save error tracking

The workspace store serializes all mutations through a single FIFO write queue
(`writeQueue`).
- When an async write fails, `failedWrites` increments and `saveError` records
  the verbatim failure message.
- `saveState` transitions to `"error"`.
- **Invariant:** `saveState` cannot silently revert to `"saved"` if `failedWrites > 0`.
  Edits are not masked as healthy when data loss has occurred.

## 11. Bid preflight gates every issued output

Excel export, proposal printing, and frozen bid snapshots all require
`bidPreflight().ready`. If any blocker is active (such as an unresolved save
error, missing quantity, pending AI review, invalid raw input, zero labor rate,
or an invalid bid total), the output is rejected. Proposal printing must also
fail closed under browser-level printing such as Ctrl+P, which can bypass a
disabled application button. Warnings remain advisory and do not block issue.

When clean, `createBidSnapshot()` inserts a deep copy under the next revision
number in the current local project. The product does not update old snapshots.
This local guarantee is not a substitute for a database uniqueness constraint
or multi-user transaction.

## 12. Report outcomes faithfully

If tests fail, say so with output. If something is unverified, say it is
unverified. Current provider integration tests use mocked responses, while local symbol
search is tested with real synthetic PDF pixels. Prior live experiments do
not establish current real-plan accuracy. Distinguish historical, synthetic,
mocked, live, and estimator-accepted evidence; never call them interchangeable.
