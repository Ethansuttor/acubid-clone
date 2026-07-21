-- Voltline schema: projects, plan documents/sheets, item & assembly database,
-- takeoff layers and measurements. All rows are owned by a single user and
-- protected by RLS (user_id = auth.uid()).

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  labor_rate numeric not null default 0,      -- $ per labor hour
  overhead_pct numeric not null default 0,    -- percent, e.g. 10 = 10%
  profit_pct numeric not null default 0,      -- percent
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  storage_path text not null,
  page_count int not null,
  created_at timestamptz not null default now()
);

-- One row per page of a document. Calibration maps PDF user-space units to feet.
create table public.sheets (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  page_number int not null,
  name text not null default '',
  scale_ft_per_unit numeric,                  -- null until calibrated
  calibration jsonb,                          -- {p1:[x,y], p2:[x,y], distance_ft}
  unique (document_id, page_number)
);

-- User-editable item database (material + labor units), global to the user.
create table public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null default '',
  description text not null,
  unit text not null default 'EA',            -- EA, FT, SF...
  material_cost numeric not null default 0,   -- $ per unit
  labor_hours numeric not null default 0,     -- labor hours per unit
  created_at timestamptz not null default now()
);

create table public.assemblies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null default '',
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table public.assembly_items (
  id uuid primary key default gen_random_uuid(),
  assembly_id uuid not null references public.assemblies(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  quantity numeric not null default 1         -- item units per 1 assembly unit
);

-- Color-coded takeoff layers, each optionally tied to an item or assembly.
create table public.layers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text not null default '#f59e0b',
  tool text not null check (tool in ('count','linear','area')),
  item_id uuid references public.items(id) on delete set null,
  assembly_id uuid references public.assemblies(id) on delete set null,
  rise_drop_ft numeric not null default 0,    -- feet added per linear run
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- Individual takeoff objects. Geometry is stored in PDF user-space units so
-- recalibrating a sheet re-derives every quantity; nothing stale is stored.
create table public.takeoffs (
  id uuid primary key default gen_random_uuid(),
  layer_id uuid not null references public.layers(id) on delete cascade,
  sheet_id uuid not null references public.sheets(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('count','linear','area')),
  geometry jsonb not null,                    -- count:{x,y} | linear/area:{points:[[x,y],...]}
  source text not null default 'manual' check (source in ('manual','ai')),
  status text not null default 'confirmed' check (status in ('confirmed','pending','rejected')),
  ai_confidence numeric,
  created_at timestamptz not null default now()
);

create index takeoffs_sheet_idx on public.takeoffs (sheet_id);
create index takeoffs_layer_idx on public.takeoffs (layer_id);
create index takeoffs_project_idx on public.takeoffs (project_id);
create index sheets_project_idx on public.sheets (project_id);
create index layers_project_idx on public.layers (project_id);

-- RLS: every table is restricted to its owner.
alter table public.projects enable row level security;
alter table public.documents enable row level security;
alter table public.sheets enable row level security;
alter table public.items enable row level security;
alter table public.assemblies enable row level security;
alter table public.assembly_items enable row level security;
alter table public.layers enable row level security;
alter table public.takeoffs enable row level security;

create policy "own projects" on public.projects for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own documents" on public.documents for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own sheets" on public.sheets for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own items" on public.items for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own assemblies" on public.assemblies for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own assembly_items" on public.assembly_items for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own layers" on public.layers for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own takeoffs" on public.takeoffs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Private storage bucket for plan PDFs; paths are namespaced by user id.
insert into storage.buckets (id, name, public) values ('plans', 'plans', false);

create policy "own plan files select" on storage.objects for select
  using (bucket_id = 'plans' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own plan files insert" on storage.objects for insert
  with check (bucket_id = 'plans' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own plan files update" on storage.objects for update
  using (bucket_id = 'plans' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own plan files delete" on storage.objects for delete
  using (bucket_id = 'plans' and (storage.foldername(name))[1] = auth.uid()::text);
