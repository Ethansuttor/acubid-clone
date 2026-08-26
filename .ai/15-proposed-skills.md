# Proposed skills — descriptions only, awaiting owner approval

**Written:** August 26, 2026
**Status:** nothing here exists. These are descriptions of skills that
*could* be written into `.claude/skills/`, for the owner to approve or
reject individually. The existing three (`estimating-math`, `ai-feature`,
`voltline-verify`) stay as they are; nothing below replaces them.

A skill earns its place here the same way an invariant does: it encodes
rules whose violation produces a wrong number or lost data that *looks*
fine. Each entry says what would trigger it, what rules it would encode,
and the specific failure it exists to prevent.

---

## 1. `job-cost-math`

- **Triggers when:** any change produces a post-award dollar, hour, or
  percentage — the planned `jobcost.ts`, `billing.ts`, `wip.ts`,
  `awards.ts`, change orders, pay applications, WIP rows
  ([`12-spectrum-job-cost-plan.md`](12-spectrum-job-cost-plan.md)).
- **Encodes:**
  - Hand-calculate before writing the test (the `estimating-math` rule,
    extended past the award line — twice in this repo's history the test
    was wrong and the app was right).
  - The §5 formula reference: percent-complete by four methods with the
    method *recorded*, cost-to-complete vs. open commitments, the G702/G703
    line arithmetic, retainage true-up to the cent at closeout.
  - Over-billing is a **liability**, never revenue.
  - Approved change orders and issued pay applications are immutable;
    corrections are reversing documents.
  - The `fixture-job.ts` hand-calculated fixture is mandatory for any new
    formula.
- **Prevents:** the plausible-but-wrong job cost report — the post-award
  twin of the quietly short bid.
- **Worth writing when:** the day SP-1 starts. Before that it has nothing
  to guard.

## 2. `durable-persistence`

- **Triggers when:** touching the write queue, journal, syncer, save
  indicator, `localdb.ts`, the desktop SQLite engine, or the vault folder
  ([`14-durability-and-sync-plan.md`](14-durability-and-sync-plan.md),
  [`13-windows-desktop-plan.md`](13-windows-desktop-plan.md) D-2).
- **Encodes:**
  - The legal `saveState` transitions, and that "saved" means *journaled*,
    not "the network said probably."
  - Append-before-visible-save ordering; ops never reordered; the
    unreplicated tail never truncated.
  - Idempotency keys end-to-end; the atomic-write pattern
    (temp file → fsync → rename); never delete last-known-good.
  - Conflicts are surfaced, never auto-merged.
  - **"Done" requires the crash-recovery suite green** — kill-during-write,
    torn-append, chain-corruption — not just unit tests.
- **Prevents:** the exact silent data loss this whole effort exists to
  eliminate, reintroduced later by a well-meaning refactor that reorders
  two awaits.
- **Worth writing when:** N-1 starts. This is the skill I'd rank first —
  persistence code is where a subtle regression costs a project file, and
  it is the code an AI is most likely to "simplify" incorrectly.

## 3. `desktop-shell`

- **Triggers when:** touching the Electron main process, preload/IPC
  bridge, packaging, the updater, or API-key storage
  ([`13-windows-desktop-plan.md`](13-windows-desktop-plan.md)).
- **Encodes:**
  - The three security flags (`contextIsolation` on, `nodeIntegration`
    off, `sandbox` on) and the test that asserts them.
  - IPC is an enumerated, typed command list — no generic SQL/eval channel
    from the renderer, ever.
  - The key lives in main via `safeStorage`/DPAPI and never crosses to the
    renderer (invariant 7, extended).
  - Updates apply on quit only, never while unsynced ops exist.
  - No storage backend ships without passing the shared parity suite.
  - The release checklist: build, sign (or documented-skip), install on a
    clean VM, update from previous version, smoke the `_electron` suite.
- **Prevents:** a renderer compromise becoming disk-and-key access; an
  auto-update eating bid day; storage backends drifting apart.
- **Worth writing when:** D-2 starts.

## 4. `schema-migration`

- **Triggers when:** adding or altering any table or column — touching
  `supabase/migrations/`, `localdb.ts`, the desktop SQLite engine, or
  `types.ts` row shapes.
- **Encodes:**
  - One numbered migration; **all backends in lockstep, in the same
    commit** (Supabase SQL, browser localdb, desktop SQLite).
  - Old rows exist forever: every new column needs a default and a
    read-time guard — the generalized lesson of the `summarize()` NaN bug,
    where a project row written before the bid-math columns existed
    rendered the whole bid as NaN.
  - Re-run the parity suite after any schema change.
  - Never rename a column or reuse one with a changed meaning; add, then
    migrate, then retire.
  - Record when a migration has been applied to the live cloud project.
- **Prevents:** three-backend drift, which would surface not as an error
  but as arithmetic — that is, as a wrong bid.
- **Worth writing when:** the moment a second storage backend exists
  (D-2), or the moment migration `0003` is written — whichever comes first.

---

## If you approve only two

**`durable-persistence` and `schema-migration`.** They guard the two new
failure classes plans 13 and 14 create the surface for: losing data and
quietly disagreeing about data. `job-cost-math` becomes necessary the day
SP-1 begins; `desktop-shell` the day the Electron work starts. Approving a
skill before its code exists costs nothing but also protects nothing — the
right time to write each one is the first day its trigger can fire.
