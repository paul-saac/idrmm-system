-- ============================================================================
-- Gantt Chart planning additions, requested after the adviser review:
--
--   1. estimate_tasks.priority — a scheduling priority level (Low/Medium/
--      High), separate from estimate_tasks.weight (which is a cost-
--      distribution % used throughout the EVM/progress calculations).
--      Deliberately its own column, not a reuse of weight — conflating
--      the two would silently corrupt every place that reads weight for
--      cost purposes.
--
--   2. estimate_task_material_assignments — materials *planned* for a
--      task ahead of time, from the Gantt Chart's own task form. This is
--      a different concept from daily_log_material_usage_items /
--      daily_log_material_procurement_items, which record what was
--      *actually* used/procured after the fact, on a specific day. A
--      planned assignment isn't tied to a specific project_materials
--      stock row (same reasoning as daily_log_material_procurement_items'
--      own free-text material_name — the material may not exist in the
--      catalog yet at planning time).
--
--   3. estimate_task_labor_assignments — manpower *planned* for a task
--      ahead of time, same relationship to daily_log_labor_items as #2
--      has to the material usage/procurement tables.
--
-- Run this AFTER 0034_daily_log_survey_defaults.sql.
-- ============================================================================

alter table public.estimate_tasks
  add column if not exists priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high'));

create table if not exists public.estimate_task_material_assignments (
  id bigint generated always as identity primary key,
  task_id bigint not null references public.estimate_tasks (id) on delete cascade,
  material_name text not null,
  specification text,
  planned_quantity numeric not null default 0,
  unit text,
  created_at timestamptz not null default now()
);

create index if not exists idx_estimate_task_material_assignments_task_id
  on public.estimate_task_material_assignments (task_id);

alter table public.estimate_task_material_assignments enable row level security;

drop policy if exists "Admins can view task material assignments" on public.estimate_task_material_assignments;
create policy "Admins can view task material assignments" on public.estimate_task_material_assignments
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create task material assignments" on public.estimate_task_material_assignments;
create policy "Admins can create task material assignments" on public.estimate_task_material_assignments
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can update task material assignments" on public.estimate_task_material_assignments;
create policy "Admins can update task material assignments" on public.estimate_task_material_assignments
  for update using (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete task material assignments" on public.estimate_task_material_assignments;
create policy "Admins can delete task material assignments" on public.estimate_task_material_assignments
  for delete using (public.get_my_role() = 'admin');

create table if not exists public.estimate_task_labor_assignments (
  id bigint generated always as identity primary key,
  task_id bigint not null references public.estimate_tasks (id) on delete cascade,
  worker_role text not null,
  planned_worker_count numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_estimate_task_labor_assignments_task_id
  on public.estimate_task_labor_assignments (task_id);

alter table public.estimate_task_labor_assignments enable row level security;

drop policy if exists "Admins can view task labor assignments" on public.estimate_task_labor_assignments;
create policy "Admins can view task labor assignments" on public.estimate_task_labor_assignments
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create task labor assignments" on public.estimate_task_labor_assignments;
create policy "Admins can create task labor assignments" on public.estimate_task_labor_assignments
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can update task labor assignments" on public.estimate_task_labor_assignments;
create policy "Admins can update task labor assignments" on public.estimate_task_labor_assignments
  for update using (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete task labor assignments" on public.estimate_task_labor_assignments;
create policy "Admins can delete task labor assignments" on public.estimate_task_labor_assignments
  for delete using (public.get_my_role() = 'admin');
