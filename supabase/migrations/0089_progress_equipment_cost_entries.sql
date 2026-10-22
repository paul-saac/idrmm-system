-- ============================================================================
-- Intent: store itemized equipment costs actually incurred on a task (or
-- task-less phase) on one Daily Progress Update — matched to planned Equipment
-- Cost lines by cost_name, or marked unplanned when added on the spot in
-- Today's log (e.g., rental, maintenance, repair, fuel).
--
-- One row per equipment cost item per update, deleted with its update (on
-- delete cascade) — saving an update replaces its rows.
--
-- Run this AFTER 0088_save_equipment_task_plans.sql.
-- ============================================================================

create table if not exists public.task_progress_equipment_cost_entries (
  id bigint generated always as identity primary key,
  progress_entry_id bigint not null
    references public.task_progress_entries (id) on delete cascade,
  cost_name text not null,
  amount numeric not null default 0 check (amount >= 0),
  unplanned boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_task_progress_equipment_cost_entries_entry_id
  on public.task_progress_equipment_cost_entries (progress_entry_id);

alter table public.task_progress_equipment_cost_entries enable row level security;

drop policy if exists "Admins can view task progress equipment cost entries"
  on public.task_progress_equipment_cost_entries;
create policy "Admins can view task progress equipment cost entries"
  on public.task_progress_equipment_cost_entries
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create task progress equipment cost entries"
  on public.task_progress_equipment_cost_entries;
create policy "Admins can create task progress equipment cost entries"
  on public.task_progress_equipment_cost_entries
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete task progress equipment cost entries"
  on public.task_progress_equipment_cost_entries;
create policy "Admins can delete task progress equipment cost entries"
  on public.task_progress_equipment_cost_entries
  for delete using (public.get_my_role() = 'admin');

drop policy if exists "Foremen can view task progress equipment cost entries"
  on public.task_progress_equipment_cost_entries;
create policy "Foremen can view task progress equipment cost entries"
  on public.task_progress_equipment_cost_entries
  for select using (public.is_task_progress_entry_foreman(progress_entry_id));

drop policy if exists "Foremen can create task progress equipment cost entries"
  on public.task_progress_equipment_cost_entries;
create policy "Foremen can create task progress equipment cost entries"
  on public.task_progress_equipment_cost_entries
  for insert with check (public.is_task_progress_entry_foreman(progress_entry_id));

drop policy if exists "Foremen can delete task progress equipment cost entries"
  on public.task_progress_equipment_cost_entries;
create policy "Foremen can delete task progress equipment cost entries"
  on public.task_progress_equipment_cost_entries
  for delete using (public.is_task_progress_entry_foreman(progress_entry_id));

create table if not exists public.category_progress_equipment_cost_entries (
  id bigint generated always as identity primary key,
  progress_entry_id bigint not null
    references public.category_progress_entries (id) on delete cascade,
  cost_name text not null,
  amount numeric not null default 0 check (amount >= 0),
  unplanned boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_category_progress_equipment_cost_entries_entry_id
  on public.category_progress_equipment_cost_entries (progress_entry_id);

alter table public.category_progress_equipment_cost_entries enable row level security;

drop policy if exists "Admins can view category progress equipment cost entries"
  on public.category_progress_equipment_cost_entries;
create policy "Admins can view category progress equipment cost entries"
  on public.category_progress_equipment_cost_entries
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create category progress equipment cost entries"
  on public.category_progress_equipment_cost_entries;
create policy "Admins can create category progress equipment cost entries"
  on public.category_progress_equipment_cost_entries
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete category progress equipment cost entries"
  on public.category_progress_equipment_cost_entries;
create policy "Admins can delete category progress equipment cost entries"
  on public.category_progress_equipment_cost_entries
  for delete using (public.get_my_role() = 'admin');

drop policy if exists "Foremen can view category progress equipment cost entries"
  on public.category_progress_equipment_cost_entries;
create policy "Foremen can view category progress equipment cost entries"
  on public.category_progress_equipment_cost_entries
  for select using (public.is_category_progress_entry_foreman(progress_entry_id));

drop policy if exists "Foremen can create category progress equipment cost entries"
  on public.category_progress_equipment_cost_entries;
create policy "Foremen can create category progress equipment cost entries"
  on public.category_progress_equipment_cost_entries
  for insert with check (public.is_category_progress_entry_foreman(progress_entry_id));

drop policy if exists "Foremen can delete category progress equipment cost entries"
  on public.category_progress_equipment_cost_entries;
create policy "Foremen can delete category progress equipment cost entries"
  on public.category_progress_equipment_cost_entries
  for delete using (public.is_category_progress_entry_foreman(progress_entry_id));

alter table public.progress_override_logs
  add column if not exists equipment_costs jsonb not null default '[]'::jsonb;

