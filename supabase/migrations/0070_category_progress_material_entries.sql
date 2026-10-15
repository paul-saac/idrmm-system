-- ============================================================================
-- Materials actually used on a task-less phase (category) on one Daily
-- Progress Update — same as task_progress_material_entries
-- (0050_task_progress_material_entries.sql), one level up. A phase can
-- have its own Material Breakdown lines (0058_category_material_lines.sql),
-- so its update logs what was used of them, the way a task's does.
--
-- One row per material per update, deleted with its update (on delete
-- cascade) — saving an update replaces its rows.
--
-- Run this AFTER 0069_hourly_rates_work_hours.sql.
-- ============================================================================

create table if not exists public.category_progress_material_entries (
  id bigint generated always as identity primary key,
  progress_entry_id bigint not null
    references public.category_progress_entries (id) on delete cascade,
  material_name text not null,
  unit text,
  quantity_used numeric not null default 0 check (quantity_used >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_category_progress_material_entries_entry_id
  on public.category_progress_material_entries (progress_entry_id);

alter table public.category_progress_material_entries enable row level security;

-- Admins (super admins too — get_my_role() reads them as 'admin', 0065).
drop policy if exists "Admins can view category progress material entries"
  on public.category_progress_material_entries;
create policy "Admins can view category progress material entries"
  on public.category_progress_material_entries
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create category progress material entries"
  on public.category_progress_material_entries;
create policy "Admins can create category progress material entries"
  on public.category_progress_material_entries
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete category progress material entries"
  on public.category_progress_material_entries;
create policy "Admins can delete category progress material entries"
  on public.category_progress_material_entries
  for delete using (public.get_my_role() = 'admin');

-- The phase's own project foreman (is_category_progress_entry_foreman,
-- 0068_progress_attendance.sql).
drop policy if exists "Foremen can view category progress material entries"
  on public.category_progress_material_entries;
create policy "Foremen can view category progress material entries"
  on public.category_progress_material_entries
  for select using (public.is_category_progress_entry_foreman(progress_entry_id));

drop policy if exists "Foremen can create category progress material entries"
  on public.category_progress_material_entries;
create policy "Foremen can create category progress material entries"
  on public.category_progress_material_entries
  for insert with check (public.is_category_progress_entry_foreman(progress_entry_id));

drop policy if exists "Foremen can delete category progress material entries"
  on public.category_progress_material_entries;
create policy "Foremen can delete category progress material entries"
  on public.category_progress_material_entries
  for delete using (public.is_category_progress_entry_foreman(progress_entry_id));
