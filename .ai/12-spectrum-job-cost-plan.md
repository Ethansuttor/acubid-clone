# Spectrum → Voltline: post-award job cost, budget and billing

> Historical research, deferred as of September 7, 2026. This is not an active
> implementation queue. Use [18-parallel-execution-plan.md](18-parallel-execution-plan.md)
> for current work. The current browser store is IndexedDB, not localStorage;
> cost/market/compatibility claims and accounting policies below were not
> revalidated in this documentation review. Cloud is not inherently required
> for a single-user local ledger; revisit multi-user and recovery requirements
> when post-award work is assigned. Do not reuse the proposed 0003 migration
> name (0003_bid_math_gaps.sql already exists), or implement these formulas
> without reference examples and the contractor's intended policy.

**Written:** August 26, 2026
**Status:** plan only — no code written, nothing here is implemented.
**Question it answers:** what does Trimble Viewpoint **Spectrum** do, which of
those features belong inside Voltline, and how do we build them without
breaking a single rule in [`04-invariants.md`](04-invariants.md)?

> Product names, module behavior, import formats, and API availability in this
> draft must be re-verified against current official Trimble documentation and
> the repository owner's Spectrum license before implementation. This file is
> architecture planning, not a compatibility claim.

Related: [`09-roadmap.md`](09-roadmap.md) (this plan subsumes **O-401**,
**B-305**, and advances **O-402**), [`10-audit-and-competitive-roadmap.md`](10-audit-and-competitive-roadmap.md)
(Phase 2 "cost codes", Phase 3 "change-order workflow").

---

## 0. The premise, and one objection stated up front

Voltline lives **before** the award: drawings in, bid price out. Spectrum
lives **after** it: a job exists, money is spent against it, and someone has
to answer "are we making money on this, and how much can we bill this month?"
Bringing Spectrum's features into Voltline means crossing the award line and
following one project from bid to closeout inside one application.

**The objection:** three parts of Spectrum are regulated, audited,
liability-bearing systems of record — the **general ledger**, **payroll tax
filing / certified payroll**, and **AP check runs / 1099s**. Rebuilding those
inside a single-estimator browser app persisting to `localStorage` would be a
bad idea for reasons that have nothing to do with engineering difficulty: a
mistake there is not a lost bid, it is a filing penalty. This plan therefore
sorts every Spectrum capability into **Build / Build-lite / Integrate /
Decline**, and the Build column stops exactly where a CPA and a payroll bureau
take over.

Everything else — the job budget, commitments, cost-to-complete, projections,
change orders, progress billing, WIP, and the actuals-to-labor-unit feedback
loop — is not just buildable, it is where Voltline's existing pure-math core
is already an advantage. Spectrum's job cost is a general ledger with a cost
code stapled on. Voltline's would be an **estimate that keeps its parentage**:
every actual dollar traceable back to the takeoff object that predicted it.
Spectrum cannot do that, because the estimate arrives in Spectrum as a flat
import from Accubid and its lineage is gone at the door.

That lineage is the whole differentiator. Build for it.

---

## 1. What Spectrum actually is

Spectrum is Trimble's cloud construction ERP, organised into these functional
areas (module names as Trimble publishes them):

| Area | Modules |
|---|---|
| **Accounting** | General Ledger, Accounts Payable, Accounts Receivable, Cash Management, Payroll, Confidential Payroll, Year-End Processing |
| **Project management** | **Job Cost**, Project Setup, Project Management, Purchase Order, Change Order Entry, Submittals / RFIs / Daily Logs |
| **Equipment** | Equipment Control, Equipment Tracking, Preventive Maintenance |
| **Materials** | Inventory Control, Small Tools, digital procurement |
| **Service** | Work Order, Time + Material Billing, Service Tech Mobile, service contracts |
| **HR & payroll** | Human Resources, recruiting/onboarding, paystubs, PTO, union & certified payroll |
| **Tools / platform** | Info-Link (SQL/ODBC into Excel, Access, Crystal), Trimble Construction One Analytics, Document Imaging, System Administration, **API Web Services** (Data Exchange WSDL/SOAP; AppXchange REST for newer work) |

The centre of gravity is **Job Cost**. Its atom is `job → phase code → cost
type`, and everything else posts into it: AP invoices, payroll hours,
equipment usage, inventory issues, purchase orders and subcontracts as
*commitments*, and change orders. The general ledger is fed by those same
transactions rather than a nightly sync, which is why the numbers reconcile.

Two Spectrum facts matter especially here:

1. **Spectrum already imports Accubid.** Project Setup → Estimating Systems
   links Accubid Pro v11 / Accubid Enterprise v6 and imports the estimate's
   **phases** as the job's phase codes, with a configurable *default quantity
   cost type*, *default subcontract cost type*, and up to four user-defined
   cost types beyond Labor, Material and Subcontract. That is the seam
   Voltline is proposing to own on both sides — and, in the meantime, the
   handoff Voltline must be able to feed (see **SP-10**).
2. **Original vs. current estimated cost.** When a job is created the original
   estimated cost is entered *at the phase level*, and the current estimated
   cost is set equal to it. Everything afterwards — change orders, overruns,
   projections — is one long story about those two numbers diverging. Get that
   pair right and most of the module falls out of it.

---

## 2. The keystone gap: Voltline has no cost-code spine

| Spectrum concept | Voltline today | Verdict |
|---|---|---|
| Job | `Project` | exists |
| **Phase code (WBS)** | — | **missing; blocks everything below** |
| **Cost type (L/M/S/E/O)** | implied only: material vs. labor vs. `DirectCost.category` | **missing as a first-class field** |
| Original estimated cost, by phase | `BidSnapshot.payload.summary` — one number for the whole job | needs decomposition |
| Contract amount | `bid_price` (a *proposed* price, not a signed one) | needs a contract record |
| Committed cost | — | missing |
| Actual cost | — | missing |
| Projected cost / cost to complete | — | missing |
| Change order | — | missing |
| Billing / AIA pay application | — | missing |
| Over/under billing, WIP | — | missing |

Every Spectrum feature is downstream of one thing: **an estimate line must be
able to say which phase and cost type it belongs to.** Until that exists, none
of the rest can be built; once it exists, most of the rest is arithmetic —
which is the part of this app that already works.

### Decisions to make first

- **D-S1 — Cost types.** Adopt Spectrum's set: `L` Labor, `M` Material,
  `S` Subcontract, `E` Equipment, `O` Other, plus up to four user-defined.
  Fixed codes, user-editable labels. This is the most compatibility-sensitive
  choice in the plan; matching Spectrum costs nothing and makes SP-10 trivial.
- **D-S2 — Where the phase lives.** On the **layer**, not the item. A layer is
  already "one kind of scope, one system, often one area" — the closest thing
  Voltline has to a phase, and where an estimator is already thinking about
  scope boundaries. Direct costs get a phase too. Items stay phase-free so the
  catalog remains reusable across jobs.
- **D-S3 — Cost type is derived, not typed.** An estimate line already knows
  it is material (`item.material_cost`) and labor (`item.labor_hours`), so it
  splits into an `M` and an `L` budget line automatically. Only `DirectCost`
  needs an explicit cost type, mapped from its existing `category`:
  `quote → M`, `subcontractor → S`, `equipment → E`, `permit|bond|other → O`.
  Nothing new for the estimator to type, which is why this will actually get
  used.
- **D-S4 — Storage.** SP-5 onward writes a *transaction ledger* that grows for
  the life of the job — thousands of rows a month on a mid-size job, against a
  bid's few hundred. `localStorage` (~5–10 MB per origin) is the wrong home
  for that, and post-award work is inherently multi-user (PM + accounting +
  field). **Cloud sync stops being a roadmap item and becomes a hard
  prerequisite for SP-5.** SP-1 → SP-4 can ship local-first.

---

## 3. Sorting every Spectrum capability

| Spectrum capability | Verdict | Why |
|---|---|---|
| Job Cost: phases, cost types, budgets | **Build** | The spine. Nothing works without it. |
| Original vs. revised (current) budget | **Build** | Cheap once phases exist; the core of every report. |
| Committed cost (PO + subcontract) | **Build** | Without it, cost-to-complete is a lie the day a gear PO is issued. |
| Cost to complete / projected final cost | **Build** | The number the owner actually manages a job by. |
| Change orders (PCO → ACO) | **Build** | Already roadmap **B-305**; the estimating engine prices them for free. |
| Progress billing, SOV, AIA G702/G703 | **Build** | Deterministic arithmetic, high value, no external dependency. |
| Retainage | **Build** | Falls out of the pay application; must be exact to the cent. |
| WIP / Contract Status (over-under billing) | **Build** | The report bonding companies and banks ask for. |
| Actual cost import (AP, payroll, equipment) | **Build-lite** | Import and attribute costs; do **not** originate them. |
| Unit/production tracking, labor performance | **Build** | Feeds **O-401**, the compounding advantage. |
| Actuals → labor-unit feedback | **Build** | Voltline-only; Spectrum structurally cannot do it. |
| Subcontract compliance (insurance, lien waivers) | **Build-lite** | A checklist with dates plus a payment blocker. Cheap; prevents real losses. |
| Purchase orders as documents (issue, print, email) | **Build-lite** | Needed to make commitments real. Keep it a simple document. |
| Accounts Payable (invoice entry, coding, approval) | **Build-lite** | Code invoices to job cost; **do not** cut checks. |
| Accounts Receivable (invoice, aging, cash receipts) | **Build-lite** | Track what was billed and paid; stop before the ledger. |
| Analytics / dashboards | **Build-lite** | Job dashboard + portfolio roll-up, from the same pure functions. |
| Document imaging | **Build-lite** | Attachments on COs, invoices, pay apps. The storage bucket already exists. |
| **General Ledger** | **Decline** | System of record for company financials; belongs with the accountant's package. Export instead. |
| **Payroll processing, tax filing, certified payroll** | **Decline** | Regulated, penalty-bearing, jurisdiction-specific. Import hours; never compute a paycheck. |
| **AP check runs, 1099s, cash management** | **Decline** | Same reason. |
| Equipment Control / Preventive Maintenance | **Decline** | A different product for a different user. Accept equipment *cost*; do not run a fleet. |
| Inventory Control / Small Tools | **Decline** | Warehouse software. Accept issued-material cost. |
| Service / Work Order / T&M billing | **Decline (for now)** | A whole second business line. Revisit only if the company runs a service department. |
| HR, recruiting, onboarding, PTO | **Decline** | Not adjacent to anything Voltline does. |
| Info-Link / API Web Services | **Integrate** | Be a good citizen: export in Spectrum's shape (**SP-10**). |

**The line:** Voltline may compute what a job *should* cost, what it *is*
costing, and what may be *billed*. It does not become the book of record for
what was *paid*.

---

## 4. Milestones

Dependencies are strict; the order below is the build order.

```
SP-1 cost-code spine
  └─ SP-2 award → budget
       ├─ SP-3 change orders ────────┐
       ├─ SP-4 commitments ──────────┤
       └─ SP-7 SOV + AIA billing     │
              └─ SP-8 WIP  ←─────────┤
       SP-5 actual cost ledger ──────┤   (needs cloud sync — D-S4)
              └─ SP-6 projections ←──┘
                     └─ SP-9 actuals → labor units
SP-10 Spectrum export  (can ship any time after SP-2)
```

Day ranges are planning estimates, not commitments.

### SP-1 — Cost-code spine · ~3–5 days · local-first OK

Give the estimate a WBS.

- **Migration** `0003_job_cost.sql`: `job_phases`, `cost_types`;
  `layers.phase_id`, `direct_costs.phase_id`, `direct_costs.cost_type`.
- **Types**: `JobPhase`, `CostType`, `CostTypeCode = "L"|"M"|"S"|"E"|"O"|string`.
- **Pure** `src/lib/jobcost.ts` → `budgetFromEstimate(lines, directCosts, phases)`
  returning `BudgetLine[]` keyed `(phase_id, cost_type)` carrying `cost`,
  `hours`, `units`, `unit`.
- **UI**: phase selector in `LayersPanel`, phase + cost type on direct-cost
  rows, a "Budget by phase" table in `EstimateView`.
- **Invariant work**: a layer or direct cost with **no phase** is not silently
  bucketed — it rolls into a reported `__unallocated` phase, exactly the way
  `EstimateIssue` handles unpriceable quantity today. Non-zero unallocated is a
  preflight **warning** before award and a **blocker** after it.
- **Done when**: the sum of budget line costs equals `summary.primeCost` to
  eight decimal places on the hand-calculated fixture, unallocated included.

### SP-2 — Award: snapshot becomes budget · ~2–3 days · local-first OK

The moment the job is won.

- `contracts` table: `original_amount`, `awarded_snapshot_id`,
  `retainage_completed_pct`, `retainage_stored_pct`, `awarded_at`.
- `src/lib/awards.ts` → `awardJob(snapshot, contractAmount)` producing
  immutable `job_budget_lines` stamped with `source_snapshot_id`.
- **Invariant**: the budget descends from a **frozen `BidSnapshot`**, never
  from live estimate state. Editing the estimate after award changes nothing
  downstream — reuse the existing snapshot immutability rather than inventing
  a second freezing mechanism.
- Contract amount is entered separately from `bid_price`, because the signed
  number is frequently not the bid number. A difference is displayed, never
  reconciled away.

### SP-3 — Change orders · ~4–6 days

Spectrum's PCO → ACO two-stage model, priced by the engine we already have.

- `change_orders` (`number`, `status: pending|approved|rejected|void`,
  `revenue_amount`, `approved_at`) and `change_order_lines`
  (`phase_id`, `cost_type`, `cost`, `hours`).
- A CO may be priced **from takeoff**: layers tagged to the CO extend through
  `extendEstimate` → `summarize` at the job's own rates. No second math path,
  ever.
- **Invariants**: `pending` COs never touch the revised budget or the contract
  amount — they appear in a separate pending column only. `approved` COs are
  immutable; a mistake is corrected with a reversing CO, never an edit. That
  is also the audit trail **O-402** asked for.
- `revised_budget = original_budget + Σ approved CO cost`, per
  `(phase, cost_type)`.

### SP-4 — Commitments · ~4–6 days

- `commitments` (`kind: po|subcontract`, vendor, number, status) and
  `commitment_lines` (`phase_id`, `cost_type`, `amount`, `invoiced_amount`).
- Commitment change orders adjust the line; they never overwrite it.
- **The double-count trap, spelled out:** an open commitment and an invoice
  against it are the *same dollar* at two stages of its life. `open_commitment
  = amount − invoiced_amount`, and only the open balance may feed
  cost-to-complete. Nearly every construction cost report that has ever been
  wrong was wrong right here.
- Sub compliance: expiry dates for insurance / W-9 / lien waiver, with an
  expired item blocking "ready to pay". Cheap, and it prevents real losses.

### SP-5 — Actual cost ledger · ~5–8 days · **requires cloud sync (D-S4)**

- `cost_transactions`: `phase_id | null`, `cost_type`, `date`, `amount`,
  `hours`, `units`, `source: ap|payroll|equipment|material|manual|import`,
  `commitment_line_id | null`, `reference`, `posted_at`.
- Import paths: CSV/Excel first (every accounting package exports it), then
  the Spectrum shape from SP-10 run in reverse.
- **Invariants**:
  - A transaction whose phase or cost type does not exist on the job posts to
    `__unallocated` and raises a `JobCostIssue`. **Never dropped, never guessed
    into a phase** — the same rule as invariant 1, for the same reason: an
    understated actual cost produces a job that looks profitable.
  - Amounts are rounded to cents **at entry** (input rounding); every rollup
    afterwards stays full precision, so invariant 5 is intact.
  - Imports are idempotent on `(source, reference)`. Double-posting an AP batch
    is the most common real-world failure of every job cost system in
    existence.

### SP-6 — Projections · ~4–6 days

The heart of the module. All formulas in §5; all of it in `jobcost.ts`.

- Per-phase progress record: `pct_method: cost|units|hours|manual`,
  `units_installed`, `manual_pct`, `ctc_method: remaining|earned-rate|manual`,
  `ctc_amount`, `as_of`.
- **Invariant**: percent complete is never inferred silently — every phase
  records *which method produced its number*, and shows it in the UI and the
  export. Two phases computed different ways is fine; two phases whose method
  is unknown is not.
- **Checks that earn their keep:**
  - `CTC < open commitments on that phase` → warning. You have promised to
    spend money you are projecting not to spend.
  - `cost_to_date > revised_budget` while `pct_complete < 100` → warning.
  - `PFC = 0` while `cost_to_date > 0` → blocker (divide-by-zero territory).

### SP-7 — SOV and AIA billing · ~6–9 days

- `sov_lines` (phase-linked or free-standing), `pay_applications` (`number`,
  `period_end`, `status: draft|issued`, immutable `payload`).
- Pure `src/lib/billing.ts` computing the G703 continuation sheet and G702
  summary exactly as §5 defines them.
- **Invariants** — each a hard blocker on issuing an application:
  - `Σ scheduled_value == contract_sum_to_date`. The classic SOV mismatch.
  - `total_completed_and_stored ≤ scheduled_value`, per line.
  - `current_payment_due ≥ 0` unless explicitly flagged a credit application.
  - An **issued** application is immutable and carries its own frozen payload —
    the `BidSnapshot` pattern, reused verbatim. A pay application is a legal
    document; it must reproduce byte-identically a year later.
- Excel/PDF output in the G702/G703 layout. `excel.ts` already proves the
  "compute nowhere, format only" discipline this needs.

### SP-8 — WIP / Contract Status · ~3–4 days

- `src/lib/wip.ts` → one row per job: contract amount, cost to date, projected
  final cost, percent complete, earned revenue, billed to date, over/under
  billed, projected gross profit, projected margin.
- Rolled up across jobs, that *is* the Contract Status / WIP / Bonding report
  banks and sureties ask for.
- **Invariant**: over-billing is presented as a **liability** (billings in
  excess of earnings), never as revenue or profit. A contractor who reads
  over-billing as profit is a contractor who runs out of cash in month seven.

### SP-9 — Actuals → labor units · ~5–7 days · closes **O-401**

The feature Spectrum structurally cannot have, because the estimate arrives
there as a flat import with its lineage stripped.

- `src/lib/actualsfeedback.ts` → for each item, compare estimated hours (from
  the awarded snapshot's extended lines) against actual hours per installed
  unit, and emit **proposals**: `item`, `estimated_labor_hours`,
  `observed_labor_hours`, `sample_size`, `jobs_observed`, `confidence`.
- **Invariant 2 applies in full.** Proposals with a review queue. Nothing
  writes to the item catalog without an explicit click, and every accepted
  change records the job it came from. A labor unit that drifts on its own is
  a bid that drifts on its own.
- Requires a minimum sample size before proposing, and must exclude any phase
  whose unallocated bucket is non-zero — polluted data is worse than no data.

### SP-10 — Spectrum interop export · ~2–3 days · ship early

Be the tool that *feeds* Spectrum before being the tool that replaces it.

- `src/lib/erpexport.ts` → the awarded budget as `job, phase, cost_type,
  description, budget_cost, budget_hours, budget_units, unit` — the shape
  Spectrum's standard import and its Accubid path already consume — plus a
  generic job-cost CSV for Sage / Foundation / QuickBooks users.
- Spectrum's own integration surface, for whoever builds a live connector
  later: **Data Exchange web services** (WSDL/SOAP, endpoint unique per
  installation, discoverable under *System Administration → Utilities → Data
  Exchange Download*), the newer **AppXchange REST APIs**, and **Info-Link**
  for read-only SQL/ODBC extraction.
- **Honesty requirement (invariant 12):** this format is derived from public
  documentation only. Until it has round-tripped into a real Spectrum
  instance, the UI and the docs must say **"format unverified"**. Do not
  describe it as Spectrum-compatible on the strength of this plan.

---

## 5. The math

Everything below belongs in `src/lib/jobcost.ts`, `billing.ts` and `wip.ts` —
pure, no React, no I/O, hand-checked before the test is written (see
[`07-verification.md`](07-verification.md)).

### Budget

```
original_budget[p][ct]  = from the awarded BidSnapshot            (immutable)
approved_co_cost[p][ct] = Σ change_order_lines where status = approved
revised_budget[p][ct]   = original_budget + approved_co_cost
```

### Commitments

```
open_commitment[p][ct]  = Σ max(0, line.amount − line.invoiced_amount)
```

### Actual cost

```
cost_to_date[p][ct]     = Σ cost_transactions.amount
hours_to_date[p]        = Σ cost_transactions.hours   where cost_type = L
units_installed[p]      = entered on the progress record, else Σ transactions.units
```

### Percent complete — the method is recorded, never assumed

```
cost   : pct = cost_to_date / projected_final_cost         (cost-to-cost)
units  : pct = units_installed / budget_units
hours  : pct = hours_to_date / projected_final_hours
manual : pct = entered value, clamped to [0, 1]
```

Any zero denominator yields `pct = 0` **and** a reported issue. It never yields
`NaN`, and it never silently yields 100%.

### Cost to complete and projected final cost

```
remaining    : CTC = max(0, revised_budget − cost_to_date)
earned-rate  : unit_rate = cost_to_date / units_installed
               CTC       = unit_rate × max(0, budget_units − units_installed)
manual       : CTC = entered value

PFC      = cost_to_date + CTC
variance = revised_budget − PFC           (negative = overrun)
```

`CTC` is checked against `open_commitment` for the same phase. A projection
below money already promised is **flagged, not corrected** — the estimator
decides which number is wrong.

### Labor performance

```
earned_hours          = budget_hours × pct_complete
performance_factor PF = earned_hours / hours_to_date          (> 1 is good)
hours_to_complete     = (budget_hours − earned_hours) / PF    , PF > 0
projected_final_hours = hours_to_date + hours_to_complete
```

`PF` is the number that feeds SP-9. It is also the number an estimator will
trust or distrust the whole module by, so it must never be computed from a
phase carrying unallocated cost.

### Contract and revenue

```
contract_amount   = original_amount + Σ approved CO revenue_amount
job_pct_complete  = Σ cost_to_date / Σ PFC                    (cost-to-cost)
earned_revenue    = contract_amount × job_pct_complete
billed_to_date    = Σ issued pay apps' total_completed_and_stored
over_under_billed = billed_to_date − earned_revenue
                      > 0 → over-billed  (a LIABILITY)
                      < 0 → under-billed (an asset)
projected_gross_profit = contract_amount − Σ PFC
projected_margin       = projected_gross_profit / contract_amount
```

### AIA G703 continuation sheet, per line *i*

```
C  scheduled_value
D  previous_completed
E  this_period
F  materials_presently_stored
G  total_completed_and_stored = D + E + F        pct = G / C
H  balance_to_finish          = C − G
I  retainage                  = r_completed × (D + E) + r_stored × F
```

### AIA G702 application and certificate

```
1  original_contract_sum
2  net_change_by_change_orders   = Σ approved CO revenue
3  contract_sum_to_date          = 1 + 2
4  total_completed_and_stored    = Σ G
5  retainage                     = Σ I          (5a completed, 5b stored)
6  total_earned_less_retainage   = 4 − 5
7  less_previous_certificates    = prior application's line 6
8  current_payment_due           = 6 − 7
9  balance_to_finish_incl_retain = 3 − 6
```

**Blockers before an application may be issued:** `Σ C == 3`; `G ≤ C` on every
line; `8 ≥ 0` unless flagged a credit. The final application trues retainage up
exactly — no rounding residue may survive to closeout.

---

## 6. Data model sketch

`supabase/migrations/0003_job_cost.sql` — mirrored in `localdb.ts` while SP-1
to SP-4 remain local-first, and RLS-scoped by `user_id` like every existing
table.

| Table | Key columns |
|---|---|
| `job_phases` | `project_id, code, description, sort_order` |
| `cost_types` | `project_id, code, name, builtin` |
| `contracts` | `project_id, original_amount, awarded_snapshot_id, retainage_completed_pct, retainage_stored_pct, awarded_at` |
| `job_budget_lines` | `project_id, phase_id, cost_type, budget_cost, budget_hours, budget_units, unit, source_snapshot_id` |
| `change_orders` | `project_id, number, status, description, revenue_amount, approved_at` |
| `change_order_lines` | `change_order_id, phase_id, cost_type, cost, hours` |
| `commitments` | `project_id, kind, vendor, number, status, executed_at` |
| `commitment_lines` | `commitment_id, phase_id, cost_type, amount, invoiced_amount` |
| `cost_transactions` | `project_id, phase_id, cost_type, date, amount, hours, units, source, reference, commitment_line_id, posted_at` |
| `phase_progress` | `project_id, phase_id, pct_method, units_installed, manual_pct, ctc_method, ctc_amount, as_of` |
| `sov_lines` | `project_id, phase_id, description, scheduled_value, sort_order` |
| `pay_applications` | `project_id, number, period_end, status, payload (frozen), issued_at` |

Columns added to existing tables: `layers.phase_id`, `direct_costs.phase_id`,
`direct_costs.cost_type`.

New pure modules: `jobcost.ts`, `billing.ts`, `wip.ts`, `awards.ts`,
`erpexport.ts`, `actualsfeedback.ts`.
New components under `src/components/job/`: `BudgetView`, `CostView`,
`ChangeOrdersView`, `CommitmentsView`, `BillingView`, `WipView` — reached from
a **Job** tab that only appears once a contract exists.

Note for whoever implements SP-5: `workspace.ts` currently loads **10**
entities fail-closed. This plan adds up to 12 more. Invariant 9 must extend to
every one of them, and the load will want batching or lazy per-tab loading
rather than 22 parallel queries.

---

## 7. Invariants this adds

Append to [`04-invariants.md`](04-invariants.md) when the code lands, not before.

13. **Cost is never silently absorbed.** A cost transaction, layer or direct
    cost whose phase or cost type is unknown lands in a reported
    `__unallocated` bucket and still counts toward job totals. Never dropped,
    never guessed into a phase. (The post-award twin of invariant 1.)
14. **The budget descends from a frozen snapshot.** Editing an estimate after
    award changes nothing downstream. Approved change orders are the only way a
    budget moves.
15. **Approved change orders and issued pay applications are immutable.**
    Corrections are reversing documents. A pay application must reproduce
    byte-identically years later.
16. **Committed and actual are never added together.** Only the open
    commitment balance feeds cost-to-complete.
17. **Percent complete records its method.** No phase shows a percentage
    without saying how it was derived.
18. **Over-billing is a liability.** It is never presented as revenue, profit,
    or available cash.

---

## 8. Failure modes

| # | Failure | Severity | Mitigation |
|---|---|---|---|
| 1 | Actual cost imported twice → job looks unprofitable; imported once with a wrong sign → looks profitable | **Critical** | Idempotent import on `(source, reference)`; per-import reversal; a preview that must be confirmed before posting |
| 2 | Committed + invoiced double-counted in cost-to-complete | **Critical** | `open = max(0, amount − invoiced)`; a unit test per commitment state |
| 3 | Over-billing read as profit | **Critical** | Labelled a liability in UI and export; the WIP row shows earned vs. billed side by side |
| 4 | Pay application issued against a mismatched SOV | **Critical** | Hard blocker: `Σ scheduled_value == contract_sum_to_date` |
| 5 | Rounding residue leaves final retainage unreleasable | High | Cents rounded at entry only; final application trues up; fixture asserts closeout to the cent |
| 6 | Percent complete pinned at 100% while costs still post | High | Warning, not an auto-correction; PFC keeps rising and the variance shows it |
| 7 | Labor-unit feedback quietly changes the catalog | High | Invariant 2: proposals with a review queue, minimum sample size, polluted phases excluded |
| 8 | `localStorage` overflows mid-job, silently | **Critical** | D-S4: cloud sync is a prerequisite for SP-5; until then the Job tab is capped and says so |
| 9 | Spectrum export accepted as verified | Medium | Labelled "format unverified" until round-tripped against a real instance (invariant 12) |
| 10 | 22 fail-closed load queries make opening a project slow | Medium | Lazy per-tab loading, still fail-closed within each tab |

---

## 9. What this deliberately does not become

Not a general ledger. Not a payroll system. Not a check-writer. Not fleet
maintenance, not a warehouse, not an HRIS, not a service dispatch board. If the
user's accountant asks Voltline for a trial balance, the correct answer is an
export.

What comes out the other end of this plan is **one job, followed end to end,
with every actual dollar traceable to the takeoff object that predicted it.**
Spectrum has the ledger. Voltline would have the lineage — and lineage is what
makes the next bid better.

---

## 10. If you build three things

1. **SP-1 + SP-2 — the cost-code spine and the award.** Everything is blocked
   on it, it is the smallest piece of work in the plan, and on its own it
   already does something Voltline cannot do today: produce a phased budget
   that hands off to whatever ERP the contractor already runs.
2. **SP-7 — AIA progress billing.** The most immediate money value in the list.
   Contractors bill monthly, by hand, in Excel, and a wrong pay application
   delays cash by thirty days. Pure arithmetic with a fixed, published output
   format — precisely what this codebase is already good at.
3. **SP-9 — actuals to labor units.** The only feature here no competitor can
   copy, because it needs the estimate's lineage and Spectrum discards that at
   import. It also makes every future bid better, which compounds. Nothing else
   in this plan does.

**Deliberately deferred:** SP-5's ledger, until cloud sync exists (D-S4).
Building a months-long cost history on `localStorage` would be building on
sand, and the failure would arrive silently — which is the one kind of failure
this project has already decided it will not ship.

---

## 11. Verification

Per [`07-verification.md`](07-verification.md), plus one addition that is not
optional:

**`tests/fixtures/fixture-job.ts` — a hand-calculated job.** One contract,
three phases, two approved change orders and one pending, two commitments
partly invoiced, a month of cost transactions, and two pay applications. Every
number derived by hand *before* the test is written, asserted to eight decimal
places, with the closeout asserted to the cent. This is exactly how
`fixture-project.ts` earns its keep today, and twice in this project's history
a hand calculation caught a wrong test rather than a wrong app.

Then the standard gate: `npm test`, `npx tsc --noEmit`, `npm run lint`,
`npx playwright test`, `npm run bench` — and the benchmark fixture grows a
job-cost dimension, because a two-year job's transaction ledger is a bigger
recalculation than any bid.

---

## 12. Sources

- [Welcome to Spectrum — Trimble Help](https://help.trimble.com/doc/spectrum/spectrum/welcome-to-spectrum)
- [Job Cost — Trimble Help](https://help.trimble.com/en/spectrum/spectrum/project-management/job-cost)
- [What are projected costs and how are they used? — Trimble Help](https://help.trimble.com/doc/spectrum/spectrum/project-management/job-cost/troubleshooting/frequently-asked-questions/what-are-projected-costs-and-how-are-they-used)
- [Over/Under Billed Dollars — Trimble Help](https://help.trimble.com/doc/spectrum/spectrum/project-management/job-cost/in-depth-overview/overunder-billed-dollars)
- [Trimble Accubid and Trimble Autobid Systems — Trimble Help](https://help.trimble.com/doc/spectrum/spectrum/project-management/project-setup/estimating-systems/trimble-accubid-and-trimble-autobid-systems)
- [Payroll — Trimble Help](https://help.trimble.com/doc/spectrum/spectrum/accounting/payroll)
- [Equipment Control — Trimble Help](https://help.trimble.com/en/spectrum/spectrum/equipment/equipment-control)
- [Equipment Tracking — Trimble Help](https://help.trimble.com/en/spectrum/spectrum/equipment/equipment-tracking)
- [Materials — Trimble Help](https://help.trimble.com/en/spectrum/spectrum/materials/materials)
- [Info-Link — Trimble Help](https://help.trimble.com/en/spectrum/spectrum/tools/info-link)
- [API Web Services — Trimble Help](https://help.trimble.com/en/spectrum/spectrum/api-web-services/api-web-services)
- [Spectrum Construction Management Software — Trimble](https://www.trimble.com/en/products/viewpoint/spectrum)
- [Create a Subcontract Change Order — Viewpoint Help](https://help.viewpoint.com/en/spectrum/spectrum/accounting/accounting/accounts-receivable/spectrum-menus/data-entry-overview/change-order-entry/create-a-subcontract-change-order)
- [Viewpoint Spectrum: Job Costing, Payroll & Billing — BASG](https://basgcorp.com/blog/viewpoint-spectrum-construction-erp-review/)
- [A Guide to G702 and G703 Forms in AIA Billing — Autodesk](https://www.autodesk.com/blogs/construction/g702-g703-forms-aia-billing/)
