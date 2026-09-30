-
Done
- Materials actually used on a task on one Progress Tracking Override
-- day, entered against that task's own planned material lines from
-- Material Breakdown (estimate_task_material_assignments) — the
-- override modal lists exactly those lines as predefined rows, so
-- "materials used" is always measured against what was planned for
-- this specific task, not the project's whole stock roster (which is
-- what task_progress_material_usage, 0040, pulled from and why it was
-- dropped from the modal).
--
-- Keyed by material_name + unit, deliberately NOT by
-- estimate_task_material_assignments.id: updateTaskMaterialAssignments
-- (lib/cost-estimate/actions.ts) deletes and reinserts a task's whole
-- material list on every Material Breakdown save, so an id-keyed FK
-- would cascade-delete (or orphan) every logged usage row the moment
-- the plan was edited. A name/unit match survives those re-saves; only
-- renaming a line breaks its link to earlier usage.
--
-- Run this AFTER 0049_progress_percent_override.sql.
-- ============================================================================

create table if not exists public.task_progress_material_entries (
  id bigint generated always as identity primary key,
  progress_entry_id bigint not null references public.task_progress_entries (id) on delete cascade,
  material_name text not null,
  unit text,
  quantity_used numeric not null default 0 check (quantity_used >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_task_progress_material_entries_entry_id
  on public.task_progress_material_entries (progress_entry_id);

alter table public.task_progress_material_entries enable row level security;

-- Admin-only, same convention as every other table — see
-- 0004_cost_estimates.sql for the RLS policy convention copied below.
drop policy if exists "Admins can view task progress material entries" on public.task_progress_material_entries;
create policy "Admins can view task progress material entries" on public.task_progress_material_entries
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create task progress material entries" on public.task_progress_material_entries;
create policy "Admins can create task progress material entries" on public.task_progress_material_entries
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete task progress material entries" on public.task_progress_material_entries;
create policy "Admins can delete task progress material entries" on public.task_progress_material_entries
  for delete using (public.get_my_role() = 'admin');
