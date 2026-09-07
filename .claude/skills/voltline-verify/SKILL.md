---
name: voltline-verify
description: Select and report verification appropriate to a Voltline change, including pure calculation tests, browser workflows, storage failure cases, and packaged Windows acceptance.
---

# Verification

Use [07-verification.md](../../../.ai/07-verification.md) for current commands
and dated results. The user's task controls scope. Do not run the full app
suite for a documentation-only correction.

Available commands in the reviewed baseline: npm test, npm run typecheck,
npm run lint, npm run bench, npm run test:e2e, npm run build,
npm run eval:local. Desktop scripts are proposed until implemented.

## Choose evidence for the change

- Docs: local links, stale instructions, planned/current distinction, diff.
- Pure math/parsers: independent expected examples plus affected UI/export.
- UI: relevant browser workflow and visual/interaction verification.
- Storage: real adapter, transaction failure, reload, migration/restore.
- Detector: synthetic regressions, actual worker flow, reproducible timing;
  real labels are needed for real-plan claims.
- Release: integrated browser tests, packaged Windows lifecycle, installer,
  migration/backup/crash/upgrade, and known-job acceptance.

Keep pure-calculation benchmark results separate from save, render, and
detector latency. Re-run targeted failures after fixes; do not repeatedly
broaden passing tests without a new concern.

## Environment and isolation

Current Playwright config uses localhost:3000 and reuses a server; it prefers
an explicit browser path or installed Chrome/Edge, then managed Chromium.
Do not copy old 3100/Linux-only assumptions. Use assigned worktrees, distinct
ports/profiles when configured, and otherwise serialize browser runs.

Install needed compatible tooling within the task's authorization. Report
actual environment failures; do not hide them with skips on required gates.

## Test semantics

Provider mocks test transport/review behavior, not live accuracy. Local symbol
search tests use real PDF pixels and the real worker with zero network calls.
Pending hits count for nothing until accepted; save errors block output;
accept/reject/undo/save/reload must agree.

Use accessible names/roles or stable test IDs rather than positional controls.
Keep private plans and destructive recovery tests in isolated data roots.

## Report

Date, task, source identity (including dirty changes), command, exit status,
runtime, artifact path, failures and unverified gates. Historical test counts
are observations, not a minimum to hit. Do not claim a clean install, power-loss
guarantee, or contractor acceptance from unit tests alone.
