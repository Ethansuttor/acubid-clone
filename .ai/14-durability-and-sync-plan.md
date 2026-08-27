# Never lose an edit: the journal, the vault folder, and cloud sync

**Written:** August 26, 2026
**Status:** browser milestone N-1 is partially implemented. IndexedDB tables/files,
an atomic mutation outbox, persistent-storage controls, and an optional recovery
folder mirror are live. Cloud sync, hash-chain verification, restore UX, and the
desktop vault remain planned.
**The requirement, in the owner's words:** *"it should be in the cloud and
more than that it should never lose information. everything should be saved
immediately… saving to the cloud and then saving to some special kind of
folder if it cannot save to the cloud."*

Related: [`13-windows-desktop-plan.md`](13-windows-desktop-plan.md) (the
desktop shell is what makes the folder fully trustworthy),
[`12-spectrum-job-cost-plan.md`](12-spectrum-job-cost-plan.md) (this plan
**satisfies D-S4**, the cloud prerequisite for the post-award cost ledger).

---

## Verdict

**Yes — this can be built the way you're thinking, with one amendment to the
order of the two writes.** Both destinations you named are correct: the
cloud, and a special folder. The amendment: write the folder/local journal
**first** — it takes single-digit milliseconds and cannot fail because of the
network — and push to the cloud **immediately after**, typically within a
second. Same two destinations, same immediacy, identical user experience.
The flip is what upgrades "should never lose information" from an intention
into a property you can prove.

## Why local-first-then-cloud beats cloud-first-with-fallback

Three concrete failure cases of the cloud-first ordering:

1. **The crash window.** A cloud write takes anywhere from 100 ms to a 30 s
   timeout, and the folder fallback only triggers *after* the failure is
   detected. A power cut, crash, or force-close inside that window — with
   the fallback still pending — means the edit existed only in RAM and is
   gone. A local append is a few milliseconds and survives everything short
   of the disk itself dying.
2. **The unexercised path.** A folder used *only when the cloud is down* is
   recovery code that runs a handful of times a year — precisely the code
   most likely to be broken the day it is finally needed. Writing the folder
   on **every** save means the recovery path is exercised thousands of times
   a day. (This is the same philosophy as the AI review queue: a safeguard
   nobody exercises isn't one.)
3. **Ambiguous failure.** A cloud request can fail *after* the server
   durably applied it — the acknowledgment got lost, not the write.
   Cloud-first must then choose between retrying (risking a double-post) and
   not retrying (risking loss). A local journal with idempotency keys makes
   retry always safe: the server ignores an operation it has already seen.

The save indicator can still honestly say "saved" within milliseconds and
"in cloud" a moment later. Nothing about the experience changes; only the
guarantee does.

---

## Design: a write-ahead journal behind the existing write queue

The store already serializes every mutation through one FIFO `writeQueue`
(invariant 10) — which is exactly where a journal wants to live. No
component, no pure lib, and no store *caller* changes.

**Op record:**

```
{ seq, opId (uuid), ts, table, kind: insert|update|delete,
  rowId, payload, prevChecksum, checksum }
```

The checksums form a hash chain, so truncation or corruption of the journal
is *detectable*, never silent.

**Pipeline, per mutation:**

1. **Append the op to the journal** — durable local write. Only now does
   `saveState` become `"saved"`. This is the only step whose failure is the
   sticky error (invariant 10 unchanged in spirit, upgraded in substance).
2. **Apply to the local database** (SQLite in desktop mode, IndexedDB in
   browser mode).
3. **Syncer pushes ops, in order, to Supabase.** Server acknowledgment marks
   the op *replicated*. The UI shows `synced`, or `pending (N)` while the
   cloud is behind or unreachable — with retry and backoff.
4. **Compaction**, periodically: write a full snapshot, then truncate only
   the *replicated* prefix of the journal. The unreplicated tail is never
   touched.

Large binaries never enter the journal: PDFs are content-addressed files
(`plans/<sha256>.pdf`) referenced by hash from ordinary row data.

---

## The special folder (desktop mode — the real version)

A user-visible, user-chosen folder of plain files. Proposed layout:

```
Voltline Vault/
  voltline.db                     — SQLite working database
  journal/current.jsonl           — append-only op log, hash-chained
  journal/sealed/…                — closed segments awaiting compaction
  snapshots/2026-08-26T14-30/     — full, human-readable project exports
  plans/<sha256>.pdf              — content-addressed drawings
  MANIFEST.json                   — checksums for everything above
```

Rules:

- **Atomic writes everywhere:** write to a temp file, then rename. Journal
  appends are fsynced (measure the cost; batch appends if needed — but
  durability wins ties, per the one rule that outranks everything).
- **Rotation, GFS-style:** hourly snapshots kept ~48 h, dailies kept ~90
  days, weeklies kept indefinitely — at these data sizes, "forever" is
  megabytes.
- **Bid snapshots are special:** at creation, each `BidSnapshot` is *also*
  exported as a standalone JSON file in the vault, and those are **never
  rotated away**. An issued bid must be reproducible years later.
- **Never delete last-known-good.** Compaction writes the new snapshot and
  verifies it before any old file is removed.
- **Everything human-readable.** JSON, real PDFs, a manifest. If the app
  vanished tomorrow, the data would still be legible in Notepad. The vault
  outlives the software — that is the point of a vault.

## Browser mode (the honest approximation, until plan 13 ships)

- Journal and tables now use **IndexedDB** (localStorage stays only as the
  legacy read path — it is too small and synchronous for a journal).
- The dashboard now offers `navigator.storage.persist()` as a user-triggered
  protection action.
- Implemented foundation: the File System Access API can grant the web app a real vault
  directory ("choose your backup folder") — Chromium-only, and the
  permission can lapse and need re-granting. Offer it; do not rely on it.
- Stated plainly: a browser can still lose IndexedDB to a profile wipe or
  eviction. Browser mode *narrows* the loss window; the desktop shell
  ([`13-windows-desktop-plan.md`](13-windows-desktop-plan.md)) is what
  closes it. "Never" is a desktop word.

---

## The cloud side

- The repository contains the cloud migrations, but their live-project status
  must be verified before rollout. Future sync is **idempotent per-row upserts** carrying the
  `opId`; an `op_log` table records applied opIds so a retried push is a
  no-op. Server timestamps are authoritative.
- **Pull-on-load:** fetch the project's rows, reconcile with local by row
  lineage. The fail-closed rules (invariant 9) apply unchanged — a partial
  pull never renders.
- **Conflict policy** (one user, possibly two machines): when histories
  don't overlap, last-writer-wins per row. When both sides changed the
  *same row* since the common ancestor, **surface a conflict banner and keep
  both versions** — sync inherits invariant 6's culture: reject/surface
  rather than guess. Money rows are never silently merged.
- No realtime channel needed for a single user; pull on load plus periodic
  refresh is enough. A future multi-estimator mode adds realtime *on top of*
  the journal without changing it.
- **Dev-environment note:** Supabase egress is blocked in the dev
  environment ([`08-environment.md`](08-environment.md)). All sync tests run
  against the Supabase CLI local stack or a contract mock; the live-cloud
  smoke test is a documented manual step from the owner's machine.

## The save indicator, retold truthfully

| State | Meaning |
|---|---|
| `saved` | The op is durably journaled on this machine — milliseconds after every edit |
| `synced` | The cloud has every op |
| `pending (N)` | The cloud is N ops behind — a **status**, not an error; retrying with backoff |
| `error` | A **local** journal write failed — sticky, the real alarm (invariant 10) |

Preflight gains one warning: issuing/exporting a bid while unsynced ops
exist. Informational only — local durability has already been achieved.

## Restore, and showing the receipts

- **Startup integrity pass:** verify the hash chain and MANIFEST, replay any
  unreplicated ops, and *report* what was recovered — never recover
  silently.
- **Open any snapshot as a read-only copy**, by date or by bid revision.
- **A "Data safety" panel:** last local write, last cloud sync, last
  snapshot, vault location, ops pending, and a verify-now button. For a tool
  whose product is trust, the receipts are a feature.

---

## Milestones

Planning estimates, not commitments. N-3 depends on plan 13's D-2.

| # | Work | Est. |
|---|---|---|
| N-1 | IndexedDB journal behind `writeQueue`; `persist()`; new save states | 3–5 d |
| N-2 | Supabase push/pull, idempotency, conflict surfacing; local-stack tests | 5–8 d |
| N-3 | Desktop vault: folder layout, fsync, rotation, MANIFEST | 4–6 d |
| N-4 | Integrity pass, snapshot restore UX, Data-safety panel | 3–4 d |
| N-5 | **Crash-recovery test suite:** kill-during-write, torn-append simulation, chain-corruption detection, double-push retry | 2–4 d |

N-5 is a deliverable in its own right: the tests *are* the durability claim.
Completing N-2 satisfies plan 12's **D-S4**, unblocking the post-award cost
ledger (SP-5).

## Failure modes

| # | Failure | Mitigation |
|---|---|---|
| 1 | Double-push after a crash mid-sync | Idempotent opIds + server `op_log`; retry is always safe |
| 2 | Torn/partial journal append | Hash chain detects it; truncate to last valid entry; the lost tail is **reported**, never silently dropped |
| 3 | Clock skew between devices | Server timestamps authoritative; `seq` is per-device |
| 4 | Local and cloud schemas drift | Lockstep migration rule + parity tests (see `schema-migration` in [`15-proposed-skills.md`](15-proposed-skills.md)) |
| 5 | Vault placed inside OneDrive/Dropbox | Detect and warn: sync tools interfere with atomic renames; recommend a plain folder (their backup still helps at rest) |
| 6 | Browser quota exhaustion | `persist()` + size telemetry + a warning at ~80% |
| 7 | Conflicting edits silently merged | Invariant 22 below: surfaced, both versions kept |

## Invariants to add when built (not before)

19. **An edit is not "saved" until its op is durably journaled.** Cloud
    state is a status; the journal is the durability claim.
20. **Journal ops are never reordered, edited, or truncated while
    unreplicated.**
21. **Every retry is idempotent end-to-end** (opId, everywhere).
22. **Concurrent edits to the same row are surfaced, never auto-merged.**
23. **Bid-snapshot vault exports are never rotated away.**
