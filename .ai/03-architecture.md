# Architecture

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · Zustand ·
PDF.js · ExcelJS · Supabase · `@anthropic-ai/sdk`.

## The layer rule

```
  pure logic  (src/lib/*.ts)        <- all arithmetic lives here, no React, no I/O
      ^
  state       (src/store/workspace.ts)   <- one Zustand store, write-through to DB
      ^
  components  (src/components/**)        <- render + input only
      ^
  routes      (src/app/**)               <- pages and two server API routes
```

**Components never compute money.** They call `layerQuantities` →
`extendEstimate` → `estimateTotals` → `summarize` and render the result. This
is why the arithmetic is testable without a browser, and why three different
surfaces (Estimate tab, Summary tab, Excel export) can never disagree.

## `src/lib` — the pure core

| File | Responsibility |
|---|---|
| `types.ts` | Domain types mirroring the database schema. |
| `geometry.ts` | Distance, polyline length, shoelace area, calibration → scale, and `takeoffQuantity()` which turns one takeoff object into a real-world number. |
| `estimate.ts` | **The money.** Layer quantities, assembly expansion, per-item rollup, totals, bid summary, issue reporting, delete-usage lookups. |
| `excel.ts` | Formats the estimate into a 4-sheet workbook. Computes nothing itself. |
| `csv.ts` | RFC4180 parser + item/assembly import-export and merge. |
| `units.ts` | Feet-inch parsing/formatting, number formatting, `parseNumericInput`. |
| `pdf.ts` | PDF.js wrapper with a per-document cache. |
| `supabase.ts` | Client factory; swaps in the local stand-in when `NEXT_PUBLIC_LOCAL_MODE=1`. |
| `localdb.ts` | localStorage-backed stand-in implementing the narrow Supabase subset the app uses. Dev/test only. |
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
items, assemblies, assemblyItems, directCosts, plus editor state.

- **Autosave** is write-through: every mutation updates local state and
  queues a database write. `saveState` drives the saved/saving indicator.
- **All writes go through one FIFO queue** (`writeQueue`). Supabase query
  builders are lazy thenables, so queueing defers the HTTP call. This exists
  because a fast add→undo→redo could otherwise land out of order and
  resurrect a deleted row.
- **Undo/redo** is an unbounded array of `Op` values
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
| `takeoff/SheetsPanel.tsx` | Upload and sheet list. |
| `takeoff/SheetAnalysis.tsx` | AI title-block reading and its confirm dialog. |
| `takeoff/LayersPanel.tsx` | Layers, item/assembly linking, rise/drop, typical multiplier. |
| `takeoff/AutoCount.tsx` | AI count orchestration + the review queue. |
| `estimate/DatabaseView.tsx` | Items, assemblies, CSV bulk edit. |
| `estimate/EstimateView.tsx` | Extended lines, rollup, issue banners. |
| `estimate/SummaryView.tsx` | Rates, direct costs, bid summary, export. |

## API routes (server-only)

`src/app/api/autocount/route.ts` and `src/app/api/sheetinfo/route.ts`.
Both: auth check → API-key check → body-size cap → validate → bounded
concurrency fan-out (4) over a `SymbolDetector` / `SheetAnalyzer`.

`ANTHROPIC_API_KEY` is read **only** in these two files. The Anthropic SDK is
imported only by `lib/autocount/claude.ts` and `lib/sheetai/claude.ts`, which
are imported only by the routes. No client component touches either. Keep it
that way.

## Database

`supabase/migrations/0001_schema.sql` and `0002_bid_math.sql`.
Tables: `projects`, `documents`, `sheets`, `items`, `assemblies`,
`assembly_items`, `layers`, `takeoffs`, `direct_costs`. Every table has RLS
scoped to `user_id = auth.uid()`. Plan PDFs live in a private `plans` storage
bucket namespaced by user id.

**Note the cascades**: deleting an item deletes its `assembly_items` rows.
That is why deletion warns about usage first — see
[`06-bug-history.md`](06-bug-history.md).

## The visual identity

Defined in `src/app/globals.css` as CSS custom properties: a "night drafting
table" — deep blue-black ground, blueprint grid, amber (`--color-volt`)
accent, cyan (`--color-ai`) reserved for AI-originated things, IBM Plex Mono
for data and labels. Use the tokens; don't introduce literal colors.
