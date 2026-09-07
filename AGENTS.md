<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Voltline task entry point

Read [.ai/00-START-HERE.md](.ai/00-START-HERE.md) for current implementation.
For parallel work, use [.ai/18-parallel-execution-plan.md](.ai/18-parallel-execution-plan.md)
and the dispatch prompts in [.ai/16-desktop-task-queue.md](.ai/16-desktop-task-queue.md).

The user's instructions control task scope and override repository preferences.
Proceed with authorized reversible work without inventing owner-only gates.
Preserve unrelated dirty work; establish a shared baseline and isolated
checkouts before parallel edits. A new worktree from HEAD excludes uncommitted
source. One coordinator owns shared contracts, configuration, and integration.

Consult [.ai/04-invariants.md](.ai/04-invariants.md) for quantity, money, save,
review, and output behavior. Verify against the assigned task's actual risks;
report what ran and what remains unverified. Documentation-only edits do not
require the entire application test suite.
