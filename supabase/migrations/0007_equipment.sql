-- ============================================================================
-- Equipment: the admin-side Inventory page's company-wide tools &
-- equipment catalog, plus the request/approval and usage-log workflows
-- that mirror 0006_materials.sql. equipment itself is not just a bare
-- name list (unlike materials) — it's the actual asset register: each
-- row is one physical tool/machine, identified by its own asset_tag
-- (not by name, which is deliberately *not* unique — a shop can own
-- several identical "Claw Hammer" units), tracked through a simple
-- checkout lifecycle (status + current_project_id) that's what makes an
-- Inventory assignment "reflected on the project's Equipment tab":
-- current_project_id is exactly what that tab filters by.
--
-- equipment_assignments (added below) is the checkout/checkin history
-- behind that lifecycle — one row per assignment, closed out by setting
-- returned_at when the item comes back.
--
-- Run this AFTER 0006_materials.sql.
-- ============================================================================

create table if not exists public.equipment (
  id bigint generated always as identity primary key,
  asset_tag text not null unique,
  name text not null,
  category text,
  description text,
  serial_number text,
  status text not null default 'available'
    check (status in ('available', 'assigned', 'maintenance', 'retired')),
  current_project_id bigint references public.projects (id) on delete set null,
  last_assigned_at timestamptz,
  last_returned_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.equipment_assignments (
  id bigint generated always as identity primary key,
  equipment_id bigint not null references public.equipment (id) on delete cascade,
  project_id bigint not null references public.projects (id) on delete cascade,
  assigned_by uuid not null references public.profiles (id) on delete restrict,
  assigned_at timestamptz not null default now(),
  returned_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_equipment_current_project_id on public.equipment (current_project_id);
create index if not exists idx_equipment_status on public.equipment (status);
create index if not exists idx_equipment_assignments_equipment_id on public.equipment_assignments (equipment_id);
create index if not exists idx_equipment_assignments_project_id on public.equipment_assignments (project_id);

alter table public.equipment_assignments enable row level security;

drop policy if exists "Admins can view equipment assignments" on public.equipment_assignments;
create policy "Admins can view equipment assignments" on public.equipment_assignments
  for select using (public.get_my_role() = 'admin');
drop policy if exists "Admins can create equipment assignments" on public.equipment_assignments;
create policy "Admins can create equipment assignments" on public.equipment_assignments
  for insert with check (public.get_my_role() = 'admin');
drop policy if exists "Admins can update equipment assignments" on public.equipment_assignments;
create policy "Admins can update equipment assignments" on public.equipment_assignments
  for update using (public.get_my_role() = 'admin');
drop policy if exists "Admins can delete equipment assignments" on public.equipment_assignments;
create policy "Admins can delete equipment assignments" on public.equipment_assignments
  for delete using (public.get_my_role() = 'admin');

drop trigger if exists set_equipment_updated_at on public.equipment;
create trigger set_equipment_updated_at
  before update on public.equipment
  for each row execute function public.set_updated_at();

create table if not exists public.equipment_requests (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id) on delete cascade,
  task_id bigint references public.estimate_tasks (id) on delete set null,
  equipment_id bigint references public.equipment (id) on delete set null,
  equipment_name text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'fulfilled')),
  requested_by uuid not null references public.profiles (id) on delete restrict,
  needed_start_date date,
  needed_end_date date,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.equipment_usage (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id) on delete cascade,
  task_id bigint references public.estimate_tasks (id) on delete set null,
  equipment_id bigint references public.equipment (id) on delete set null,
  equipment_name text not null,
  hours_used numeric,
  cost numeric,
  usage_date date not null default current_date,
  recorded_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists idx_equipment_requests_project_id on public.equipment_requests (project_id);
create index if not exists idx_equipment_requests_task_id on public.equipment_requests (task_id);
create index if not exists idx_equipment_requests_status on public.equipment_requests (status);
create index if not exists idx_equipment_usage_project_id on public.equipment_usage (project_id);
create index if not exists idx_equipment_usage_task_id on public.equipment_usage (task_id);

alter table public.equipment enable row level security;
alter table public.equipment_requests enable row level security;
alter table public.equipment_usage enable row level security;

drop policy if exists "Admins can view equipment" on public.equipment;
create policy "Admins can view equipment" on public.equipment
  for select using (public.get_my_role() = 'admin');
drop policy if exists "Admins can create equipment" on public.equipment;
create policy "Admins can create equipment" on public.equipment
  for insert with check (public.get_my_role() = 'admin');
drop policy if exists "Admins can update equipment" on public.equipment;
create policy "Admins can update equipment" on public.equipment
  for update using (public.get_my_role() = 'admin');
drop policy if exists "Admins can delete equipment" on public.equipment;
create policy "Admins can delete equipment" on public.equipment
  for delete using (public.get_my_role() = 'admin');

drop policy if exists "Admins can view equipment requests" on public.equipment_requests;
create policy "Admins can view equipment requests" on public.equipment_requests
  for select using (public.get_my_role() = 'admin');
drop policy if exists "Admins can create equipment requests" on public.equipment_requests;
create policy "Admins can create equipment requests" on public.equipment_requests
  for insert with check (public.get_my_role() = 'admin');
drop policy if exists "Admins can update equipment requests" on public.equipment_requests;
create policy "Admins can update equipment requests" on public.equipment_requests
  for update using (public.get_my_role() = 'admin');
drop policy if exists "Admins can delete equipment requests" on public.equipment_requests;
create policy "Admins can delete equipment requests" on public.equipment_requests
  for delete using (public.get_my_role() = 'admin');

drop policy if exists "Admins can view equipment usage" on public.equipment_usage;
create policy "Admins can view equipment usage" on public.equipment_usage
  for select using (public.get_my_role() = 'admin');
drop policy if exists "Admins can create equipment usage" on public.equipment_usage;
create policy "Admins can create equipment usage" on public.equipment_usage
  for insert with check (public.get_my_role() = 'admin');
drop policy if exists "Admins can update equipment usage" on public.equipment_usage;
create policy "Admins can update equipment usage" on public.equipment_usage
  for update using (public.get_my_role() = 'admin');
drop policy if exists "Admins can delete equipment usage" on public.equipment_usage;
create policy "Admins can delete equipment usage" on public.equipment_usage
  for delete using (public.get_my_role() = 'admin');

drop trigger if exists set_equipment_requests_updated_at on public.equipment_requests;
create trigger set_equipment_requests_updated_at
  before update on public.equipment_requests
  for each row execute function public.set_updated_at();
