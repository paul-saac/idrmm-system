-- ============================================================================ DDD
-- Override history: every saved or deleted Daily Progress Update kept as 
-- its own row — who did it (their name as it was then), exactly when,
-- and what was entered: quantity, costs, materials used and who worked.
-- A day's re-saves stack here instead of replacing each other, for
-- accountability.
--
-- Progress itself still reads task_progress_entries /
-- category_progress_entries (one per day — its latest save); this is the
-- log beside them. Append-only: no update or delete policies, so nobody
-- can rewrite or remove history through the app.
--
-- Run this AFTER 0070_category_progress_material_entries.sql.
-- ============================================================================

create table if not exists public.progress_override_logs (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id) on delete cascade,
  task_id bigint references public.estimate_tasks (id) on delete cascade,
  category_id bigint references public.estimate_categories (id) on delete cascade,
  -- The day the update is for (saves are always today's; a delete can be
  -- of an earlier day).
  entry_date date not null,
  action text not null check (action in ('saved', 'deleted')),
  quantity_completed numeric not null default 0,
  labor_cost numeric not null default 0,
  material_cost numeric not null default 0,
  equipment_cost numeric not null default 0,
  other_cost numeric not null default 0,
  -- [{ "name", "unit", "quantity" }]
  materials_used jsonb not null default '[]'::jsonb,
  -- [{ "name", "hours", "rate" }]
  attendance jsonb not null default '[]'::jsonb,
  saved_by uuid references public.profiles (id) on delete set null,
  saved_by_name text,
  created_at timestamptz not null default now(),
  constraint progress_override_logs_one_item check ((task_id is null) <> (category_id is null))
);

create index if not exists idx_progress_override_logs_task
  on public.progress_override_logs (task_id, created_at desc);
create index if not exists idx_progress_override_logs_category
  on public.progress_override_logs (category_id, created_at desc);

alter table public.progress_override_logs enable row level security;

-- Admins (super admins too — get_my_role() reads them as 'admin', 0065)
-- and the project's own foreman.
drop policy if exists "Admins and the project's foreman can view override logs"
  on public.progress_override_logs;
create policy "Admins and the project's foreman can view override logs"
  on public.progress_override_logs
  for select using (public.get_my_role() = 'admin' or public.is_project_foreman(project_id));

-- Written by the app as the signed-in user, and only in their own name.
drop policy if exists "Admins and the project's foreman can add override logs"
  on public.progress_override_logs;
create policy "Admins and the project's foreman can add override logs"
  on public.progress_override_logs
  for insert with check (
    saved_by = auth.uid()
    and (public.get_my_role() = 'admin' or public.is_project_foreman(project_id))
  );

-- Updates saved before this, so the history doesn't start empty: one
-- "saved" row each, timed when it was first saved (earlier re-saves
-- weren't kept), with its materials used and who worked. Skips any day
-- already in the history, so running this again adds nothing.
insert into public.progress_override_logs (
  project_id, task_id, entry_date, action, quantity_completed, labor_cost,
  material_cost, equipment_cost, other_cost, materials_used, attendance,
  saved_by, saved_by_name, created_at
)
select t.project_id, e.task_id, e.entry_date, 'saved',
       coalesce(e.quantity_completed, 0), coalesce(e.labor_cost, 0),
       coalesce(e.material_cost, 0), coalesce(e.equipment_cost, 0), coalesce(e.other_cost, 0),
       coalesce((select jsonb_agg(jsonb_build_object(
                  'name', m.material_name, 'unit', m.unit, 'quantity', m.quantity_used))
                   from public.task_progress_material_entries m
                  where m.progress_entry_id = e.id), '[]'::jsonb),
       coalesce((select jsonb_agg(jsonb_build_object(
                  'name', a.worker_name, 'hours', a.hours, 'rate', a.hourly_rate))
                   from public.task_progress_attendance a
                  where a.progress_entry_id = e.id), '[]'::jsonb),
       e.recorded_by, nullif(btrim(p.first_name || ' ' || p.last_name), ''), e.created_at
  from public.task_progress_entries e
  join public.estimate_tasks t on t.id = e.task_id
  left join public.profiles p on p.id = e.recorded_by
 where not exists (select 1 from public.progress_override_logs l
                    where l.task_id = e.task_id and l.entry_date = e.entry_date);

insert into public.progress_override_logs (
  project_id, category_id, entry_date, action, quantity_completed, labor_cost,
  material_cost, equipment_cost, other_cost, materials_used, attendance,
  saved_by, saved_by_name, created_at
)
select c.project_id, e.category_id, e.entry_date, 'saved',
       coalesce(e.quantity_completed, 0), coalesce(e.labor_cost, 0),
       coalesce(e.material_cost, 0), coalesce(e.equipment_cost, 0), coalesce(e.other_cost, 0),
       coalesce((select jsonb_agg(jsonb_build_object(
                  'name', m.material_name, 'unit', m.unit, 'quantity', m.quantity_used))
                   from public.category_progress_material_entries m
                  where m.progress_entry_id = e.id), '[]'::jsonb),
       coalesce((select jsonb_agg(jsonb_build_object(
                  'name', a.worker_name, 'hours', a.hours, 'rate', a.hourly_rate))
                   from public.category_progress_attendance a
                  where a.progress_entry_id = e.id), '[]'::jsonb),
       e.recorded_by, nullif(btrim(p.first_name || ' ' || p.last_name), ''), e.created_at
  from public.category_progress_entries e
  join public.estimate_categories c on c.id = e.category_id
  left join public.profiles p on p.id = e.recorded_by
 where not exists (select 1 from public.progress_override_logs l
                    where l.category_id = e.category_id and l.entry_date = e.entry_date);
