# Gemini Flash 7 task queue

**Updated:** August 26, 2026  
**Purpose:** small, bounded Voltline tasks suitable for a fast coding model.  
**Rule:** give Gemini one task at a time and review every diff before keeping it.

## Instructions to include with every task

> Work only inside this repository. Read `AGENTS.md`, `.ai/00-START-HERE.md`,
> `.ai/04-invariants.md`, and the files named below before editing. Preserve
> unrelated dirty-worktree changes. Use `apply_patch` for edits. Do not change
> estimate formulas, geometry, authentication, persistence behavior, database
> migrations, API authorization, or dependency versions. Run the requested
> checks and report exact results. Do not commit, push, deploy, install
> packages, or delete data.

## Already completed — do not delegate again

The former GF-01 through GF-10 batch has been reviewed and folded into the
repository: context synchronization, direct preflight coverage, revision E2E,
accessible preflight/status controls, responsive Summary/Database coverage,
local-mode wording, stable E2E helpers, the deterministic benchmark, and
catalog diagnostics. Re-running those broad prompts would mostly create churn.

## Ready to delegate

### GF-11 — Complete local database query tests

**Prompt:**

> Read `src/lib/localdb.ts` and `tests/localdb.test.ts`. Add focused unit tests
> for query operations that are currently untested: insert/upsert/update/delete,
> chained equality filters, `in`, `order` ascending/descending, `single`, and
> storage upload/download/remove. Use an in-memory Storage mock and reset it
> between tests. Do not change production code unless a test exposes a clear
> contract defect; if that occurs, stop and report it.

**Acceptance criteria:**

- Tests exercise the real local client rather than reimplementing it.
- Corrupt storage and cascade tests remain intact.
- `npm test` and `npm run typecheck` pass.

### GF-12 — Snapshot detail drawer, read-only

**Prompt:**

> Read `src/lib/types.ts`, `src/components/estimate/SummaryView.tsx`, and the
> revision E2E specs. Add a read-only details drawer or dialog opened from a bid
> revision row. Show revision/label/date, captured commercial settings, totals,
> direct costs, and captured preflight warnings. Do not add edit/delete/restore
> actions and do not recalculate snapshot values. Use existing design tokens and
> accessible dialog semantics.

**Acceptance criteria:**

- Values come only from `snapshot.payload`.
- Escape closes the dialog and focus returns to the trigger.
- Add one targeted E2E assertion; lint, typecheck, unit tests, and that E2E pass.
- A stronger model must review this diff before it is kept.

### GF-13 — Catalog-health review filters

**Prompt:**

> Read `src/lib/catalogDiagnostics.ts` and
> `src/components/estimate/DatabaseView.tsx`. Improve the existing catalog-health
> panel so an estimator can filter the displayed diagnostic rows by Errors,
> Warnings, or All. Keep the report read-only; do not repair, delete, or mutate
> catalog data. Preserve the compact product-workspace design.

**Acceptance criteria:**

- Filter controls have accessible names and selected state.
- Counts remain the full report counts while the list reflects the filter.
- Add component-independent tests only if pure logic is extracted.
- `npm run lint`, `npm run typecheck`, and `npm test` pass.

### GF-14 — Empty/loading/error copy audit

**Prompt:**

> Audit the project list, Takeoff, Estimate, Database, and Summary views for
> empty, loading, and error text. Make wording specific, brief, and actionable:
> say what happened and the next safe action. Reuse current panels/icons. Do not
> add illustrations, gradients, marketing copy, landing-page sections, new
> state, or new behavior.

**Acceptance criteria:**

- Load failures never look like successful empty data.
- Empty states name the next action available on that screen.
- No layout or business-logic changes.
- Lint and typecheck pass.

### GF-15 — Add a documentation integrity check

**Prompt:**

> Add a small Node script that checks relative Markdown links inside `.ai/*.md`
> and reports missing local targets. Add an npm script named `docs:check`.
> Use only Node built-ins; do not install a package. Ignore `http`, `https`, and
> anchor-only links. Document the command in `.ai/07-verification.md`.

**Acceptance criteria:**

- The command exits non-zero for a missing local target and zero for the current
  context pack.
- Paths with fragments are checked after removing the fragment.
- `npm run docs:check`, lint, and typecheck pass.

### GF-16 — Accessibility regression audit for icon controls

**Prompt:**

> Review icon-only buttons and status regions in `src/app/page.tsx`,
> `src/app/project/[id]/page.tsx`, and `src/components/estimate/*.tsx`. Add or
> correct accessible names, `title` text where helpful, and live-region roles
> for async status. Do not change visible layout, workflows, or calculations.

**Acceptance criteria:**

- Every icon-only button describes both action and target.
- Save, import, export, snapshot, and error messages are announced appropriately.
- Prefer roles/labels over new test IDs.
- Lint, typecheck, and all E2E tests pass.

## Delegate only with stronger-model review

- Local project backup export and restore/import with schema-version validation.
- Snapshot-to-snapshot comparison of totals and catalog inputs.
- Indexed estimate lookups with before/after benchmarks.
- Debounced text commits that preserve sticky save-error behavior.
- Project archive/restore and any project deletion changes.
- A proposal/scope-letter document generator.

## Do not delegate to a fast model without direct supervision

- Quantity, assembly extension, labor, tax, markup, margin, bond, or bid-total formulas.
- Authentication, API authorization, secrets, Supabase migrations, or RLS.
- Persistence queues, backup recovery, concurrency, offline sync, or conflict resolution.
- AI prompts/routes, PDF geometry, calibration, drawing comparison, or takeoff migration.
- Destructive cleanup or claims of compatibility with licensed Accubid data.

## Recommended order

GF-11 → GF-15 → GF-13 → GF-14 → GF-16 → GF-12.
