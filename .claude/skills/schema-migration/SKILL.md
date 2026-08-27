---
name: schema-migration
description: Add or change a table, column, or row shape in Voltline — writing a file in supabase/migrations/, touching src/lib/localdb.ts, changing an interface in src/lib/types.ts, or adding a field the estimate reads. Covers the lockstep rule across every storage backend, defaults and read-time guards for rows written before the column existed, and why a schema mistake here surfaces as a wrong bid rather than an error.
---

# Changing the schema

A schema change in this app has a nasty property: when it goes wrong, nothing
throws. An old row missing a new column reads as `undefined`, `undefined`
flows into the bid math, and the estimator sees a number. That is the failure
mode this skill exists to prevent — it has already happened once.

## 1. Every backend moves in the same commit

The same logical schema is implemented more than once:

| Backend | Where | Status |
|---|---|---|
| Postgres / Supabase | `supabase/migrations/*.sql` | the definition of record |
| Browser IndexedDB | `src/lib/localdb.ts` | what the app actually runs on today (`LOCAL_ONLY = true`) |
| TypeScript row shapes | `src/lib/types.ts` | what every component and pure lib compiles against |
| Desktop SQLite | `desktop/db/schema.ts` | planned — see `.ai/16-desktop-task-queue.md` GD-3 |

**Never land one without the others.** A column that exists in SQL and not in
`types.ts` is invisible to the app; a field in `types.ts` with no migration
is `undefined` on every real row. Both read as "working" in dev.

`localdb.ts` implements the *narrow supabase-js subset* the app uses, so it
usually needs no change for a plain column add — but confirm, don't assume,
and re-run its tests.

## 2. Old rows exist forever

This is the lesson of bug #8 in `.ai/06-bug-history.md`: a project row written
before the bid-math columns existed yielded `undefined / 100 = NaN`. The UI
rendered `$NaN`; the Excel export used `?? 0` and printed a plausible figure.
**The two surfaces disagreed and neither was right.**

So, for every new column:

1. **A `not null default` in the migration.** Never a bare nullable column
   for anything the math reads.
2. **A read-time guard at the boundary.** `summarize()` coerces every
   non-finite input to `0` via its `n()` helper; `excel.ts` uses
   `project.labor_burden_pct ?? 0`. Follow both patterns — the coercion keeps
   rendering stable, and preflight independently inspects the *raw* input so
   that sanitisation cannot make an invalid bid look ready.
3. **A default in every construction site.** Grep for the table's other
   columns to find them all:

```sh
grep -rn "overhead_pct:" src tests e2e scripts --include=*.ts --include=*.tsx
```

That grep is how the five bid-math gap columns found all nine literal
construction sites across six files — project creation in `src/app/page.tsx`,
plus eight in test fixtures and specs. Miss one and `npm run typecheck`
catches it, which is exactly why you run it before claiming the change is
complete.

## 3. Naming: pick the convention already in the directory

`supabase/migrations/` currently holds **both** conventions:

```
0001_schema.sql
0002_bid_math.sql
0003_bid_math_gaps.sql
20260826142738_durable_bid_structure.sql
```

Sequential (`000N_`) is this project's original convention; the timestamped
form is what `supabase migration new` generates. Mixed ordering is a real
hazard — lexical sort still happens to be correct here because `0…` sorts
before `2…`, but that is luck, not design. **Match the newest file in the
directory when adding one**, and if you are cleaning up, do it as its own
commit that touches nothing else.

Note also that the newest migration adds **explicit Data API grants**,
because new public-schema tables are no longer exposed automatically on
current Supabase projects. A new table needs that grant or it is invisible to
the client with no error.

## 4. RLS on every new table

Copy the shape from `0002_bid_math.sql` / the newest migration:

```sql
alter table public.<t> enable row level security;
create policy "own <t>" on public.<t> for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
```

Every project-owned table carries `user_id` and `project_id`, and cascades
from its parent. **Check the cascade deliberately**: bug #12 was a project
delete that left `direct_costs`, `bid_snapshots`, and the plan PDF behind.
Deleting a project must empty every project-owned table and its files.

## 5. Cascades change the estimate

`on delete cascade` is not just cleanup. Deleting an item takes its
`assembly_items` rows with it, which silently shortens every assembly that
used it and under-extends every takeoff on those assemblies — undetectable
afterwards, which is why `itemUsage()` warns *before* the delete. If your new
table participates in the estimate, ask what a cascade does to a bid, not
just to the row count.

## 6. Snapshots are versioned, never migrated

`BidSnapshotPayload` is a discriminated union on `schema_version`
(`BidSnapshotPayloadV1 | BidSnapshotPayloadV2`). An issued bid must reproduce
exactly, years later, so:

- **Add a new version; never rewrite an old payload.**
- Readers switch on `schema_version` and handle every version that has ever
  been written.
- New optional data (like `proposal_entries` in V2) is the reason to bump.

## 7. Verify

```sh
npm run typecheck    # the honest one — finds every stale construction site
npm test             # localdb tests + the hand-calculated fixture
npm run lint
```

Then check the live cloud project state before claiming a migration is
applied — the repository containing a migration file does not mean the
running database has it. Record what was actually applied where.

## Before you report

Say which backends you changed and which you did not. "Added the column" is
not a complete sentence in this codebase — it is four backends, a default, a
read guard, and a preflight check, or it is a latent wrong number.
