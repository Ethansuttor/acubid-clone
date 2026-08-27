# Architecture

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · Zustand ·
PDF.js · ExcelJS · Supabase · `@anthropic-ai/sdk`.

## The layer rule

```
  pure logic  (src/lib/*.ts)             <- all arithmetic & diagnostics live here, no React, no I/O
      ^
  state       (src/store/workspace.ts)   <- one Zustand store, fail-closed loading, write-through queue
      ^
  components  (src/components/**)        <- render + input only
      ^
  routes      (src/app/**)               <- pages and server API routes
```

**Components never compute money.** They call `layerQuantities` →
`extendEstimate` → `estimateTotals` → `summarize` and render the result. This
is why the arithmetic is testable without a browser, and why three different
surfaces (Estimate tab, Summary tab, Excel export) can never disagree.

## `src/lib` — the pure core

| File | Responsibility |
|---|---|
| `types.ts` | Domain types mirroring the database schema, plus preflight, diagnostics, and snapshot models. |
| `geometry.ts` | Distance, polyline length, shoelace area, calibration → scale, and `takeoffQuantity()` which turns one takeoff object into a real-world number. |
| `estimate.ts` | **The money.** Layer quantities, assembly expansion, per-item rollup, totals, bid summary, issue reporting, delete-usage lookups. |
| `preflight.ts` | **Commercial bid preflight.** Pure readiness evaluation covering persistence state, missing quantities, pending AI hits, labor rates, raw commercial/layer/catalog inputs, calculated totals, named direct costs, non-empty bids, sheet presence, zero-value/material/labor items, typical multipliers, and markups. |
| `catalogDiagnostics.ts` | **Catalog health diagnostics.** Pure analysis of items and assemblies: detecting zero-cost items, zero-labor items, duplicate item codes, duplicate assembly codes, empty assemblies, and missing component references. |
| `local-config.ts` | Local client configuration (`LOCAL_ONLY = true`) establishing local browser persistence by default. |
| `excel.ts` | Formats the estimate into a 4-sheet workbook. Computes nothing itself. |
| `csv.ts` | RFC4180 parser + item/assembly import-export and merge. |
| `units.ts` | Feet-inch parsing/formatting, number formatting, `parseNumericInput`. |
| `pdf.ts` | PDF.js wrapper with a per-document cache. |
| `supabase.ts` | Client factory; routes database queries to the local client (`src/lib/localdb.ts`). |
| `localdb.ts` | IndexedDB-backed database client with an append-only outbox, legacy localStorage migration, plan-file storage, and the Supabase query-builder interface. |
| `recovery-folder.ts` | Optional user-selected folder mirror for baselines, current JSON, per-mutation journal files, and plan PDFs. |
| `autocount/` | Symbol detection: `types.ts` (the `SymbolDetector` interface), `tiling.ts`, `dedupe.ts`, `claude.ts`. |
| `sheetai/` | Title-block reading: `types.ts` (`SheetAnalyzer`), `scale.ts`, `claude.ts`. |

## Data flow: a click becomes a dollar

```
click on canvas
  -> SheetCanvas creates a Takeoff {geometry in PDF user-space units}
  -> workspace.addTakeoffs() : local state + queued DB insert + undo entry
  -> layerQuantities(layers, takeoffs, sheets)
        applies sheet calibration and the layer's rise/drop + typical multiplier
  -> extendEstimate(quantities, items, assemblies, assemblyItems)
        expands assemblies; returns {lines, issues}
  -> estimateTotals(lines)  -> summarize({...totals, rates, directCosts})
  -> rendered in Summary tab / written by excel.ts
```

**Geometry is stored in PDF user-space units, never in feet.** Measurements
are derived at read time from the sheet's calibration. Recalibrating a sheet
therefore re-derives every quantity on it correctly, with nothing stale
persisted. Do not "optimise" this by caching feet.

## `src/store/workspace.ts`

One Zustand store holding project, documents, sheets, layers, takeoffs,
items, assemblies, assemblyItems, directCosts, proposalEntries, snapshots, plus editor state.

- **Fail-Closed Loading (`load(projectId)`):** Evaluates 11 parallel entity
  queries (`projects`, `documents`, `sheets`, `layers`, `takeoffs`, `items`,
  `assemblies`, `assembly_items`, `direct_costs`, `proposal_entries`, `bid_snapshots`). If any
  query fails or if `project.data` is missing, the load atomically fails closed:
  it sets `loadError` and zeroes out all collections to prevent partial-state
  estimates from rendering or being exported.
- **Autosave & Durable Save Tracking:** Every mutation updates local state
  and queues a database write through a single FIFO write queue (`writeQueue`).
  `saveState` tracks `"saved"`, `"saving"`, or `"error"`. When a write fails,
  `failedWrites` increments and `saveError` records the error string. Invariant:
  `saveState` cannot revert to `"saved"` while `failedWrites > 0`.
- **Bid Snapshot Creation (`createBidSnapshot(label)`):** Executes
  `bidPreflight()` before snapshotting. If any hard blocker exists, snapshot
  creation is rejected with a descriptive error. A single-browser lock rejects
  concurrent snapshot clicks. When ready, it assigns the current local maximum
  revision plus one, deep-copies project configuration, database items,
  assemblies, direct costs, checks, and calculated totals, and inserts a new
  `bid_snapshots` record. Cross-tab/device revision coordination does not exist.
- **Undo/redo:** An unbounded array of `Op` values
  (`add-takeoffs` / `delete-takeoffs` / `update-takeoffs` / `calibrate`),
  each applied forwards or backwards. Only takeoff-shaped edits are undoable;
  form edits (items, rates) are not. Deleting a layer clears both stacks
  deliberately, to avoid resurrecting orphaned takeoffs.
- `window.__ws` exposes the store for E2E tests and console debugging.

## Components

| Component | Notes |
|---|---|
| `takeoff/TakeoffView.tsx` | Three-pane layout, global keyboard handling. **Keys `SheetCanvas` by sheet id** so switching sheets remounts it — that is how per-sheet state resets. |
| `takeoff/SheetCanvas.tsx` | Largest file. Canvas render + SVG marker overlay, zoom/pan, all tool interaction, calibration dialog. Exposes `window.__voltview` for tests. |
| `takeoff/SheetsPanel.tsx` | Upload and sheet list backed by local client storage. |
| `takeoff/SheetAnalysis.tsx` | AI title-block reading and its confirm dialog. |
| `takeoff/LayersPanel.tsx` | Layers, item/assembly linking, rise/drop, typical multiplier. |
| `takeoff/AutoCount.tsx` | AI count orchestration + the review queue. |
| `estimate/DatabaseView.tsx` | Items, assemblies, CSV bulk edit, and catalog-health report. |
| `estimate/EstimateView.tsx` | Extended lines, rollup, issue banners. |
| `estimate/SummaryView.tsx` | Rates, direct costs, bid preflight status, revision snapshots, bid summary, export. |

## Benchmarks & Large Estimate Fixtures

- `tests/fixtures/large-estimate-fixture.ts`: Deterministic seeded PRNG generating
  stress-test commercial projects (50 calibrated sheets, 200 layers, 10,000 takeoff objects,
  1,000 catalog items, 200 assemblies with 1,200 component links, 50 direct costs).
- `scripts/benchmark-estimate.ts`: Standalone benchmark runner (`npm run bench`) executing
  multi-iteration warmup and timed phases for `layerQuantities`, `extendEstimate`,
  `summarize & rollup`, and `bidPreflight`.

## API routes (server-only)

`src/app/api/autocount/route.ts` and `src/app/api/sheetinfo/route.ts`.
Both: auth check → API-key check → body-size cap → validate → bounded
concurrency fan-out (4) over a `SymbolDetector` / `SheetAnalyzer`.

`ANTHROPIC_API_KEY` is read **only** in these two files. The Anthropic SDK is
imported only by `lib/autocount/claude.ts` and `lib/sheetai/claude.ts`, which
are imported only by the routes. No client component touches either. Keep it
that way.

## Database Schema & Storage

`supabase/migrations/0001_schema.sql` and `0002_bid_math.sql`.
Tables: `projects`, `documents`, `sheets`, `items`, `assemblies`,
`assembly_items`, `layers`, `takeoffs`, `direct_costs`, `proposal_entries`, `bid_snapshots`.
In local mode, IndexedDB mirrors these 11 tables, atomically journals mutations, and provides
a local `plans` storage bucket namespaced by user id. Project deletion cascades
through project-owned records and removes stored plan binaries.

**Note the cascades**: deleting an item deletes its `assembly_items` rows.
That is why deletion warns about usage first — see
[`06-bug-history.md`](06-bug-history.md).

## The visual identity

Defined in `src/app/globals.css` as CSS custom properties: a quiet, light
estimating workbench with neutral surfaces, restrained borders, a cobalt
action color (`--color-volt`), violet reserved for AI (`--color-ai`), and
tabular monospaced figures. Use the tokens; do not add landing-page styling.
