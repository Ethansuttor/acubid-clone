# AI documentation index

Updated September 7, 2026.

Start with [00-START-HERE.md](00-START-HERE.md). For implementation use
[18-parallel-execution-plan.md](18-parallel-execution-plan.md) and
[16-desktop-task-queue.md](16-desktop-task-queue.md). The user's instructions
control scope; docs describe requirements, current evidence, and proposed work.

## Active execution packets

| File | Purpose |
| --- | --- |
| [18-parallel-execution-plan.md](18-parallel-execution-plan.md) | Common baseline, contracts, file ownership, parallel waves, integration and release gates |
| [16-desktop-task-queue.md](16-desktop-task-queue.md) | Coordinator/worker prompts and initial dispatch queue |
| [13-windows-desktop-plan.md](13-windows-desktop-plan.md) | D1–D4: standalone payload, Electron lifecycle, AI custody, installer |
| [14-durability-and-sync-plan.md](14-durability-and-sync-plan.md) | S1–S4: contract suite, SQLite, migration, backup, crash/upgrade tests |
| [17-autocount-accuracy-plan.md](17-autocount-accuracy-plan.md) | V1–V4: evaluation, real labels, performance, worker integration |
| [19-real-estimate-acceptance.md](19-real-estimate-acceptance.md) | A1–A4: independently checked job through browser and installed Windows app |

## Current context and evidence

| File | Purpose |
| --- | --- |
| [01-product.md](01-product.md) | Intended workflow and limits |
| [02-domain.md](02-domain.md) | Electrical estimating vocabulary |
| [03-architecture.md](03-architecture.md) | Implemented modules and transition seams |
| [04-invariants.md](04-invariants.md) | Quantity, money, persistence, review and output requirements |
| [05-decisions.md](05-decisions.md) | Current decisions with historical rationale |
| [06-bug-history.md](06-bug-history.md) | Prior defects and why regression cases exist |
| [07-verification.md](07-verification.md) | Current commands and dated evidence |
| [08-environment.md](08-environment.md) | Running the app and tooling constraints |
| [09-roadmap.md](09-roadmap.md) | Priorities, completed foundation, future features |
| [10-audit-and-competitive-roadmap.md](10-audit-and-competitive-roadmap.md) | Current repository gaps and assigned tracks |
| [11-gemini-flash-task-queue.md](11-gemini-flash-task-queue.md) | Optional small follow-ons; not another active queue |
| [12-local-product-review.md](12-local-product-review.md) | September 6 recovery/workflow review record |
| [13-image-detection.md](13-image-detection.md) | Implemented detector fixes and dated synthetic evidence |
| [15-proposed-skills.md](15-proposed-skills.md) | Index of existing repository skills |

## Deferred research

[12-spectrum-job-cost-plan.md](12-spectrum-job-cost-plan.md) and
[13-cloud-durability-and-non-llm-autocount.md](13-cloud-durability-and-non-llm-autocount.md)
retain historical research. Their old task numbers, completion statements,
product/model claims and owner-action lists are not current dispatch
instructions. Revalidate relevant assumptions if that work is assigned.

## Maintaining the pack

Keep one current execution queue. Update code facts when implementation changes.
Record evidence with date and tree identity; never replace "not run" with an old
pass. Preserve historical results as historical. If code differs from intended
behavior, investigate whether the code or docs need correction rather than
assuming the code is automatically right.

During parallel implementation only the coordinator edits shared status docs;
workers use individual handoffs. No worker has been dispatched by this
documentation update.
