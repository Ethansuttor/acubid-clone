@AGENTS.md

# Voltline

Start with [.ai/00-START-HERE.md](.ai/00-START-HERE.md).
The current implementation and execution packets are indexed in
[.ai/README.md](.ai/README.md).

For multi-agent work read
[.ai/18-parallel-execution-plan.md](.ai/18-parallel-execution-plan.md).
Use [.ai/16-desktop-task-queue.md](.ai/16-desktop-task-queue.md) for assignments.
Old GD/GA/N queues are superseded. Do not create a second implementation plan.

The user's instructions control scope. Routine reversible implementation,
dependency setup, fixes, and verification within the task do not require
another owner-approval step. Preserve unrelated changes, coordinate shared-file
ownership, and ask only for material missing facts or authorization not already
provided. Do not claim proposed features are implemented.

Use relevant repository skills:
- estimating-math: quantities, money, parsers, outputs.
- ai-feature: local detection and optional provider integration.
- durable-persistence: save/load, backup, migration, restore.
- desktop-shell: Electron, bridge, packaging, credential custody.
- schema-migration: domain/backends/old-data compatibility.
- voltline-verify: selecting and reporting checks.
- job-cost-math: only when post-award work is explicitly assigned.

Core behavior: unresolved quantities are visible; automated results stay
pending until confirmed; failed saves block issued outputs; frozen revisions
remain unchanged; arithmetic comes from shared pure modules and independent
reference examples. See [.ai/04-invariants.md](.ai/04-invariants.md).

Verification is scoped in [.ai/07-verification.md](.ai/07-verification.md).
The final installed candidate needs browser regression, packaged desktop,
migration/recovery, and real-estimate acceptance evidence. A docs-only update
needs documentation checks, not a new application build.
