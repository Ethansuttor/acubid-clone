# Product roadmap

Updated September 7, 2026. Execution source:
[18-parallel-execution-plan.md](18-parallel-execution-plan.md).

## Next release: dependable personal Windows estimating

1. Reproduce a completed real estimate with independently checked quantities,
   catalog data, labor, commercial settings, and output.
2. Ship a local Electron candidate using bundled Next.js standalone assets.
3. Add SQLite storage with verified browser-data migration and complete
   backup/restore, including historical revisions and PDFs.
4. Improve symbol-search performance and real-plan accuracy with a reproducible
   evaluation set, keeping every automated candidate subject to review.
5. Fix the workflow gaps revealed by the estimator's actual job.

Tracks A, D, S, and V can progress concurrently under the master ownership and
dependency rules. SQLite integration and shared transport/config edits have
one integration owner. Cloud sync is not required for the first installer.

## Implemented foundation — do not rebuild from old prompts

- Count/linear/area takeoff, calibration, rise/drop, typical multipliers.
- Items, assemblies, CSV import/export, catalog diagnostics.
- Waste, escalation, material/direct-cost tax, labor factor/burden, small
  tools, contingency, overhead/profit, and circular final-price bond.
- Sticky save errors, complete workspace loads, output preflight.
- Frozen local bid revisions and captured proposal scope.
- Project archive/restore and portable workspace backup with PDFs.
- Area/system/phase tagging and reconciled bid breakdown in Summary/Excel.
- Printable proposal with inclusions/exclusions and reference amounts.
- Local worker symbol search, optional bounded AI crop review, and proposed
  sheet metadata/calibration.

These statements describe implementation, not real-estimator acceptance.

## Remaining product backlog

| Reference | Capability | Current boundary / next evidence |
| --- | --- | --- |
| B-301 | Priced alternates, allowances, scenarios | Current scope amounts are reference-only; establish inclusion, credits, tax and markup policy first |
| B-302 | Breakdown by system/area/phase | Implemented; verify expected grouping and reconciliation on the reference job |
| B-303 | Supplier quote leveling / price versions | Basic direct-cost quotes exist; comparison and price provenance remain open |
| B-304 | Proposal and scope letter | Basic guarded print output exists; templates and richer issuance workflow are follow-on |
| B-305 | Change orders | No contract/change-order accounting workflow |
| S-101/S-102 | Specification reader and scope-gap review | Future proposals tied to cited evidence; no autonomous bid changes |
| S-103 | Addenda, sheet revisions and comparison | Preserve original drawings/takeoff; changed regions require review |
| S-104 | RFI drafting | Future drafting workflow; sending requires user instruction |
| T-201/T-202 | Legend-to-layer and whole-set count | Per-symbol local search exists; measure coverage and review burden before scaling |
| T-203/T-204 | Circuit derivation and detail links | Domain rules and reference cases needed |
| O-401 | Actuals-to-labor feedback | Future reviewed suggestions; never silently reprice catalog data |
| O-402 | Broader audit/revision workflow | Frozen local bids exist; native/cloud coordination and richer comparisons remain |
| O-403/O-404 | Natural-language queries / team editing | Deferred beyond personal desktop acceptance |

## Follow-on infrastructure

Cloud replication with idempotent receipts, tombstones, conflicts, PDF backups,
and off-device recovery follows tested local durability. See
[14-durability-and-sync-plan.md](14-durability-and-sync-plan.md).

The [Spectrum/post-award research](12-spectrum-job-cost-plan.md) is deferred.
Its compatibility claims, cost assumptions, migration names, and domain
policies need fresh validation before an implementation is assigned. It is
not another queue to run alongside this release.

## How priorities change

Use measured discrepancies and the estimator's friction to rank the next
slice. A feature's presence in an old roadmap is not proof it is missing or
important now. Record implemented, verified, and estimator-accepted status
separately; do not mark a plan done from tests of synthetic inputs alone.
