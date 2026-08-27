-- Bid-math gaps a real estimator hits on a live bid, flagged by audit:
-- labor burden and small tools as their own lines, escalation, contingency,
-- a bond priced as a percentage of the bid price (the circular calculation),
-- and sales tax on a taxable quote rather than on takeoff material only.

alter table public.projects
  -- Payroll tax, insurance and fringes, as a percentage of labor cost.
  -- Previously this had to be baked into $/hr with nowhere to show a reviewer.
  add column labor_burden_pct numeric not null default 0,
  -- Small tools and consumables, typically 1-3% of labor cost.
  add column small_tools_pct numeric not null default 0,
  -- Material price movement between bid and buyout, on the material total.
  add column escalation_pct numeric not null default 0,
  -- Cost buffer, a percentage of prime cost, marked up like any other cost.
  add column contingency_pct numeric not null default 0,
  -- Bond premium as a percentage of the BID PRICE, which includes the bond:
  -- bid = (cost + O&P + at-cost items) / (1 - bond_pct/100).
  -- Deliberately unconstrained. Outside 0 <= bond_pct < 100 that division has
  -- no meaningful answer, and summarize() refuses to invent one and warns in
  -- the UI and the export. A CHECK here would instead reject the write while
  -- the screen kept showing the bad rate, and the warning would vanish on
  -- reload — a rejected save is a worse guard than a persistent red banner.
  add column bond_pct numeric not null default 0;

-- A gear or lighting quote is usually quoted before tax. Tax previously
-- applied only to takeoff material, so a $12,000 quote got no tax line and
-- no way to record whether tax was already included.
alter table public.direct_costs
  add column taxable boolean not null default false;
