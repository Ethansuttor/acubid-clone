# Storage and recovery implementation packet — track S

Updated September 7, 2026. Status: browser foundation implemented; desktop and
cloud stages planned. Coordination: [parallel plan](18-parallel-execution-plan.md).

## Goal and current facts

Acknowledge edits only after a local transaction commits. Preserve acknowledged
data across tested process crashes and retain a verified, independent recovery
copy. No storage design can promise survival of every hardware failure,
malicious deletion, or loss of all backups.

Today:
- IndexedDB stores all tables as one state value and PDFs separately.
- Each mutation and its journal record commit atomically.
- The whole workspace's tables are rewritten for each table mutation.
- The store serializes writes and keeps unresolved save errors sticky.
- Web Locks serialize browser database operations and prevent simultaneous
  estimate editors in the same origin/profile.
- Portable .voltline.json backup/restore exists, including checksums and PDFs.
  It is capped at 256 MB total and 128 MB input PDFs; restore needs an empty
  destination. The recovery-folder mirror is a different format.
- A folder mirror exists; a dedicated folder-mirror restore tool does not.
- Cloud push/pull, replay receipts, conflict handling, and desktop SQLite do
  not exist in the reviewed baseline. The current outbox is not a complete
  sync implementation.

## Storage contract

C1 defines the exact API before D/S work diverges. Cover the current query
subset and storage operations, plus replaceAssemblyItems, exportWorkspace,
restoreEmptyWorkspace, exclusive editing/maintenance, and health status.

Do not switch only supabase(). workspace.ts calls replaceLocalAssemblyItems
directly; DataProtectionCard calls browser export/restore/locking functions.
Those paths must use the selected backend too. Browser folder controls need
a native implementation or an explicit unsupported capability in desktop mode.

Preserve error and transaction behavior, not the fiction of complete Supabase
SDK parity. Inventory actual columns/defaults in types, constructors, imports,
and all migration files. No SQL migration is applied to a live cloud here.

## S1 — Contract and performance baseline

Dependencies: C1. Own: tests/storage-contract/**, scripts/storage/**.

1. Characterize queries: lazy execution/await, insert/update/upsert/delete,
   multiple filters, in, ordering, projections actually used, exact-one
   single(), returned errors, cascades, and file API shapes.
2. Characterize compound operations: assembly replacement failure preserves
   the original list; snapshot revision allocation; backup consistency;
   occupied restore refusal; archive versus permanent deletion.
3. Run browser cases against real IndexedDB in a browser. Existing tests that
   use localStorage fallback cannot establish IndexedDB transaction behavior.
4. Produce an adapter-independent contract suite. Intentional stricter
   validation is acceptable when documented and tested in both active paths.
5. Measure 1k/10k/50k takeoff datasets, multiple projects, and frozen snapshots.
   Separate edit-to-commit latency, reload, export/restore, process memory,
   disk growth, and calculation time. The existing npm run bench covers only
   in-memory estimating functions. Avoid timing assertions in normal CI.

Acceptance: measured baseline with environment and dataset sizes; behavior
fixtures runnable against browser and a supplied future adapter. No production
data in tests. Cases should assert outcomes, not mirror SQL implementation.

## S2 — SQLite and plan files

Dependencies: S1 and C1. Own: desktop/storage/**.

- Use a local app-managed data directory outside install/repo paths. Keep the
  active database on a local filesystem; a user-chosen backup destination is
  distinct from the live database. Do not assume a shared/network/sync folder
  provides SQLite's required locking semantics.
- Choose a driver compatible with the bundled runtime; pin it through the
  coordinator. Enable and verify foreign keys. Use versioned SQLite migrations
  with explicit JSON/boolean/date/number mappings and domain validation.
  Translate the complete logical schema; do not execute Postgres SQL as-is.
- Make numeric representation preserve the existing JS calculation semantics.
  This task does not change bid formulas or rounding policies.
- Implement row-level writes and required indexes instead of rewriting the
  entire workspace. Commit mutations and outbox records in the SAME SQLite
  transaction. Mark saved only after commit succeeds.
- Do not introduce an independent JSON journal as a second authoritative
  write path. It would create a new failure window between log and database.
  Optional readable journals/backups are secondary exports.
- Store immutable PDF bytes by content hash under managed plans storage.
  Preserve existing logical storage_path values through a mapping to hashes;
  do not silently rewrite historical snapshot references.
- Stage/verify/publish plan files before committing references. A crash may
  leave an unreferenced staged file; it must not leave a committed document
  pointing at missing bytes. File and database writes are not one transaction.
- Retain files referenced by live documents, frozen snapshots, or retained
  backup manifests. Garbage collection requires a reference inventory and
  grace period; do not delete by filename guess or a single live-document query.
- Centralize editing/maintenance exclusion across desktop processes, and
  allocate revision numbers transactionally with a uniqueness constraint.

Acceptance: contract suite green, atomic failure tests, references preserved,
real packaged-runtime SQLite operation, and benchmark comparison to S1.
No corruption or dropped data may be traded for lower latency.

## S3 — Migration, backups, and restore

Dependencies: S2; work may start with S1 fixtures.

Reuse the existing .voltline.json reader for browser migration. Do not invent
a replacement .voltproj format solely to duplicate existing functionality.
For larger workspaces, add a versioned streaming archive with a manifest,
structured records, and binary PDF entries; retain old-format import.

Required sequence:
1. Read/validate input format, schema versions, duplicate IDs, relation graph,
   PDF presence/hashes, and resource limits without mutating current storage.
2. For an archive, reject path traversal, absolute paths, duplicate entries,
   excessive decompressed sizes, invalid hashes, and unknown required versions.
   Never evaluate content from an imported file.
3. Import into a staging database/directory, with all entities and PDFs.
   Preserve IDs, pending status, geometry, calibration, prices, and snapshot
   payloads. Validate all historical PDF references, not only current documents.
4. Recompute live estimate totals and compare to export evidence; compare
   frozen snapshot contents without rewriting or repricing them.
5. Publish the verified destination under exclusive maintenance access.
   Refuse an occupied target in the first version. Do not delete or alter the
   browser source, input backup, or last good desktop database.
6. Record migration result and retained source location. Handle interruption
   before/after publication deterministically and make retry safe.

Create automatic consistent backups of records AND their matching PDF set.
For live SQLite use the driver's online backup mechanism or another verified
consistent snapshot method; copying only a live .db file can omit committed
WAL content. Pin file references while copying, verify the complete manifest,
then publish the backup. [SQLite backup documentation](https://www.sqlite.org/backup.html)

Default proposal: a backup after a changed session, before schema upgrades,
and periodically during active work; keep a bounded configurable retention
policy. Measure size before choosing retention counts. Retain issued revision
evidence and its referenced files; do not assume indefinite full snapshots
cost only megabytes. A same-disk backup protects against some mistakes, not
device loss. Report last successful backup and replication separately.

Implement a folder-mirror importer only after documenting its actual baseline,
latest.json, per-mutation, and filename mapping formats. Do not feed mirror
JSON to the portable importer or assume the current journal is replay-complete.

## S4 — Failure and upgrade verification

Dependencies: S2/S3 and packaged desktop integration.

Use disposable data directories. Inject failure at file staging, reference
commit, transaction commit, backup publication, and migration publication.
Kill the process before and after an acknowledged save.

Acceptance matrix:
- Committed edits survive forced termination and reopen.
- An interrupted transaction is wholly applied or wholly absent.
- An unacknowledged edit may be absent; it must never have been labeled saved.
- Disk-full/read-only/permission errors are visible and sticky for local saves.
- A backup failure does not erase the primary data or claim a backup succeeded.
- Damaged/missing PDFs and unsupported schemas fail visibly.
- Repeated restore/migration attempts do not duplicate records or replace an
  occupied workspace.
- An upgrade failure preserves the last good database and a recovery route.
- Browser -> desktop -> backup -> fresh desktop restores identical logical
  records and binary hashes; old backup versions remain readable.

Process-kill tests are not proof of survival under every physical power loss.
Record SQLite journal/synchronous settings, platform, driver, and failure model.
[SQLite WAL documentation](https://www.sqlite.org/wal.html)

## Cloud follow-on, after local release gates

The historical desire for cloud recovery remains. Implement it as a separate
assigned stage after local recovery works; do not make desktop delivery depend
on it. Provider selection, account configuration, private-data upload, costs,
and live migrations need existing task authorization.

Before coding sync specify:
- monotonic per-device sequence, stable operation IDs, base revision/version,
  tombstones, and schema compatibility;
- atomic server application AND receipt recording so lost acknowledgements
  can be retried safely (upsert alone is not sufficient);
- preserved delete/update ordering and compound-operation boundaries;
- PDF replication and retention separately from row-data backup;
- explicit same-row conflicts preserving both versions;
- local saved, backup current, and cloud synchronized as separate statuses.

A hash chain can detect some corruption or breaks relative to a trusted
checkpoint. It cannot detect deletion of a valid suffix without an independent
expected head/sequence; it provides neither replication nor authentication.
Do not promise "never lose information" on that basis.

## Handoff

Report contract coverage, measured save latency, native-runtime validation,
migration format compatibility, crash checkpoints tested, retention/file
reference handling, and remaining unverified physical/off-device risks.
Use the [master report template](18-parallel-execution-plan.md).
