-- ============================================================================
-- Projects: the central table everything else (cost estimates, progress,
-- materials, equipment, expenses) hangs off of via project_id.
--
-- Run this AFTER 0002_profiles_email.sql.
-- ============================================================================

create table if not exists public.projects (
  id bigint generated always as identity primary key,
  project_name text not null,
  description text,
  location text,
  status text not null default 'planning'
    check (status in ('planning', 'ongoing', 'completed')),

  project_manager_id uuid not null references public.profiles (id) on delete restrict,
  foreman_id uuid not null references public.profiles (id) on delete restrict,
  created_by uuid not null references public.profiles (id) on delete restrict,

  start_date date,
  target_end_date date,
  actual_end_date date,

  -- Money/estimate fields. estimated_cost and actual_expense are, for
  -- now, plain admin-editable numbers (matching the app's current Edit
  -- Project form) rather than derived from the cost-estimate/expenses
  -- tables below — wiring that up is a follow-on app change, not a
  -- database one.
  allocated_budget numeric,
  selling_price numeric,
  estimated_cost numeric,
  actual_expense numeric,
  progress_percent smallint not null default 0
    check (progress_percent between 0 and 100),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_projects_project_manager_id on public.projects (project_manager_id);
create index if not exists idx_projects_foreman_id on public.projects (foreman_id);
create index if not exists idx_projects_created_by on public.projects (created_by);
create index if not exists idx_projects_status on public.projects (status);

alter table public.projects enable row level security;

drop policy if exists "Admins can view all projects" on public.projects;
create policy "Admins can view all projects" on public.projects
  for select
  using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create projects" on public.projects;
create policy "Admins can create projects" on public.projects
  for insert
  with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can update projects" on public.projects;
create policy "Admins can update projects" on public.projects
  for update
  using (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete projects" on public.projects;
create policy "Admins can delete projects" on public.projects
  for delete
  using (public.get_my_role() = 'admin');

-- keep updated_at honest on every row change; reused by every other
-- table below that has an updated_at column.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_projects_updated_at on public.projects;
create trigger set_projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();
