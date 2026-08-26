# Product audit and competitive roadmap

**Audit date:** August 25, 2026 (Updated August 26, 2026)  
**Scope:** failure modes, product gaps, and a practical path toward competing with Trimble Accubid Anywhere  
**Current posture:** hardened local-first electrical estimating application with verified arithmetic, fail-closed loading, durable error tracking, bid preflight gates, catalog diagnostics, and immutable snapshots.

This document preserves an evolving review of the repository. It is a planning input, not a substitute for the product invariants in [`04-invariants.md`](04-invariants.md).

## Executive assessment

Voltline's strongest work is below the interface: geometry, units, estimate extension, bid math, preflight readiness, catalog diagnostics, and AI confirmation rules are separated into pure testable functions.

The product should compete on **trust, revision handling, and scope intelligence**, not auto-count alone. Accubid already markets AI auto-count, spec-driven estimating, real-time pricing, multi-user workflows, drawing comparison, change orders, and extensive reporting. Auto-count is therefore table stakes.

## Verified baseline

Current codebase status:

- **324 unit tests across 15 test files** pass (`npm test`).
- **10 Playwright E2E spec files** cover the primary workflows, local access,
  revision persistence/blockers, and responsive Summary/Database layouts.
- **Large-scale estimating benchmark** (`npm run bench`) runs 10,000 takeoffs,
  200 layers, and 50 calibrated sheets. On the August 26 verification machine,
  the full pipeline measured 14.03 ms median and 15.56 ms p95. This is a
  measured baseline, not a hard performance guarantee.
- **Static analysis:** TypeScript (`npx tsc --noEmit`) and ESLint (`npm run lint`) complete with 0 errors and 0 warnings.
- **Local-first data client:** `LOCAL_ONLY = true` (`src/lib/local-config.ts`), `src/lib/localdb.ts` providing relational querying and binary storage in the browser without external network dependencies.
- **AI safety:** AI-generated takeoffs remain pending until an estimator explicitly confirms them.
- **Issue reporting:** Missing item links, deleted catalog entries, empty assemblies, uncalibrated sheets, and unit mismatches produce structured estimate issues instead of silently corrupting totals.

## Failure Mode Analysis and Implemented Mitigations

### 1. Partial loads can become plausible low bids

**Severity:** Critical  
**Status:** **PARTIALLY MITIGATED (Local)**  
**Relevant code:** `src/store/workspace.ts`, `src/lib/estimate.ts`

Workspace loading (`load(projectId)` in `src/store/workspace.ts`) issues 10 parallel queries across all relational tables (`projects`, `documents`, `sheets`, `layers`, `takeoffs`, `items`, `assemblies`, `assembly_items`, `direct_costs`, `bid_snapshots`). If any single query returns an error or if the project is missing, the store immediately **fails closed**: zeroes all collections and sets `loadError`. Incomplete datasets can never render or export.

### 2. Historical bids can drift after catalog edits

**Severity:** Critical  
**Status:** **MITIGATED (Local)**  
**Relevant code:** `src/store/workspace.ts`, `src/lib/preflight.ts`

Estimators can freeze bid snapshots (`createBidSnapshot(label)` in `src/store/workspace.ts`) under the next local revision number. Snapshots deep-copy project settings, database items, assemblies, direct costs, checks, and calculated totals to a new `bid_snapshots` record; later product edits do not update them. Snapshot creation is guarded by `bidPreflight()` and a single-browser concurrency lock. LocalStorage deletion, cross-tab races, and the absence of a server-side uniqueness constraint remain production risks.

### 3. Autosave can lose edits while appearing healthy

**Severity:** Critical  
**Status:** **MITIGATED (Local)**  
**Relevant code:** `src/store/workspace.ts`

Writes are serialized through a single FIFO promise queue (`writeQueue`). On any mutation failure, `failedWrites` increments and `saveError` records the verbatim error message. The `saveState` transitions to `"error"` and **cannot revert to `"saved"`** while `failedWrites > 0`.

### 4. A zero-dollar or zero-labor bid can look ready

**Severity:** Critical  
**Status:** **MITIGATED**  
**Relevant code:** `src/lib/preflight.ts`, `src/components/estimate/SummaryView.tsx`

Pure `bidPreflight()` evaluates deterministic commercial readiness checks:
- **Blockers:** unresolved/pending saves, missing estimate quantity, pending AI review, zero labor rate when labor exists, invalid calculated totals, invalid raw commercial/layer/catalog inputs, unnamed priced direct costs, empty bids, and used items with no material or labor value.
- **Warnings:** no plan sheets, material-only or labor-only used items, estimate link/unit warnings, typical multipliers spanning multiple sheets, and zero overhead/profit markups.

### 5. Catalog data quality and consistency degradation

**Severity:** High  
**Status:** **PARTIALLY MITIGATED**  
**Relevant code:** `src/lib/catalogDiagnostics.ts`, `src/components/estimate/DatabaseView.tsx`, `src/lib/preflight.ts`

Pure `diagnoseCatalog()` diagnostic function audits catalog integrity without React or I/O dependencies:
- Zero material cost items
- Zero labor unit items
- Duplicate item codes
- Duplicate assembly codes
- Empty assemblies (zero components)
- Missing/dangling component item references

The Database view now shows this report, and preflight independently blocks
invalid values on items used by the current bid. Diagnostics do not repair
data, enforce a versioned pricebook, or validate unused imported prices.

### 6. Typical-sheet multipliers can overcount

**Severity:** High  
**Status:** Monitored via Preflight Warning  
**Relevant code:** `src/lib/estimate.ts`, `src/lib/preflight.ts`

Preflight surfaces active typical multipliers as audit warnings. Future work will allow scoping typical multipliers by floor/zone rather than layer-wide.

### 7. Large plan sets will pressure the browser

**Severity:** Medium to high  
**Status:** Benchmarked  
**Relevant code:** `tests/fixtures/large-estimate-fixture.ts`, `scripts/benchmark-estimate.ts`

Deterministic seeded PRNG benchmark fixture and automated runner (`npm run bench`) stress-test the engine against 10,000 takeoff runs, 1,000 items, and 200 assemblies and report stage-by-stage timing without imposing a machine-dependent threshold in the unit suite.

### 8. Cloud Backend & AI Integration Open Items

- Multi-tenant cloud synchronization and transactional backend upload lifecycle.
- Chunked background image processing for Vercel function payload limits.
- Cloud auth session rotation and rate limiting.

---

## What to add to compete with Accubid

### Phase 1 — Trust foundation (In Progress / Partially Completed)

- [x] Immutable bid versions and revision snapshots (`BidSnapshot`, `createBidSnapshot`)
- [x] Bid preflight with hard blockers and warnings (`bidPreflight`)
- [x] Durable save error tracking (`failedWrites`, sticky error state)
- [x] Pure catalog health diagnostics (`diagnoseCatalog`)
- [x] Deterministic large-estimate benchmark fixture (`npm run bench`)
- [ ] Multi-tenant cloud sync & audit trail (who/what/when)
- [ ] Project archive, restore, and cloud backup

### Phase 2 — Real bid structure

- Systems, areas, floors, phases, cost codes, and bid packages
- Alternates, allowances, value-engineering options, and exclusions
- Scope letter and proposal generation
- Reusable inclusions/exclusions/checklists by customer or project type
- Quote, subcontract, permit, equipment, bond, and escalation treatment

### Phase 3 — Revisions and addenda

- Sheet revision history and superseded-sheet handling
- Drawing comparison and changed-region overlays
- Takeoff carry-forward with a review queue for changed geometry
- Addendum log tied to scope and price impact
- Change-order workflow that preserves the original contract baseline

### Phase 4 — Spec-driven estimating

- Assembly attributes such as size, material, rating, installation method, and location
- Multiple labor columns and labor-unit sources
- Crew mix, burden, shift, productivity, and job-condition modeling
- Circuit/feeder derivation and rules-based assembly selection
- Configurable markup versus margin, tax, bond, contingency, escalation, and small-tools formulas

### Phase 5 — Pricing and quotes

- Versioned supplier price imports
- Vendor quote leveling with scope inclusions/exclusions
- Quote comparison and award scenarios
- Price-age indicators and escalation assumptions
- A clear separation between catalog price, quoted price, and estimator override

### Phase 6 — AI differentiation

- Division 26 specification reader that maps requirements into assemblies and scope checks
- Legend-to-layer setup and symbol coverage reporting
- Whole-plan count with auditable analyzed/unanalysed regions
- Scope-gap audit across plans, specs, schedules, and addenda
- RFI drafting with drawing/spec citations
- Learning from estimator corrections and completed-job actuals without silently changing bid math

### Phase 7 — Team scale

- Roles and project permissions
- Comments, assignments, review states, and approvals
- Presence and safe concurrent editing
- Bid calendar/pipeline, branch standards, templates, and reporting
- Operational logs, cost monitoring, support tools, and incident alerts

## Actions required from the repository owner

These decisions or inputs cannot be inferred safely from code:

1. **Do not treat browser localStorage as the only copy of a live bid.** Decide
   whether Voltline remains a local prototype or becomes a production system.
   Before production use, choose authenticated cloud persistence, automated
   backups, recovery testing, audit history, and a multi-user conflict model.
2. **Provide anonymized ground truth.** Supply at least three representative
   plan sets, their hand-checked takeoff, and the final Accubid estimate/output.
   Include a small, medium, and large job. Real-world AI accuracy and parity
   cannot be established from mocked browser tests.
3. **Define commercial policy in writing.** Confirm markup versus margin,
   rounding, tax treatment, labor columns, burden, waste, bond, escalation,
   contingency, alternates, allowances, and how negative credits should behave.
   These choices change money and require owner-approved fixtures.
4. **Provide licensed catalog data.** Confirm which pricebook and labor-unit
   sources Voltline may legally import, how often prices age, and whether
   Accubid exports may be used. Do not ask an agent to scrape or reproduce
   licensed proprietary databases.
5. **Set AI limits before live use.** If live AI testing is desired, place an
   Anthropic key only in local environment configuration, choose a monthly
   budget, supply redacted drawings, and define the accuracy/coverage report
   required before counts may be reviewed. AI output must remain unpriced until
   an estimator confirms it.
6. **Choose the next product slice.** The recommended next differentiator is
   the Phase 2 bid structure (systems/areas/phases, alternates, allowances,
   inclusions/exclusions, and proposal output), followed by sheet revisions and
   addenda. The post-award Spectrum plan is valuable but should not displace the
   core estimating workflow until this structure is reliable.

## External references

- [Trimble Accubid Anywhere](https://www.trimble.com/en/products/trimble-accubid-anywhere)
- [Vercel Functions limits](https://vercel.com/docs/functions/limitations)
- [Supabase breaking-change changelog](https://supabase.com/changelog?types=breaking-change)
- [21st.dev guidance for durable dashboard composition](https://21st.dev/blog/dashboard-component-libraries)
