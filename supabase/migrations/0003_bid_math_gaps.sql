-- Bid-math gaps a real estimator hits (see .ai/09-roadmap.md):
-- labor burden as its own line, small tools/consumables, contingency,
-- material escalation, bond as a percent of the final bid price, and a
-- per-direct-cost "tax applies" flag so a $12,000 gear quote can carry a
-- sales-tax line instead of silently going untaxed.

alter table public.projects
  add column labor_burden_pct numeric not null default 0, -- % of bare labor cost
  add column small_tools_pct numeric not null default 0,  -- % of bare labor cost
  add column contingency_pct numeric not null default 0,  -- % of prime cost
  add column escalation_pct numeric not null default 0,   -- % of material after waste
  add column bond_pct numeric not null default 0          -- % of FINAL bid price (circular)
    check (bond_pct >= 0 and bond_pct < 100);

-- Sales tax on a direct cost is opt-in: quotes usually arrive tax-included,
-- and adding tax silently would double-count it.
alter table public.direct_costs
  add column taxable boolean not null default false;
