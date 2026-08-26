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

- **Branch:** `main` in `Ethansuttor/acubid-clone`.
- **Verified August 26, 2026:** 324 unit tests across 15 files and 10
  Playwright E2E specs pass. Production build, typecheck, lint, and the
  large-estimate benchmark are clean. See [`07-verification.md`](07-verification.md)
  for the commands and measured benchmark result.
- **Client & Persistence Architecture:** Local-first browser architecture with
  `LOCAL_ONLY = true` configured in `src/lib/local-config.ts` and backed by
  a localStorage client (`src/lib/localdb.ts`). Cloud Supabase is disconnected
  from the active client workflow while maintaining schema-shaped API parity.
- **Fail-Closed Loading:** Atomic workspace load (`load(projectId)` in `src/store/workspace.ts`)
  evaluates all 10 entity queries (`projects`, `documents`, `sheets`, `layers`,
  `takeoffs`, `items`, `assemblies`, `assembly_items`, `direct_costs`,
  `bid_snapshots`). If any query fails, the store fails closed with a descriptive
  `loadError` and zeroes collections rather than presenting a partial estimate.
- **Bid Preflight Gate:** Pure `bidPreflight()` engine (`src/lib/preflight.ts`)
  checks persistence health, missing quantities, pending AI hits, labor rates,
  raw commercial/layer/catalog inputs, calculated totals, direct costs, empty
  bids, sheet presence, zero-value items, typical multipliers, and markups.
- **Catalog Diagnostics:** Pure `diagnoseCatalog()` engine (`src/lib/catalogDiagnostics.ts`)
  detects zero-cost items, zero-labor items, duplicate item/assembly codes,
  empty assemblies, and missing component references. The Database view exposes
  the report without modifying catalog data or bid math.
- **Local Bid Snapshots:** `createBidSnapshot()` deep-copies project state,
  estimate inputs, checks, and totals to a new local `bid_snapshots` record only
  when preflight is ready. The product never edits an existing snapshot. Revisions
  use the current browser project's maximum revision plus one; there is no
  cross-device or multi-user revision guarantee yet.
- **Working:** PDF takeoff (count/linear/area), per-sheet calibration,
  item + assembly database with CSV round-trip, full commercial bid math, Excel export,
  bid preflight readiness checks, catalog diagnostics, immutable revision snapshots,
  AI symbol auto-count with a review queue, and AI title-block reading.
- **Not yet verified against reality:** both AI features have only ever run
  against mocked responses. There is no `ANTHROPIC_API_KEY` in the dev
  environment and no real plan set has been used. Detection accuracy and
  title-block reading on actual drawings are **unknown**.

## The core files that matter most

| File | Why |
|---|---|
| `src/lib/estimate.ts` | Every quantity, dollar and hour in the app. Pure. |
| `src/lib/geometry.ts` | Takeoff geometry → real-world measurements. Pure. |
| `src/lib/preflight.ts` | Pure commercial bid-readiness preflight gate. |
| `src/lib/catalogDiagnostics.ts` | Pure item and assembly catalog health diagnostics. |
| `src/store/workspace.ts` | All app state, fail-closed loading, autosave queue, undo/redo, bid snapshots. |
| `src/components/takeoff/SheetCanvas.tsx` | The drawing surface. Largest component. |
| `tests/fixtures/fixture-project.ts` | Hand-calculated ground truth for estimating math. |
| `tests/fixtures/large-estimate-fixture.ts` | Seeded PRNG large-scale estimate performance fixture. |

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
