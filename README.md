# Voltline — Electrical Estimating & Takeoff

Voltline is a product workspace for electrical on-screen takeoff and estimating:
PDF plans, calibrated count/linear/area takeoff, item and assembly catalogs,
commercial bid math, readiness checks, revision snapshots, Excel export, and
AI-assisted review workflows.

It is intentionally an application—not a landing page—and is currently a
single-user, local-only build.

## Windows implementation and parallel AI work

The Windows version is planned; this repo currently runs as a browser app.
Start with [the parallel execution plan](.ai/18-parallel-execution-plan.md).
It defines separate desktop, storage/recovery, detection, and real-estimate
validation tracks, with shared interfaces, file ownership, and release gates.

Use [the coordinator and worker prompts](.ai/16-desktop-task-queue.md) to assign
work to Codex or another AI. Each worker needs an isolated checkout from the
same reviewed source baseline; the current dirty tree is not automatically
included in new worktrees. The first desktop build will bundle Next.js
standalone inside Electron, with SQLite integrated after contract tests.

The acceptance target is [a known completed bid](.ai/19-real-estimate-acceptance.md)
reproduced, reopened, migrated, restored, and exported from the installed app.
See [the docs index](.ai/README.md) for current context and deferred research.

## Run locally

```sh
npm install
cp .env.example .env.local   # optional; only if .env.local does not already exist
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

## Protect and recover your work

From **Projects → Data protection**, choose **Download backup** to save all
projects, catalog records, bid revisions and plan PDFs in one `.voltline.json`
file. Keep it on another drive. The portable format includes a corruption check;
files are unencrypted and limited to 256 MB (128 MB of PDF input before encoding).
Larger workspaces can still use the recovery-folder mirror.

To test recovery, open Voltline at the same address in a fresh browser profile,
choose **Restore backup**, select the file, review the project list and click
**Restore this backup**. Records and plan files restore together. An occupied
workspace refuses replacement, preserving current work. The portable importer
accepts files produced by Download backup; folder-mirror JSON is a separate
recovery format and is not accepted by this control.

Archive completed bids from the project row and use **Show archived projects**
to restore them. Permanent deletion is available from the archive.

Only one estimate editing tab can be open per browser profile. Finish saving and
return to Projects before opening another editor or making a backup. Use a current
browser with Web Locks support. Within an estimate, expand **Estimate setup** for
the guided workflow. Save failures remain visible and block issued bid outputs.

See [the local product review](.ai/12-local-product-review.md) for findings,
verification evidence and remaining release limits.

## Workflow

1. **Projects** — create or reopen a local estimate.
2. **Takeoff** — upload a PDF, calibrate sheets, create count/linear/area
   layers, and link each layer to an item or assembly.
3. **Symbol search and AI review** — box an example symbol to search locally
   without an API key. Optional AI reviews ambiguous crops; sheet-reading
   proposes metadata. All detections remain pending until an estimator confirms them.
4. **Database** — edit items and assemblies, round-trip CSV pricebooks, and
   review catalog-health diagnostics for duplicates, empty assemblies,
   missing component links, and zero prices/labor units.
5. **Estimate** — inspect extended layer/item lines, material rollup, labor,
   and any quantity that could not be priced.
6. **Scope** — classify takeoff by area/system/phase and prepare inclusions,
   exclusions, allowances, alternates, and a preflight-gated printable proposal.
7. **Summary** — set rates/markups and direct costs, resolve bid-preflight
   blockers, export Excel, and create frozen local revision snapshots.

### Takeoff controls

- `V` select, `C` count, `L` linear, `A` area, `K` calibrate, `B` symbol search.
- `Enter`, double-click, or right-click finishes a run; `Esc` cancels.
- `Delete` removes the selection; `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo.
- Wheel zooms; space-drag or middle-drag pans.

Geometry stays in PDF user-space units. Real quantities are derived from the
current sheet calibration, so recalibration re-derives measurements rather
than leaving stale feet in storage.

### Local symbol search

Select a count layer, press `B`, and box one clear symbol with a little whitespace.
The browser worker checks rotated and mirrored examples across the sheet.
Choose Broad, Balanced, or Strict matching; enable ±10% size tolerance when
needed. Cancel search discards the unfinished run. Repeated searches skip
existing pending and confirmed marks on the same layer.

Local mode sends no images. Optional AI review sends at most 48 ambiguous crops
in four requests, keeps candidates available if the API fails, and never approves
quantities. Visual match scores are similarity scores, not accuracy probabilities.

`npm run eval:local` checks the four saved synthetic raster fixtures and exits
nonzero on missed or extra symbols. Real-plan accuracy remains unverified; see
[detection verification](.ai/13-image-detection.md) for evidence and limitations.

## Bid math

```text
material from takeoff + waste + escalation
  + sales tax on that material = material total
labor hours × labor factor × rate = bare labor
bare labor + burden = labor cost
material + labor + small tools + O&P-applicable direct costs and their tax
  = prime cost
prime + contingency + overhead, then profit
  + at-cost direct costs and their tax = pre-bond total
pre-bond total / (1 - bond rate) = bid price
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
authentication. Current automated provider tests use mocked responses; local detector tests
also use real synthetic PDF pixels. Accuracy on representative real plan sets
remains unverified.

## Verification

```sh
npm test             # unit tests; dated results in .ai/07-verification.md
npm run typecheck    # TypeScript
npm run lint         # ESLint
npm run bench        # deterministic 10,000-takeoff engine benchmark
npm run test:e2e     # browser workflows
npm run build        # production Next.js build
```

The small fixture in `tests/fixtures/fixture-project.ts` is hand-calculated
ground truth. The large fixture in `tests/fixtures/large-estimate-fixture.ts`
is deterministic and used for throughput/integrity benchmarking without a
fragile millisecond threshold in the normal unit suite.

Read `.ai/00-START-HERE.md` before substantive changes and
`.ai/04-invariants.md` before touching quantity, money, persistence, or AI
confirmation behavior.
