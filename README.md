# Voltline — Electrical Estimating & Takeoff

Voltline is a product workspace for electrical on-screen takeoff and estimating:
PDF plans, calibrated count/linear/area takeoff, item and assembly catalogs,
commercial bid math, readiness checks, revision snapshots, Excel export, and
AI-assisted review workflows.

It is intentionally an application—not a landing page—and is currently a
single-user, local-only build.

## Run locally

```sh
npm install
cp .env.example .env.local   # optional unless testing AI in development
npm run dev                  # http://localhost:3000
```

Sign in with username **`1`**. The password is intentionally empty and no
password field is required. Projects, catalog data, snapshots, and plan PDFs
are stored in IndexedDB. Each mutation is committed with a durable local
outbox record; the dashboard can request persistent browser storage and mirror
JSON recovery records plus plan PDFs to a user-selected folder.

This is development authentication and local-first persistence, not production
security or cloud backup. Clearing site data can remove the browser copy; use
the recovery-folder control as a second local copy.
Supabase packages and historical migrations remain as future compatibility
work, but the active client does not connect to Supabase or read Supabase
environment variables.

## Workflow

1. **Projects** — create or reopen a local estimate.
2. **Takeoff** — upload a PDF, calibrate sheets, create count/linear/area
   layers, and link each layer to an item or assembly.
3. **AI review** — optional auto-count and sheet-reading routes create pending
   detections/proposals. Nothing AI-generated reaches the bid until an
   estimator confirms it.
4. **Database** — edit items and assemblies, round-trip CSV pricebooks, and
   review catalog-health diagnostics for duplicates, empty assemblies,
   missing component links, and zero prices/labor units.
5. **Estimate** — inspect extended layer/item lines, material rollup, labor,
   and any quantity that could not be priced.
6. **Scope** — classify takeoff by area/system/phase and prepare inclusions,
   exclusions, allowances, alternates, and a printable proposal.
7. **Summary** — set rates/markups and direct costs, resolve bid-preflight
   blockers, export Excel, and create frozen local revision snapshots.

### Takeoff controls

- `V` select, `C` count, `L` linear, `A` area, `K` calibrate, `B` AI count.
- `Enter`, double-click, or right-click finishes a run; `Esc` cancels.
- `Delete` removes the selection; `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo.
- Wheel zooms; space-drag or middle-drag pans.

Geometry stays in PDF user-space units. Real quantities are derived from the
current sheet calibration, so recalibration re-derives measurements rather
than leaving stale feet in storage.

## Bid math

```text
material from takeoff
  + waste
  + sales tax on material after waste
  = material total

labor hours from takeoff
  × labor factor
  × labor rate
  = labor cost

material + labor + marked-up direct costs
  + overhead
  + profit
  + direct costs carried at cost
  = bid price
```

The pure calculation source of truth is `src/lib/estimate.ts`. Preflight in
`src/lib/preflight.ts` fails closed on unresolved persistence errors, missing
quantity, pending AI, invalid raw inputs/totals, and other commercial blockers.

## Optional AI in development

Add these only to `.env.local`:

```text
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=...       # optional
```

The key is server-only. The local bearer-token bypass in the two AI API routes
is disabled in production; a production AI deployment needs real server-side
authentication. Current automated AI tests use mocked responses, so accuracy
on real plan sets is unknown.

## Verification

```sh
npm test             # 324 Vitest tests across 15 files
npm run typecheck    # TypeScript
npm run lint         # ESLint
npm run bench        # deterministic 10,000-takeoff engine benchmark
npm run test:e2e     # 10 Playwright workflows
npm run build        # production Next.js build
```

The small fixture in `tests/fixtures/fixture-project.ts` is hand-calculated
ground truth. The large fixture in `tests/fixtures/large-estimate-fixture.ts`
is deterministic and used for throughput/integrity benchmarking without a
fragile millisecond threshold in the normal unit suite.

Read `.ai/00-START-HERE.md` before substantive changes and
`.ai/04-invariants.md` before touching quantity, money, persistence, or AI
confirmation behavior.
