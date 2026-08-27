---
name: job-cost-math
description: Change anything that produces a post-award dollar, hour, or percentage in Voltline — job budgets, phases and cost types, change orders, commitments, actual cost, cost-to-complete and projections, AIA progress billing and retainage, WIP and over/under billing, or the actuals-to-labor-unit feedback loop. Use when touching the planned src/lib/jobcost.ts, billing.ts, wip.ts, awards.ts, or actualsfeedback.ts. Covers the formulas, the immutability rules, and the traps that make a job look profitable when it isn't.
---

# Changing post-award money

Pre-award, a wrong number loses a bid. Post-award, a wrong number tells the
owner a losing job is profitable for six months. The plan is
`.ai/12-spectrum-job-cost-plan.md`; §5 there is the formula reference. This
skill is how to change that math without producing a confident lie.

Everything in `estimating-math` still applies — **hand-calculate before you
write the test**, pure modules only, rounding is display-only. What follows
is what is *additionally* true after the award.

## 1. The budget descends from a frozen snapshot

The job budget is derived from an awarded `BidSnapshot`, never from live
estimate state. Editing the estimate after award changes nothing downstream.
**Approved change orders are the only way a budget moves.**

```
revised_budget[phase][cost_type]
  = original_budget            (from the awarded snapshot, immutable)
  + Σ approved change-order lines
```

Pending change orders never touch the revised budget or the contract amount.
They appear in their own column, or not at all.

## 2. Committed and actual are never added together

An open commitment and an invoice against it are **the same dollar at two
stages of its life**. This is the single most common way a construction cost
report is wrong:

```
open_commitment = Σ max(0, line.amount − line.invoiced_amount)
```

Only the *open* balance may feed cost-to-complete. Write a unit test per
commitment state (unissued, open, partly invoiced, fully invoiced,
over-invoiced) — the over-invoiced case is why the `max(0, …)` is there.

## 3. Percent complete records its method

No phase may display a percentage without saying how it was derived. Four
methods, and the record stores which one was used:

```
cost   : pct = cost_to_date / projected_final_cost      (cost-to-cost)
units  : pct = units_installed / budget_units
hours  : pct = hours_to_date / projected_final_hours
manual : pct = entered, clamped to [0, 1]
```

**Any zero denominator yields `pct = 0` and a reported issue.** Never `NaN`,
and never a silent 100%. Two phases computed different ways is fine; a phase
whose method is unknown is not.

## 4. Projections, and the check that earns its keep

```
remaining    : CTC = max(0, revised_budget − cost_to_date)
earned-rate  : CTC = (cost_to_date / units_installed) × max(0, budget_units − units_installed)
manual       : CTC = entered

PFC      = cost_to_date + CTC
variance = revised_budget − PFC          (negative = overrun)
```

Then: **`CTC < open_commitment` on the same phase is a warning.** You have
promised to spend money you are projecting not to spend. Flag it; do not
correct it — the estimator decides which number is wrong.

Labor performance, which feeds the feedback loop:

```
earned_hours = budget_hours × pct_complete
PF           = earned_hours / hours_to_date        (> 1 is good)
```

Never compute `PF` from a phase carrying unallocated cost — polluted input
produces a labor unit that silently poisons the next bid.

## 5. Cost is never silently absorbed

The post-award twin of invariant 1. A cost transaction, layer, or direct cost
whose phase or cost type is unknown lands in a reported `__unallocated`
bucket **and still counts toward job totals**. Never dropped, never guessed
into a phase.

Dropping it understates cost, which makes the job look profitable — the exact
shape of expensive mistake this codebase is built to refuse.

## 6. Issued documents are immutable

Approved change orders and issued pay applications are frozen. Corrections
are **reversing documents**, never edits. A pay application is a legal
instrument; it must reproduce byte-identically years later, so it carries its
own frozen payload — reuse the `BidSnapshot` pattern rather than inventing a
second freezing mechanism.

## 7. Billing blockers

Before an application may be issued — hard blockers, not warnings:

- `Σ scheduled_value == contract_sum_to_date` (the classic SOV mismatch)
- `total_completed_and_stored ≤ scheduled_value`, per line
- `current_payment_due ≥ 0`, unless explicitly flagged a credit application

G703 per line, then G702 lines 1–9, exactly as `.ai/12-…` §5 spells them out.
Retainage: `r_completed × (D + E) + r_stored × F`. **The final application
trues retainage up to the cent** — no rounding residue may survive to
closeout, and the fixture must assert that.

## 8. Over-billing is a liability

```
over_under_billed = billed_to_date − earned_revenue
   > 0 → over-billed  (a LIABILITY — billings in excess of earnings)
   < 0 → under-billed (an asset)
```

Never present over-billing as revenue, profit, or available cash. A
contractor who reads it as profit runs out of money in month seven.

## 9. Feedback proposes, never writes

The actuals-to-labor-unit loop inherits invariant 2 in full: proposals, a
review queue, an explicit click, a minimum sample size, and phases with
unallocated cost excluded. Nothing writes to the item catalog on its own. A
labor unit that drifts by itself is a bid that drifts by itself.

## 10. Verify

`tests/fixtures/fixture-job.ts` — a hand-calculated job — is mandatory, the
same way `fixture-project.ts` is for bid math: one contract, three phases,
two approved change orders and one pending, two commitments partly invoiced,
a month of cost transactions, two pay applications. Every number derived by
hand **before** the test is written, asserted to 8 decimals, closeout
asserted to the cent.

```sh
npm test
npm run typecheck
npm run lint
npm run test:e2e
```

## Before you report

Say which formulas are covered by hand-calculated tests and which are not.
Post-award math that is merely plausible is worse than absent — absent gets
questioned, plausible gets believed.
