# Start here

Updated September 7, 2026.

## Product and next milestone

Voltline is a single-user electrical estimating and PDF takeoff application.
The intended user wants to replace their Accubid/LiveCount workflow with a
dependable Windows app. The next milestone is a known real bid reproduced,
reopened, backed up, restored, and exported from an installed Windows build.

Start implementation with [the parallel execution plan](18-parallel-execution-plan.md).
Use [the dispatch prompts](16-desktop-task-queue.md) to assign work to another AI.

The user's instructions control scope and override repository preferences.
These docs explain current behavior and planned work; they are not an extra
permission layer. Keep quantities, commercial policy, and recovery behavior
explicit when changing them.

## Current implementation

- Next.js 16 / React 19 / TypeScript. No desktop implementation in the reviewed baseline.
- Single-user local access: username 1, empty password; this is not server authentication.
- IndexedDB stores records and PDF blobs, with an atomic mutation journal.
  Legacy localStorage data migrates on first open. The active client does not
  connect to Supabase.
- The local adapter rewrites the entire table collection per mutation.
  It implements a narrow Supabase-shaped interface, not full SDK/sync parity.
- Workspace loading checks 11 entity queries, including proposal_entries,
  and fails closed on incomplete/error results.
- Writes are serialized; unresolved save failures remain visible and block
  issued outputs. One editing tab per browser origin/profile uses Web Locks.
- Portable backup/restore includes PDFs and checksum validation; current
  limits are 256 MB total and 128 MB input PDFs. Restore needs an empty
  workspace. Folder mirroring exists; folder-mirror restore does not.
- Count/linear/area takeoff, calibration, item/assembly CSV, commercial bid
  math, catalog diagnostics, revisions, scope/proposal, Excel export, and
  area/system/phase breakdown are implemented.
- Allowance/alternate proposal amounts remain reference-only; full selectable
  pricing scenarios are not implemented.
- Local symbol search runs in a browser worker; candidates stay pending until
  reviewed. Optional AI reviews bounded crops or proposes sheet metadata.
  Both AI API routes reject all requests in production.
- Cloud sync, desktop SQLite, installers, real-plan detection acceptance,
  and real-estimate replacement acceptance remain open.

## Evidence

The September 7 code review in this task ran 433 unit tests across 25 files,
typecheck, lint, production build, and estimate benchmark successfully.
It did not rerun browser E2E or validate a real job. Code may have changed
since that run: check the current tree and [verification ledger](07-verification.md).

Prior synthetic detection evidence is in [13-image-detection.md](13-image-detection.md).
Do not convert synthetic/mock results into a claim about real drawings.

## Read only what the task needs

| Need | Document |
| --- | --- |
| Multi-agent implementation | [18-parallel-execution-plan.md](18-parallel-execution-plan.md) |
| Ready-to-paste assignments | [16-desktop-task-queue.md](16-desktop-task-queue.md) |
| Current modules and boundaries | [03-architecture.md](03-architecture.md) |
| Quantity, money, save/review rules | [04-invariants.md](04-invariants.md) |
| Domain vocabulary | [02-domain.md](02-domain.md) |
| Prior decisions and defects | [05-decisions.md](05-decisions.md), [06-bug-history.md](06-bug-history.md) |
| Checks and honest reporting | [07-verification.md](07-verification.md) |
| Setup/runtime details | [08-environment.md](08-environment.md) |
| Current priorities and future ideas | [09-roadmap.md](09-roadmap.md) |
| Full document index | [README.md](README.md) |

Before writing Next.js code, read the relevant installed guide in
node_modules/next/dist/docs/. Before parallel edits, establish C0's common
baseline: new worktrees from HEAD do not contain this checkout's dirty files.
