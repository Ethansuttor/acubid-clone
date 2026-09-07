---
name: durable-persistence
description: Change Voltline save/load, local transactions, storage adapters, backup, migration, restore, or explicitly assigned cloud sync. Preserve atomic acknowledgement and verify actual failure boundaries.
---

# Persistence and recovery

Read [track S](../../../.ai/14-durability-and-sync-plan.md) and
[parallel ownership](../../../.ai/18-parallel-execution-plan.md).
The current store is IndexedDB with an atomic mutation journal. Portable
backup/restore exists; folder-mirror restore, SQLite, and cloud sync remain
planned in the reviewed baseline.

## Acknowledgement

A mutation and its journal/outbox entry commit in one local transaction.
Only after success may the UI say saved. Optimistic display is permitted,
but a queue entry or independent log append is not a committed save.

Keep unresolved local failures sticky. A later successful edit cannot erase
an earlier loss. Recovery from the error must be explicit and verified.
Folder-backup and cloud status are separate from primary-save status.

Do not split SQLite row and outbox writes across transactions or add a second
authoritative JSON journal. Files and the database are distinct durability
boundaries: publish/verify immutable plan bytes before committing references,
and tolerate orphan staging files rather than missing committed drawings.

## Whole-workspace consistency

Loads fail closed when any required entity fails. Export captures a consistent
record/PDF set under exclusive maintenance access. Native maintenance must
coordinate with the native writer; browser Web Locks alone are insufficient.

The backend contract includes direct assembly replacement and backup/restore
helpers, not only the Supabase-shaped factory. Test the actual IndexedDB
backend, not only localStorage fallback, before claiming browser durability.

Preserve IDs, geometry, calibration, status, prices, and old snapshot payloads
through migration. Restore stages/validates before publication and preserves
an occupied destination. Keep .voltline.json import compatibility.

## Backup and deletion

Use consistent SQLite backups; copying only a live .db file can miss WAL data.
Publish a complete validated record/PDF manifest before retiring older backups.
Retain files referenced by historical snapshots and retained backup manifests,
not only live documents. Do not delete the last known good recovery copy.

Treat checksums as corruption checks, not encryption or independent backup.
A hash chain needs an independent expected head to detect a missing valid
suffix. No desktop wrapper guarantees survival of disk loss or every power cut.

## Future sync

Only when assigned: stable operation IDs, ordered per-device history, explicit
base versions/tombstones, atomic server receipts, safe retry, separate PDF
replication, and surfaced same-row conflicts. Upsert is not a complete sync
protocol. Do not compact data on the assumption that unsent operations have
replicated. Do not configure live cloud services merely because this skill
mentions them.

## Verify and report

Test real-backend contracts, transaction rollback, failed compound edits,
save/reload, force-kill before/after acknowledgement, damaged backups,
interrupted migration, missing PDFs, and occupied-target preservation.
Use disposable profiles/directories. Exact required cases depend on the
failure boundaries changed; do not invent irrelevant file-journal tests.

Report what is committed, queued, backed up, or synchronized; name the runtime,
source tree, failure checkpoints, and remaining unknowns. A process-kill test
is not proof of every physical power-loss scenario.
