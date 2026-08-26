# Start here

## What you are working on

**Voltline** — an electrical estimating + on-screen takeoff web app. One
user: a practising electrical estimator at an electrical contractor who
currently uses Trimble Accubid and LiveCount and intends to replace both with
this. It gets used on **real bids for real money**.

## The single most important thing

> Correctness of the arithmetic outranks every other consideration —
> features, speed, elegance, and your own convenience.

A crash is recoverable. A bid that is quietly 8% short is a job lost or a job
won at a loss. Several bugs in this codebase's history were exactly that
shape. Read [`04-invariants.md`](04-invariants.md) before touching anything
that produces a quantity or a dollar.

## Current state (keep this accurate)

- **Branch:** `claude/electrical-estimating-takeoff-mbpfi3`, tracked by PR #1
  on `Ethansuttor/acubid-clone`.
- **Tests:** 149 unit tests across 8 files, 7 Playwright E2E specs. All pass.
  Build and lint are clean.
- **Database:** Supabase project `volt-takeoff` (`ulswnsdyxfrwvznyraqy`),
  `ACTIVE_HEALTHY`, both migrations applied and verified.
- **Working:** PDF takeoff (count/linear/area), per-sheet calibration,
  item + assembly database with CSV round-trip, full bid math, Excel export,
  AI symbol auto-count with a review queue, AI title-block reading.
- **Not yet verified against reality:** both AI features have only ever run
  against mocked responses. There is no `ANTHROPIC_API_KEY` in the dev
  environment and no real plan set has been used. Detection accuracy and
  title-block reading on actual drawings are **unknown**.

## The five files that matter most

| File | Why |
|---|---|
| `src/lib/estimate.ts` | Every quantity, dollar and hour in the app. Pure. |
| `src/lib/geometry.ts` | Takeoff geometry → real-world measurements. Pure. |
| `src/store/workspace.ts` | All app state, autosave, undo/redo. |
| `src/components/takeoff/SheetCanvas.tsx` | The drawing surface. Largest component. |
| `tests/fixtures/fixture-project.ts` | Hand-calculated ground truth for the math. |

## Before you write code

1. Skim [`03-architecture.md`](03-architecture.md) so you put the change in
   the right layer.
2. If it touches money or quantity, read [`04-invariants.md`](04-invariants.md)
   and [`06-bug-history.md`](06-bug-history.md) — the traps are already mapped.
3. If it touches estimating concepts you can't define precisely, read
   [`02-domain.md`](02-domain.md). Do not guess electrical vocabulary; a
   plausible-sounding wrong assumption becomes a wrong number.

## Before you say it works

Run the checks in [`07-verification.md`](07-verification.md) and report what
actually happened, including failures. Do not describe unverified work as
done — this project's history includes an audit that caught exactly that.
