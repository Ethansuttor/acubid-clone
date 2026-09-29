-- Bid organization and immutable issued-revision storage. This migration also
-- uses explicit Data API grants because new public-schema tables are no longer
-- assumed to be exposed automatically on current Supabase projects.

alter table public.layers
  add column area text not null default '',
  add column system text not null default '',
  add column phase text not null default '';

create table public.proposal_entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('inclusion','exclusion','allowance','alternate')),
  description text not null default '',
  amount numeric not null default 0,
  pricing_note text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index proposal_entries_project_idx on public.proposal_entries (project_id, sort_order);

alter table public.proposal_entries enable row level security;
create policy "own proposal_entries" on public.proposal_entries for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create table public.bid_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  revision int not null check (revision > 0),
  label text not null default '',
  created_at timestamptz not null default now(),
  bid_price numeric not null,
  material_total numeric not null,
  labor_hours_total numeric not null,
  labor_cost numeric not null,
  warning_count int not null default 0 check (warning_count >= 0),
  payload jsonb not null,
  unique (project_id, revision)
);

create index bid_snapshots_project_idx on public.bid_snapshots (project_id, revision desc);

alter table public.bid_snapshots enable row level security;
create policy "own bid_snapshots" on public.bid_snapshots for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.proposal_entries to authenticated;
grant select, insert, update, delete on public.bid_snapshots to authenticated;
