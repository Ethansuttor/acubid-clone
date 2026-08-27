# Invariants

These are not style preferences. Each one exists because breaking it produced
a bid that was wrong in a way nobody could see. Violating one is a defect
even if every test still passes.

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

Issues surface in **three** places and all three must stay in sync:
the Estimate tab banner, the Summary tab banner, and the top of the Excel
Summary sheet in red. An exported bid that is quietly incomplete is worse
than no export.

The nastiest case is `missing-component`: an assembly whose component item
was deleted still produces lines, just **short**. That is the plausible
looking wrong number. If you add a new way for a layer to fail to price,
add a matching issue kind.

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

`ANTHROPIC_API_KEY` is read only in the two API route handlers. The Anthropic
SDK is imported only by `lib/*/claude.ts`, which are imported only by routes.
No client component may import them.

## 8. Local-first architecture and persistence contract parity

The active application operates in local-first mode (`LOCAL_ONLY = true` in
`src/lib/local-config.ts`), backed by IndexedDB plus an append-only local outbox
(`src/lib/localdb.ts`). Legacy localStorage records are migrated on first open.
All database calls go through the Supabase-shaped query builder contract,
ensuring strict interface parity for future multi-tenant cloud sync without
changing UI or store logic.

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

## 11. Bid preflight gates immutable revision snapshots

Creating a frozen bid snapshot (`createBidSnapshot()`) requires running
`bidPreflight()`. If any blocker is active (such as an unresolved save error,
missing quantity, pending AI review, invalid raw input, zero labor rate, or an
invalid bid total), the snapshot is rejected. When clean, it inserts a deep
copy under the next revision number in the current local project. The product
does not update old snapshots. This local guarantee is not a substitute for a
database uniqueness constraint or multi-user transaction.

## 12. Report outcomes faithfully

If tests fail, say so with output. If something is unverified, say it is
unverified. Both AI features have only ever run against mocked responses —
never describe their real-world accuracy as known.
