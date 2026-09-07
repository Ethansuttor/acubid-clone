# Product

Updated September 7, 2026.

Voltline supports one electrical estimator's PDF takeoff and bid preparation.
The near-term target is a dependable Windows application for the user's own
workflow. Team distribution and post-award accounting are separate future
scopes, not implied prerequisites.

## What usefulness means

A user can load actual drawings, calibrate them, count/measure scope, assign
their items and assemblies, inspect material/labor extensions, apply their
commercial settings, review omissions, freeze a bid revision, and issue
consistent outputs. They can close the app and recover their work without
reconstructing the estimate.

Accuracy is defined against estimator-approved reference jobs and policies,
not just tests that reproduce our own implementation. The acceptance protocol
is [19-real-estimate-acceptance.md](19-real-estimate-acceptance.md).

## Implemented workflow

PDF takeoff includes count, linear/area tools, per-sheet calibration,
rise/drop, layer multipliers, layers and item/assembly links, edit/undo/redo,
and pending automated candidates. Local symbol search needs no API key;
optional provider services review crops and propose title-block metadata.

The database has items, assembly components, CSV import/export, and diagnostics.
The estimate includes material and labor, burden, direct costs and optional
tax, waste/escalation, contingency, small tools, overhead/profit, and bond.
Preflight guards Excel/proposal/snapshot output. Area/system/phase tags support
a reconciled breakdown. Frozen revisions preserve captured inputs and totals.

Project archive/restore, portable workspace backup with PDFs, and an optional
recovery folder exist. See the current limits in [00-START-HERE.md](00-START-HERE.md).

## Expectations to keep separate

- A Windows installer is not proof of reliable storage or estimator acceptance.
- A fast calculation benchmark does not measure drawing interaction or saves.
- Finding a boxed symbol does not establish complete scope comprehension.
- Proposal allowances/alternates are not selectable priced scenarios.
- A cloud-shaped adapter is not cloud synchronization.
- A checksum detects damage; it is not encryption or an independent backup.

## Product priorities

First: a known completed estimate, a working installer, durable local storage,
and a tested migration/recovery path. Next: fix observed workflow gaps and
improve detection using real labeled data. Later: richer scenarios, addenda,
specification review, supplier/actuals feedback, and explicitly scoped cloud
or team capabilities.

Use the contractor's authorized catalog and actual labor/pricing conventions.
Do not invent supplier prices or proprietary database compatibility.
The user supplies domain judgments where code cannot establish them.

No replacement-readiness or whole-plan automation claim is established yet.
The [parallel plan](18-parallel-execution-plan.md) defines evidence gates.
