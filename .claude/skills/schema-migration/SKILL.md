---
name: schema-migration
description: Change Voltline's domain rows, persistence schema, or backup/snapshot versions. Preserve old-data compatibility across active backends and coordinate shared types and migrations.
---

# Schema changes

Read [current architecture](../../../.ai/03-architecture.md),
[invariants](../../../.ai/04-invariants.md), and
[track S](../../../.ai/14-durability-and-sync-plan.md).

The active implementation is browser IndexedDB. Historical Postgres migrations
and TypeScript types are schema inputs; neither alone defines all current
runtime behavior. Desktop SQLite is planned. Inspect constructors, imports,
backup validation, and all migration files as well.

## Compatibility

Update each affected active backend, domain types, construction defaults,
backup validation, and tests together. Assess historical SQL compatibility
when relevant, but do not create an unimplemented backend or apply a live
migration just to satisfy a blanket "all backends" rule.

Specify semantics for old rows. Defaults must be explicit and meaningful;
unreadable or invalid financial inputs cannot become a ready bid through
silent coercion. Include preflight checks where required and a fixture written
before the new field existed.

SQLite needs explicit compatible migrations and JSON/boolean/date/numeric
mappings. Do not run Postgres migrations verbatim. New foreign keys/cascades
must preserve whole-project cleanup and files referenced by frozen revisions.

Use a fresh ordered migration identifier. The repo already contains
0003_bid_math_gaps.sql and timestamped migrations; do not reuse old proposed
0003 filenames or rename applied migrations casually.

## Historical records

Frozen BidSnapshot payloads are versioned. Add a reader/writer version rather
than rewriting issued history. Source geometry, catalog inputs, and captured
totals must survive migration. If future rendering requires exact historical
document reproduction, preserve the rendered artifact too; a payload alone
does not guarantee byte-identical output after renderer changes.

Keep old .voltline.json imports working. Validate before writing, stage
migration, preserve the previous database and source backup, and test
interrupted/repeated migration and unsupported newer versions.

## Cloud-specific work

If explicitly assigned, inspect live project state before claiming a migration
is applied. Verify current RLS/grants and account configuration using appropriate
tools/documentation. This skill does not authorize a production migration.

## Verification

Typecheck, relevant schema/backup/contract tests, and affected UI paths.
For persistent format upgrades, include old-data and interruption/rollback
cases in the packaged runtime. Report affected backends, defaults, versions,
migration evidence, and what remains unimplemented.
