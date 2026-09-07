# Parallel implementation plan

Updated: September 7, 2026. Status: implementation instructions, not completed work.

## Outcome and scope

Build an installed Windows version of Voltline that can reproduce a known
electrical estimate, reopen it, restore it from backup, and produce the same
quantities and totals. Preserve the browser application during the transition.
Improve symbol search using measured evidence from real drawings.

The working audience is one estimator on one Windows computer. Cloud recovery
remains a desired follow-on capability; cloud sync, team editing, billing, ERP,
and autonomous whole-plan bidding are not prerequisites for the first desktop
release. A later user instruction can change these priorities.

This document coordinates execution. The implementation packets are:

- [Desktop shell and AI transport](13-windows-desktop-plan.md): track D.
- [Storage and recovery](14-durability-and-sync-plan.md): track S.
- [Detection evaluation and performance](17-autocount-accuracy-plan.md): track V.
- [Real-estimate acceptance](19-real-estimate-acceptance.md): track A.
- [Dispatch queue and copy/paste prompts](16-desktop-task-queue.md).
- [Verification evidence](07-verification.md).

Earlier GD/GA/N task numbers are retired as dispatch instructions. Historical
product ideas remain references, not competing queues. No implementation task
is marked complete merely because this documentation exists.

## Baseline: record before coding

The September 7 review observed 433 passing unit tests across 25 files, clean
typecheck/lint/build, and passing estimate benchmark invariants. It did not
rerun E2E or real-job acceptance. Current scripts have no desktop commands.
The active database is IndexedDB; PDFs are blobs. No Electron or SQLite
implementation is present in that reviewed baseline.

Run git status and record the actual current commit and dirty files. Check
whether another agent has already implemented any task below. Verification
records describe the tree at the time of a run, not subsequent parallel edits.

### C0: establish a common integration base

Owner: integration agent. Dependencies: none.

1. Inventory current source, tests, plans, and uncommitted changes. Preserve
   them; do not reset, stash, clean, or stage unrelated work.
2. Establish one named integration checkpoint containing the intended source
   baseline. Include relevant new/untracked files: a new worktree from HEAD
   alone will not include them.
3. If a local checkpoint commit fits the user's authorization, create it from
   reviewed, explicitly selected paths. Otherwise use a reviewed patch plus
   explicit copies of required untracked source in each isolated checkout;
   record hashes and apply the same baseline everywhere. Keep secrets and
   private drawings outside patches and reports.
4. Give each worker an isolated worktree/checkout from that exact base. Branch
   names default to codex/<track>-<task>. Each needs its own node_modules,
   build directory, test outputs, browser profile, and desktop user-data path.
5. Record assignments in a coordinator-owned task table. Creating this plan
   does not create or dispatch any Codex tasks. Use the available agent tools
   when asked to execute; a user may also paste a worker prompt into another AI.

If isolated checkouts cannot be created, serialize edits. Multiple agents may
inspect the same tree, but a conversational file-ownership convention is not a
filesystem lock and cannot make simultaneous builds or writes safe.

### C1: freeze the seams

Owner: integration agent. Dependencies: C0.

Inventory actual call sites before defining interfaces. The factory in
src/lib/supabase.ts casts a narrow local client to SupabaseClient; this is not
a guarantee of full SDK or sync compatibility.

Define small typed contracts in proposed files:
- src/lib/platform/contracts.ts: runtime capabilities and result/error shapes.
- src/lib/platform/storage.ts: browser implementation and adapter selection.
- src/lib/platform/ai.ts: provider-neutral request transport.
- desktop/contracts.ts: serializable IPC DTOs and protocol version.

The names are a starting proposal; finalize once in C1 and distribute the
actual exported signatures and test fixtures to workers. Do not introduce a
generic service framework or rewrite the pure estimating core.

Storage must cover the query subset actually used plus compound operations:
- query and file upload/download/remove;
- replaceAssemblyItems atomically;
- export a consistent workspace snapshot with all referenced PDFs;
- restore a validated backup into an empty destination;
- exclusive editing/maintenance access and storage health.

Direct browser calls exist in workspace.ts (replaceLocalAssemblyItems),
DataProtectionCard.tsx (exportLocalRecoveryBundle, restoreLocalBackup,
withWorkspaceClosed), and browser recovery controls. Route these through the
platform boundary when integrating desktop storage. Keep browser behavior
unchanged and cover these operations in the contract suite. Web Locks alone
do not coordinate a native database or a second desktop process.

AI must support existing optional crop verification and sheet analysis with
abort propagation, bounded input, and explicit failures. No private key or
provider SDK crosses into the renderer bundle.

Publish exact interfaces, ownership, error semantics, backup version policy,
and one runnable fake adapter. Typecheck and test the browser path. Interface
changes after C1 go through the integration agent before dependent edits.

## Ownership

Only the integration agent edits the following shared integration files during
parallel implementation: package.json, package-lock.json, root TS/lint/test
configs, next.config.ts, AGENTS.md, CLAUDE.md, README.md, shared platform
contracts, src/lib/supabase.ts, src/lib/local-config.ts, workspace.ts,
DataProtectionCard.tsx, WorkspaceAccess.tsx, src/app/layout.tsx, project route,
and shared domain/backup types. A worker sends a patch request for these.

| Track | Worker-owned paths after C1 | Shared changes to request |
| --- | --- | --- |
| A: acceptance | new tests/acceptance/**, e2e/acceptance/**, scripts/acceptance/**, private evidence outside Git | formula fixes, catalog/UI changes, E2E config |
| D: desktop | desktop/** except frozen contracts and storage subtree; scripts/desktop/**; e2e-desktop/**; desktop-only settings component | root scripts/config, platform AI seam, API routes/services, shell mounting |
| S: storage | desktop/storage/**; tests/storage-contract/**; scripts/storage/**; proposed src/lib/platform/browser-storage.ts and desktop-storage.ts adapters | browser localdb/recovery fixes, shared types, UI/store switching |
| V: detection | matcher/local worker modules, tests/autocount-*.test.ts excluding frozen transport contracts, scripts/eval-local-detection.ts, new evaluation/benchmark scripts | pipeline.ts AI transport edits, SymbolSearch/AutoCount UI, package changes |

For D, AI service extraction is a separate coordinated integration slice;
do not simultaneously let V edit the route or pipeline. Tests with overlapping
names get a single owner too. Workers write only their own handoff report in
.ai/handoffs/<task-id>.md; the coordinator updates shared plans/status.

Install required dependencies within authorized work without an extra owner
gate. The coordinator performs shared manifest/lockfile changes once, pins
compatible versions, and publishes the resulting lockfile to workers.
Native modules must be built against the runtime in which they will execute.

## Parallel waves and dependencies

| Wave | Work that can run together | Completion condition |
| --- | --- | --- |
| 0 | C0 and current-state audit | Common baseline and ownership recorded |
| 1 | C1; A1 acceptance preparation; V1 evaluation inventory | Contracts frozen; evidence inputs recorded |
| 2 | D1/D2 standalone package + Electron lifecycle; S1/S2 contract tests + SQLite engine; V2 labels/baseline; A2 browser comparison | Each isolated branch passes its targeted checks |
| 3 | D3 AI custody/transport; S3 restore/backup/crash work; V3 measured optimization; A3 discrepancy analysis | No unresolved shared-file collision |
| 4 | I1 integrate storage and native recovery; I2 integrate AI and detector changes serially | Browser and packaged desktop flows verified together |
| 5 | D4 installer; S4 upgrade/recovery drill; A4 installed real-bid run | Release evidence complete or explicit outstanding blockers |

A1 can prepare the harness without private inputs. A real-job comparison and
V2 real-plan metrics require estimator-verified data; do not fabricate them.
Missing data blocks those acceptance claims, not shell/storage development.

No task should run a full build or browser suite against another agent's live
checkout. The current Playwright config hardcodes localhost:3000 and reuses
an existing server; until C1 adds per-checkout configuration, serialize E2E.
Afterwards assign distinct ports and disable unintended server reuse in
verification. Concurrent detection benchmarks distort timing: run measured
performance comparisons on a quiet machine, with recorded hardware.

## Integration procedure

Integration agent:
1. Read each handoff and inspect the actual diff against its declared base.
2. Confirm changed files match ownership. Resolve contract differences before
   applying dependent work. Avoid taking whole shared files from a worker.
3. Apply reviewed changes one track at a time to the integration checkout.
   Rebase/cherry-pick only where authorized; preserve unrelated user edits.
4. After every storage/transport integration run affected contract and UI
   tests. At the final checkpoint run the full unit/typecheck/lint/build and
   web E2E suites, then packaged Electron and recovery checks.
5. Re-run performance work only after competing jobs finish. Separate pure
   calculation throughput, save latency, UI latency, and detector runtime.
6. Update the evidence ledger with commit/tree identity, commands, results,
   environment, artifact paths, and remaining uncertainty.
7. If integration fails, retain the worker result and report the failing
   boundary. Revert only the integration changes responsible, without
   deleting user data or another worker's work.

## Release gates

G1 — Existing browser workflows still pass; pending detections and failed
saves block issued outputs; estimate fixtures and frozen snapshots survive.

G2 — The packaged app launches offline without Node, a development server,
or files from the repository; PDFs and worker assets load; startup failures
and port collisions are visible.

G3 — Acknowledged edits survive forced termination/restart; interrupted
transactions cannot leave partial entities; backup restore validates all
records and PDF hashes; an occupied workspace is preserved.

G4 — Browser-to-desktop migration preserves IDs, snapshots, prices,
geometry, calibration, pending status, and PDF bytes. Corrupt or unsupported
inputs fail without modifying the current workspace.

G5 — A known real job reconciles at the line, quantity, labor, and total
levels against estimator-approved expectations. Every discrepancy is
explained and accepted or fixed. An unavailable reference job means this
gate remains unverified.

G6 — Detection changes preserve synthetic regressions and report real-plan
precision/recall and runtime separately. If real evidence is absent, retain
human review and explicitly label real accuracy unverified.

A local development preview may ship before G5/G6, with its limitations stated.
A claim that Voltline replaces the user's current estimating workflow needs
G5. A claimed detection improvement on real plans needs G6 evidence.

## Worker report template

Task ID / owner:
Base commit and any dirty-baseline manifest:
Status: implemented / verified / blocked / deferred (distinguish them)
Changed files:
Behavior before and after:
Contract changes requested:
Dependencies installed or required:
Commands and exact results:
Artifacts and test profile locations:
Compatibility/migration effects:
Remaining failures or missing inputs:
Next task unlocked:

Do not include API keys, private drawing contents, or customer identifiers in
tracked reports. Do not claim a clean install, crash recovery, live AI run,
or real-estimate acceptance based on mocked tests.

## Decision and authorization rules

These documents guide the work; the user's current instructions control scope
and override repository preferences. Routine reversible implementation,
dependency setup, debugging, and verification within the assigned task should
proceed without repeated confirmation. File ownership is coordination with the
integration agent, not a new owner-approval ceremony.

Ask for missing domain facts when they change quantities or money; prepare the
reviewable example while continuing independent work. Use existing authorization
for private inputs or paid services; this plan alone does not authorize uploads,
purchases, public releases, cloud mutations, or messages to third parties.
Do not deploy, purchase a signing service, enable cloud sync, or publish an
installer just because an implementation packet mentions them.
