-- ============================================================================
-- Materials: not built in the app UI yet — this is the database
-- foundation for it. Three tables:
--   materials          a shared catalog so names stay standardized
--                       across projects (e.g. always "Portland Cement",
--                       never a mix of "cement"/"Cement"/"portland cmt")
--   material_requests  the request/approval workflow shown on the Admin
--                       Dashboard mockup ("Material Request - Portland
--                       Cement... For Foundation Works phase")
--   material_usage     actual consumption once approved/fulfilled — the
--                       source of "material expenses"
--
-- Run this AFTER 0005_progress_tracking.sql.
-- ============================================================================

create table if not exists public.materials (
  id bigint generated always as identity primary key,
  name text not null unique,
  default_unit text,
  created_at timestamptz not null default now()
);

create table if not exists public.material_requests (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id) on delete cascade,
  task_id bigint references public.estimate_tasks (id) on delete set null,
  material_id bigint references public.materials (id) on delete set null,
  material_name text not null,
  quantity_requested numeric not null default 0,
  unit text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'fulfilled')),
  requested_by uuid not null references public.profiles (id) on delete restrict,
  needed_by_date date,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.material_usage (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id) on delete cascade,
  task_id bigint references public.estimate_tasks (id) on delete set null,
  material_id bigint references public.materials (id) on delete set null,
  material_name text not null,
  quantity_used numeric not null default 0,
  unit text,
  unit_cost numeric,
  total_cost numeric,
  used_date date not null default current_date,
  recorded_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists idx_material_requests_project_id on public.material_requests (project_id);
create index if not exists idx_material_requests_task_id on public.material_requests (task_id);
create index if not exists idx_material_requests_status on public.material_requests (status);
create index if not exists idx_material_usage_project_id on public.material_usage (project_id);
create index if not exists idx_material_usage_task_id on public.material_usage (task_id);

alter table public.materials enable row level security;
alter table public.material_requests enable row level security;
alter table public.material_usage enable row level security;

-- Admin-only for now — same caveat as progress tracking: Foreman/PM
-- policies belong here once those dashboards exist.
drop policy if exists "Admins can view materials" on public.materials;
create policy "Admins can view materials" on public.materials
  for select using (public.get_my_role() = 'admin');
drop policy if exists "Admins can manage materials" on public.materials;
create policy "Admins can manage materials" on public.materials
  for insert with check (public.get_my_role() = 'admin');
drop policy if exists "Admins can update materials" on public.materials;
create policy "Admins can update materials" on public.materials
  for update using (public.get_my_role() = 'admin');
drop policy if exists "Admins can delete materials" on public.materials;
create policy "Admins can delete materials" on public.materials
  for delete using (public.get_my_role() = 'admin');

drop policy if exists "Admins can view material requests" on public.material_requests;
create policy "Admins can view material requests" on public.material_requests
  for select using (public.get_my_role() = 'admin');
drop policy if exists "Admins can create material requests" on public.material_requests;
create policy "Admins can create material requests" on public.material_requests
  for insert with check (public.get_my_role() = 'admin');
drop policy if exists "Admins can update material requests" on public.material_requests;
create policy "Admins can update material requests" on public.material_requests
  for update using (public.get_my_role() = 'admin');
drop policy if exists "Admins can delete material requests" on public.material_requests;
create policy "Admins can delete material requests" on public.material_requests
  for delete using (public.get_my_role() = 'admin');

drop policy if exists "Admins can view material usage" on public.material_usage;
create policy "Admins can view material usage" on public.material_usage
  for select using (public.get_my_role() = 'admin');
drop policy if exists "Admins can create material usage" on public.material_usage;
create policy "Admins can create material usage" on public.material_usage
  for insert with check (public.get_my_role() = 'admin');
drop policy if exists "Admins can update material usage" on public.material_usage;
create policy "Admins can update material usage" on public.material_usage
  for update using (public.get_my_role() = 'admin');
drop policy if exists "Admins can delete material usage" on public.material_usage;
create policy "Admins can delete material usage" on public.material_usage
  for delete using (public.get_my_role() = 'admin');

drop trigger if exists set_material_requests_updated_at on public.material_requests;
create trigger set_material_requests_updated_at
  before update on public.material_requests
  for each row execute function public.set_updated_at();
