# VOLTLINE — Electrical Estimating & Takeoff

A web app for electrical construction estimating: on-screen takeoff from PDF
plan sets, a user-editable item/assembly database, live bid summaries, Excel
export, and AI-assisted symbol counting with a human review queue.

## Running it

```sh
npm install
cp .env.example .env.local   # then add your ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000
```

Configuration lives in `.env.local` (`.env.example` is already pointed at
the `volt-takeoff` Supabase project):

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
ANTHROPIC_API_KEY=sk-ant-...   # required only for the AI features
```

Sign in with your email. AI auto-count and sheet analysis need your own
Anthropic API key on the server side; everything else works without it.

### Database migrations

Both files in `supabase/migrations/` must be applied to the Supabase project
before first use — run them in order in the SQL editor, or with the Supabase
CLI. `0002_bid_math.sql` is **required**, not optional: the app writes
`waste_pct` / `tax_pct` / `labor_factor_pct` on projects and
`typical_multiplier` on layers, so creating a project against a database that
only has `0001` will fail. (Reading direct costs is the one thing that
degrades quietly, so an un-migrated database shows an empty cost list rather
than erroring.)

**Local mode** (`NEXT_PUBLIC_LOCAL_MODE=1 npm run dev`) replaces Supabase
with a localStorage-backed store — used for offline dev and for the E2E
tests in sandboxes without network access to Supabase. Any email/password
signs in. Production runs against real Supabase.

## Workflow

1. **Projects** — create a project on the home screen.
2. **Takeoff tab** — upload a plan set PDF (one sheet per page).
   - Calibrate each sheet: press `K`, click two points a known distance
     apart, type the distance (`25`, `25.5`, or `25' 6"`).
   - Create color-coded layers (count / linear / area) and link each to an
     item or assembly. Linear layers have a per-run rise/drop allowance.
   - Tools: `V` select, `C` count, `L` linear, `A` area, `K` calibrate,
     `B` AI count. `Enter`/double-click/right-click finishes a run, `Esc`
     cancels, `Delete` removes the selection, `Ctrl+Z`/`Ctrl+Shift+Z`
     undo/redo (unlimited), wheel zooms, space-drag or middle-drag pans.
   - Everything autosaves on every edit (watch the saved/saving indicator).
3. **AI auto-count** — select a count layer, press `B`, drag a box around
   ONE example symbol. The sheet is tiled into overlapping crops, sent to
   Claude vision, and deduplicated detections come back as dashed blue
   PENDING markers. They count for nothing until you accept them:
   `←`/`→` navigate, `Y` accept, `N` reject, `Shift+A` accept all,
   `Shift+R` reject all. Review actions are undoable.
4. **AI sheet analysis** — press *✨ Read* in the Sheets panel and Claude
   reads each title block, proposing a sheet name and a calibration derived
   from the printed drawing scale (`1/4" = 1'-0"` → 4 ft per inch of paper →
   4/72 ft per PDF unit). Proposals are applied only when you confirm, and
   applying one is undoable. The derivation assumes the PDF was plotted at
   true size, so spot-check one known dimension before taking off.
5. **Typical areas** — set a layer's *typical ×* to apply one floor's takeoff
   to N identical floors. The multiplier shows on the layer and in the export.
6. **Database tab** — your item database (description, unit, material $,
   labor hours per unit) and assemblies that expand into component items.
   *Bulk edit* exports either table to CSV and re-imports it, matching on
   `code` so re-importing an updated price book keeps every layer link. Rows
   that can't be read are reported by line number rather than skipped.
7. **Estimate tab** — every layer extended into item lines (assemblies
   expanded), plus a per-item material/labor rollup. A red banner lists any
   layer carrying quantity that cannot be priced — a deleted item, an empty
   assembly, or an assembly short a deleted component — so quantity is never
   silently missing from a bid.
8. **Summary tab** — the full bid, recalculating live:

   ```
   material from takeoff
     + waste %              (loss allowance)
     + sales tax %          (on material after waste)
     = material total
   labor hours from takeoff
     ± labor factor %       (job conditions)
     × labor rate           = labor cost
   + direct job costs marked "marked up"
     = prime cost
     + overhead %  = subtotal
     + profit %
   + direct job costs marked "at cost"
     = BID PRICE
   ```

   **Direct job costs** cover everything not from takeoff — gear quotes,
   lighting packages, subcontractors, permits, equipment rental, bonds —
   each flagged whether overhead and profit apply or it is carried at cost.
   *Export to Excel* writes Takeoff / Material / Labor / Summary sheets, and
   an incomplete bid is flagged in red at the top of the Summary sheet.

## Architecture notes

- Geometry is stored in PDF user-space units; quantities are derived
  through per-sheet calibration at read time, so recalibrating a sheet
  re-derives every measurement. `src/lib/geometry.ts` and
  `src/lib/estimate.ts` are the single source of truth for all quantities,
  dollars, and hours — pure functions, unit-tested against a
  hand-calculated fixture (`tests/fixtures/fixture-project.ts`).
- Both AI features are separate modules behind narrow interfaces so the
  model or prompting can be swapped without touching the UI:
  `src/lib/autocount/` (`SymbolDetector` — tiling and cross-tile dedup are
  pure and tested) and `src/lib/sheetai/` (`SheetAnalyzer` — drawing-scale
  parsing is pure and tested). Each has its Claude prompt isolated in
  `claude.ts` (default `claude-sonnet-4-6`, override with `ANTHROPIC_MODEL`).
- Nothing an AI produces reaches the bid unreviewed: auto-count detections
  land as pending markers, and sheet-analysis results land as proposals.
- Supabase: schema + RLS in `supabase/migrations/`; plan PDFs live in the
  private `plans` storage bucket namespaced by user id.

## Tests

```sh
npm test              # vitest: geometry, units, estimate math, bid math,
                      #         CSV, drawing scales, excel, autocount
npx playwright test   # E2E: every feature above, against a local-mode dev server
```

The estimating math is anchored to a hand-calculated fixture project in
`tests/fixtures/fixture-project.ts` — every dollar and hour in it was worked
out by hand and is asserted line by line.
