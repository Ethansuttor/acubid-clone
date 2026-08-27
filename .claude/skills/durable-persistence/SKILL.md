---
name: durable-persistence
description: Change how Voltline saves, loads, syncs, or recovers data — the workspace write queue, save-state indicator, src/lib/localdb.ts, src/lib/recovery-folder.ts, the mutation outbox, cloud sync, or the desktop SQLite backend. Covers the ordering rules that make "never lose an edit" provable, idempotent retries, fail-closed loading, and the crash-recovery tests a persistence change is not done without.
---

# Touching persistence

The owner's requirement is literal: *"it should never lose information."*
That is a property, not an intention — and it survives only if every change
here keeps the ordering rules below. This is also the code most likely to be
"simplified" into a data-loss bug, because reordering two `await`s looks
harmless and isn't.

Read `.ai/14-durability-and-sync-plan.md` for the full design. This skill is
the part you must not get wrong while editing.

## 1. What exists today

Not the plan — the code:

| Piece | File | What it does |
|---|---|---|
| Write queue | `src/store/workspace.ts` | One FIFO `writeQueue`; every mutation goes through it |
| Save state | `src/store/workspace.ts` | `saveState` / `pendingWrites` / `failedWrites` / `saveError` |
| Primary store | `src/lib/localdb.ts` | IndexedDB, narrow supabase-js subset; each mutation committed **atomically with an append-only outbox entry** |
| Recovery mirror | `src/lib/recovery-folder.ts` | Optional user-chosen folder: append-only mutation journal + current JSON snapshot, via File System Access API |

**Not yet built:** cloud sync (the outbox's `synced_at` is the seam waiting
for it), hash-chain verification, restore UX, and the desktop vault. Do not
describe those as working.

## 2. The ordering rule

Local durability first, everything else after.

```
mutation
  1. commit to IndexedDB + append the outbox entry   <- ATOMIC, one transaction
  2. only now may saveState become "saved"
  3. mirror to the recovery folder                   <- reported separately
  4. (future) push to cloud; mark synced_at
```

Why this order, and not cloud-first-with-fallback:

- A cloud write can take 30 s to fail. A crash inside that window loses an
  edit that only ever existed in RAM. A local append is milliseconds.
- A folder used *only when the cloud is down* is recovery code that runs
  twice a year — it will be broken the day it is needed. Writing it on every
  save exercises it thousands of times a day. (Same reasoning as the AI
  review queue: a safeguard nobody exercises isn't one.)
- A failed cloud request may have *succeeded server-side* with the ack lost.
  Retrying is only safe because the outbox carries an id the server can
  ignore on replay.

**Never let step 1 be split.** The row and its outbox entry commit in one
IndexedDB transaction, or a crash between them leaves a mutation with no
journal record — the exact hole the journal exists to close.

## 3. Save state means something specific

| State | Meaning |
|---|---|
| `saved` | Durably on this device. Not "the network said probably." |
| `saving` | `pendingWrites > 0` |
| `error` | A **local** write failed — the real alarm |

**Invariant 10, non-negotiable:** `saveState` cannot revert to `"saved"`
while `failedWrites > 0`. Later successful edits must not mask an earlier
loss. If you add a new state (`pending sync`, `mirroring`), it is a *status*
alongside these — never a substitute for `error`, and never a reason to relax
the sticky rule.

Folder mirroring is reported **separately** from normal saves, deliberately:
browser folder permission can lapse, and a lapsed mirror must not read as a
failed save (nor a healthy mirror as a successful one).

## 4. Loading fails closed

`load(projectId)` runs every entity query in parallel and, if **any** fails
or the project is missing, zeroes all collections and sets `loadError`
(invariant 9). It never falls back to partial arrays.

The reason is bug #11: `loadTable()` used to catch a JSON parse failure and
return `[]`, so a damaged items or takeoffs table looked like a valid,
cheaper estimate. Table parsing now **throws** on invalid or non-array JSON.

If you add an entity, add it to the fail-closed load. A new collection that
quietly defaults to `[]` on error is a low bid waiting to happen.

## 5. Idempotency, everywhere

Every retryable operation carries a stable id so replay is a no-op:

- Outbox entries have `id` + `created_at` + `synced_at`.
- Future cloud pushes upsert by row id and record applied ids server-side.
- Imports must be idempotent on `(source, reference)` — double-posting a
  batch is the classic failure of every system of this shape.

Ordering is part of the contract: outbox entries are **never reordered,
edited, or truncated while unsynced.** Compaction may only drop an already-
replicated prefix.

## 6. Conflicts are surfaced, never merged

When two devices changed the same row since their common ancestor, show a
conflict and keep both versions. Last-writer-wins is acceptable only for
non-overlapping histories. **Money rows are never silently merged** — this
inherits invariant 6's culture: reject and surface rather than guess.

## 7. Atomic file writes

In any folder-backed store: write to a temp name, then rename. Never
truncate-in-place, and **never delete last-known-good** before the
replacement is written and verified. A `BidSnapshot` exported to the recovery
folder is never rotated away — an issued bid must be reproducible years
later.

## 8. "Done" means the crash tests pass

A persistence change is not finished when the happy path works. It needs:

- **Unit tests** against the real client (`tests/localdb.test.ts`), including
  corrupt-storage and cascade cases — those exist because of bug #11 and #12.
- **A crash-recovery case**: kill between the row write and the outbox
  append, a torn/partial journal entry, a replayed mutation. Assert that a
  lost tail is *reported*, never silently dropped.
- **An E2E that reloads**: `e2e/durable-scope.spec.ts` and
  `e2e/local-access.spec.ts` are the pattern — mutate, wait for
  `pendingWrites === 0` via `waitSaved`, reload, assert it survived.

```sh
npm test
npm run typecheck
npm run lint
npm run test:e2e -- e2e/durable-scope.spec.ts e2e/local-access.spec.ts
```

## Before you report

Name what is durable and what is merely queued. The honest sentence today is
that data is durable **on this device**, mirrored to a folder when the user
has granted one, and **not yet in any cloud**. A browser can still lose
IndexedDB to a profile wipe — browser mode narrows the loss window; the
desktop shell is what closes it. "Never" is a desktop word.
