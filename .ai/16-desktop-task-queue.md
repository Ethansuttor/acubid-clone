# Task dispatch and ready-to-paste instructions

Updated September 7, 2026. This replaces the old model-specific GD queue.
Architecture, ownership, and waves live in
[18-parallel-execution-plan.md](18-parallel-execution-plan.md).

## How to use this pack

Start one integration/coordinator task and give each worker one bounded task
or track from the table below. Different AI models may do the work; choose by
task complexity and judge the result by evidence. There is no requirement to
ask the user to approve every dependency installation or intermediate diff.

Use isolated worktrees/checkouts from the same reviewed baseline. The current
tree contains extensive uncommitted work, so a worktree from HEAD alone may
miss active features. C0 explains how to preserve and distribute that baseline.
Do not run several agents editing this checkout or sharing localhost:3000.

This document dispatches no work by itself. Copy a prompt to a new AI session,
or ask the current agent to execute the plan with available agent tools.

## Coordinator prompt

> Coordinate the Voltline Windows implementation. Read AGENTS.md,
> .ai/00-START-HERE.md, .ai/18-parallel-execution-plan.md, and the track packets
> linked there. First execute C0: preserve current work and establish a common
> reviewed source baseline. Then execute C1: define and test the shared storage,
> runtime, and AI interfaces, including compound backup/restore and assembly
> operations. Allocate isolated worker checkouts with nonoverlapping files and
> distinct build/test profiles. Own shared configuration and dependency changes.
> Dispatch ready tasks in parallel, review their actual diffs and handoffs,
> integrate one at a time, and verify the combined browser and packaged desktop
> flows. Keep existing quantities, money, pending-review rules, and frozen
> snapshots intact. Proceed with authorized reversible work without repeated
> confirmation. Ask only for missing domain facts or permissions not already
> granted; continue independent work while awaiting them. Do not publish,
> upload private drawings, purchase services, or alter live cloud data based
> solely on this plan. Report completed gates, artifacts, and remaining gaps.

## Worker preamble

> Implement TASK_ID from its track packet. Read .ai/00-START-HERE.md,
> .ai/18-parallel-execution-plan.md, .ai/04-invariants.md, and the named packet.
> Confirm your assigned base, checkout, file ownership, and interface version.
> Inspect current code before rebuilding anything described in old docs.
> Preserve unrelated work. Own only the assigned files; send a concrete patch
> request to the coordinator for shared files or dependencies. Complete the
> task and its relevant verification; do not stop at a plan. Do not weaken tests
> or silently change estimating policy to obtain a pass. Put your report in
> .ai/handoffs/TASK_ID.md with changes, base identity, commands/results, artifacts,
> migration effects, remaining uncertainty, and next task unlocked. Do not edit
> the shared status docs while other workers run.

Replace TASK_ID with the actual assignment and append one of these:

| Assignment | Append to the preamble | Dependencies |
| --- | --- | --- |
| A1 | Prepare the real-estimate manifest and comparison harness in .ai/19-real-estimate-acceptance.md. Use synthetic inputs while private reference data is absent; label it honestly. | C0 |
| A2/A3 | Reproduce the supplied completed estimate and produce line-level discrepancies. Keep expected results independent of application output. | A1 + verified source data |
| D1/D2 | Implement the standalone production payload and Electron lifecycle described in .ai/13-windows-desktop-plan.md. Prove offline packaged startup and stable persistence identity. | C1 |
| S1/S2 | Build contract tests and the SQLite/PDF store described in .ai/14-durability-and-sync-plan.md. Preserve compound-operation atomicity and snapshot file references. | C1 |
| S3/S4 | Implement migration, consistent backup/restore, and failure/upgrade checks from .ai/14-durability-and-sync-plan.md. Keep old .voltline.json import working. | S2 |
| V1/V2 | Implement the reproducible detection evaluation and real-plan baseline from .ai/17-autocount-accuracy-plan.md. No tuning on the holdout. | C0; real inputs for V2 |
| V3/V4 | Profile and optimize the measured detector bottleneck, retain every correctness regression, then verify the real worker flow. | V1; coordinate transport with D3 |
| D3 | Implement privileged AI transport and credential custody from .ai/13-windows-desktop-plan.md. Keep web production auth closed and local search offline. | C1 + D2 |
| D4 | Build and validate the Windows installer after integrated storage/AI checks. Record artifact/hash/signing status; do not publish. | I1/I2 + D2 |
| A4 | Run the known-estimate protocol in the installed candidate, including migration, restart, backup, and upgrade. | D4 + S3 + A2 |

The slash assignments can be split between successive sessions, but do not
give S1 and S2 to simultaneous agents editing the same files.

## Integration assignments

I1: wire the tested desktop storage into all runtime paths, including direct
localdb helpers, backup UI, exclusive access, archive/cascades, and snapshots.
Verify browser behavior remains intact and desktop uses only the selected
store. Reject unsupported bridge versions rather than falling back silently.

I2: wire AI transport and reviewed V changes serially. Check local-only zero
API calls, provider failure/cancellation behavior, real PDF worker operation,
and pending/accept/reject/undo quantities in both runtimes.

The coordinator performs I1/I2 or assigns exclusive ownership for their
duration. These are not safe parallel edits to shared components.

## Initial queue status

These statuses describe the planning handoff, not a running scheduler.
No implementation agents have been launched by this documentation update.

| Task | Status | Next action |
| --- | --- | --- |
| C0 | Ready | Inspect current tree and establish baseline |
| C1 | Waiting for C0 | Publish contracts and fake adapters |
| A1 | Ready after C0 | Prepare comparison protocol/harness |
| V1 | Ready after C0 | Inventory and reproduce local evaluation |
| D1/D2 | Waiting for C1 | Bundle server and build shell |
| S1/S2 | Waiting for C1 | Contract suite and storage engine |
| Remaining tasks | Waiting for dependencies | Follow master wave table |

Full release gates are in the master plan. A worker saying "done" is not a
substitute for the coordinator testing the integrated installer.
