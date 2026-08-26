# The product

## Who uses it

One electrical estimator at an electrical contractor. They currently run
**Trimble Accubid** (estimating: item database, assemblies, extension, bid
summary) and **Trimble LiveCount** (on-screen takeoff: counting symbols and
measuring runs on PDF plan sets). Voltline replaces both for their own
workflow.

They are the domain expert. When their description of estimating practice
conflicts with an assumption in the code, they are right.

## What it must not be

- **Not a clone of Trimble's product.** No Trimble names, UI assets, or
  licensed item/labor databases anywhere in this codebase. Labor units come
  from a database the user populates themselves.
- **Not a demo.** It is used on live bids.
- **Not "approximately right".** See [`04-invariants.md`](04-invariants.md).

## The competitive thesis

Accubid's advantages were a licensed labor-unit database and click-speed on a
mouse. Neither is where an estimator's money actually goes:

- **The hours** go to reading specifications, reconciling addenda, and
  chasing what the drawings don't say — not to clicking receptacles.
- **The losses** go to scope that was never counted: a fire alarm riser on a
  sheet nobody opened, a spec line requiring rigid conduit in slab. Speed
  tools don't protect against omission; comprehension does.
- **The durable moat** is a labor database that learns from the contractor's
  own job-cost actuals. A purchased database is the same one the competition
  bought.

That thesis is what makes the AI features strategic rather than decorative,
and it drives the priorities in [`09-roadmap.md`](09-roadmap.md).

## Feature inventory (all working)

**Takeoff.** Multi-page PDF plan sets rendered with PDF.js. Per-sheet scale
calibration by clicking two points and typing a known distance (accepts
`25`, `25.5`, `25' 6"`). Three tools: count, linear (with a per-run rise/drop
allowance), area. Color-coded layers, each tied to an item or assembly.
Markers are editable after the fact — drag to move, drag vertices, delete.
Unlimited undo/redo. Autosave on every edit. Keyboard-first:
`V` select, `C` count, `L` linear, `A` area, `K` calibrate, `B` AI count.

**Typical areas.** A per-layer multiplier: take off one floor, apply it to N
identical floors.

**Estimating.** User-owned item database (code, description, unit, material
cost per unit, labor hours per unit). Assemblies that expand into component
items. Takeoff quantities extend through items or assemblies into material
cost and labor hours. CSV import/export for both tables, matched on `code`.

**Bid.** Material waste %, sales tax %, labor factoring %, direct job costs
(gear quotes, subs, permits, equipment, bonds) each flagged whether overhead
and profit apply. Live recalculation. Excel export with Takeoff / Material /
Labor / Summary sheets.

**AI auto-count.** Draw a box around one example symbol; the sheet is tiled
into overlapping crops, sent to Claude vision, detections are deduplicated
across tile seams and land in a keyboard-driven review queue as pending
markers that count for nothing until accepted.

**AI sheet analysis.** Reads each sheet's title block, proposing a sheet name
and a calibration derived from the printed drawing scale. Proposals only.
