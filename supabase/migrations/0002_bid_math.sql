-- Bid-math completeness: material waste + sales tax + labor factoring on the
-- project, non-takeoff direct job costs, and a typical-area repeat factor on
-- takeoff layers.

alter table public.projects
  add column waste_pct numeric not null default 0,        -- % of extended material
  add column tax_pct numeric not null default 0,          -- % of material after waste
  add column labor_factor_pct numeric not null default 0; -- % adjustment to labor hours

-- Take off one typical floor, apply it to N identical floors.
alter table public.layers
  add column typical_multiplier numeric not null default 1
    check (typical_multiplier > 0);

-- Costs that do not come from takeoff: gear quotes, lighting packages, subs,
-- permits, equipment, bonds. ohp_applies decides whether overhead and profit
-- are charged on the amount or it is carried at cost.
create table public.direct_costs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  description text not null default '',
  category text not null default 'quote'
    check (category in ('quote','subcontractor','equipment','permit','bond','other')),
  amount numeric not null default 0,
  ohp_applies boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index direct_costs_project_idx on public.direct_costs (project_id);

alter table public.direct_costs enable row level security;
create policy "own direct_costs" on public.direct_costs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
