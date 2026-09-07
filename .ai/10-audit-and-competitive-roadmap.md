# Repository review and product gaps

Updated September 7, 2026. This replaces the earlier mixed historical/current
audit. Prior market comparisons are not freshly verified competitor claims.
Use [the roadmap](09-roadmap.md) for priority and
[the parallel plan](18-parallel-execution-plan.md) for implementation.

## What the code review established

The calculation/geometry/preflight core is reusable. The September 7 review
ran 433 unit tests, typecheck, lint, build, and estimate benchmark successfully.
Browser E2E and real-job acceptance were not rerun by that review; see
[the evidence ledger](07-verification.md).

| Finding | Consequence | Assigned work |
| --- | --- | --- |
| All tables are stored/replaced as one IndexedDB state value per mutation | Save cost grows with workspace and snapshot history; calculation benchmark does not measure it | S1/S2 |
| Direct localdb helpers bypass the client factory | A constructor-only SQLite swap would leave backup/restore and assembly writes in browser storage | C1/I1 |
| Portable backup limited to 256 MB / 128 MB PDF inputs; empty-target restore only | Larger workspaces and migration need a compatible streaming path | S3 |
| Recovery mirror has no dedicated restore tool | A second copy is not an established recovery workflow | S3/S4 |
| Both provider API routes reject production requests | Packaging alone leaves optional AI unavailable | D3 |
| Local detector evidence is synthetic; saved runs take roughly 51–125 s per fixture | Real accuracy and review-time benefit remain unverified | V1–V4 |
| Allowance/alternate amounts are reference-only | Full scenario pricing still needs policy and implementation | A3, B-301 |
| No installed/runtime migration/upgrade evidence | A browser build is not Windows release acceptance | D1–D4, A4 |
| No independently reproduced real bid recorded by this review | Tests cannot establish fit with the contractor's workflow | A1–A4 |

## Existing mitigations to retain

Atomic local transactions and journal writes; same-origin database/editor
locks; fail-closed loads; sticky save errors; output preflight including
browser print; human review of automated proposals; immutable captured
revisions; archive before permanent deletion; atomic assembly replacement;
portable backup validation including PDFs.

These reduce specific risks. They do not prove zero data loss, complete
electrical scope, current supplier prices, or full platform compatibility.

## Reference inputs that change the assessment

The next acceptance run needs a completed job, original PDFs, trusted
line-level quantities and catalog/labor values, commercial settings, and
expected output. Real detection evaluation needs independently checked labels
across representative projects. Use the [acceptance packet](19-real-estimate-acceptance.md).

Do not require the owner to provision cloud accounts, buy certificates, or
supply private data before independent desktop/storage work can proceed.
Ask for the specific missing input when the dependent acceptance step needs it.
