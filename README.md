# VOLTLINE — Electrical Estimating & Takeoff

A web app for electrical construction estimating: on-screen takeoff from PDF
plan sets, a user-editable item/assembly database, live bid summaries, Excel
export, and AI-assisted symbol counting with a human review queue.

## Running it

```sh
npm install
npm run dev        # http://localhost:3000
```

Configuration lives in `.env.local` (already pointed at the `volt-takeoff`
Supabase project):

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
ANTHROPIC_API_KEY=sk-ant-...   # required only for AI auto-count
```

Sign in with your email. AI auto-count needs your own Anthropic API key on
the server side; everything else works without it.

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
4. **Database tab** — your item database (description, unit, material $,
   labor hours per unit) and assemblies that expand into component items.
5. **Estimate tab** — every layer extended into item lines (assemblies
   expanded), plus a per-item material/labor rollup. Warnings call out
   unlinked layers and uncalibrated sheets.
6. **Summary tab** — labor rate, overhead %, profit % recalculate the bid
   live: `labor cost → prime cost → overhead → subtotal → profit → bid`.
   *Export to Excel* writes Takeoff / Material / Labor / Summary sheets.

## Architecture notes

- Geometry is stored in PDF user-space units; quantities are derived
  through per-sheet calibration at read time, so recalibrating a sheet
  re-derives every measurement. `src/lib/geometry.ts` and
  `src/lib/estimate.ts` are the single source of truth for all quantities,
  dollars, and hours — pure functions, unit-tested against a
  hand-calculated fixture (`tests/fixtures/fixture-project.ts`).
- The AI counting stack is its own module (`src/lib/autocount/`) behind a
  `SymbolDetector` interface: tiling and cross-tile dedup are pure and
  tested; the Claude prompt/model choice is isolated in `claude.ts`
  (default `claude-sonnet-4-6`, override with `ANTHROPIC_MODEL`).
- Supabase: schema + RLS in `supabase/migrations/0001_schema.sql`; plan
  PDFs live in the private `plans` storage bucket namespaced by user id.

## Tests

```sh
npm test              # vitest: geometry, units, estimate math, excel, autocount
npx playwright test   # E2E: all four phases against a local-mode dev server
```
