-- Lets a category (phase) have its own assigned workers directly, same
-- reasoning as 0038_task_worker_assignments.sql one level up — a phase
-- with no tasks yet (or work that genuinely belongs to the phase as a
-- whole, e.g. site mobilization crew) still needs a way to know who to
-- look for, the same accountability reasoning that drove the Members/
-- task-assignment feature in the first place.
--
-- Deliberately a separate table from task_worker_assignments rather
-- than a nullable task_id/category_id pair on one shared table — same
-- reasoning as every other "same idea, one level up" table this session
-- (material_direct_*, category_material_estimate, planned_start_date/
-- planned_end_date all live on estimate_categories directly rather than
-- a shared nullable-FK table with estimate_tasks).
--
-- Run this AFTER 0044_category_schedule.sql.

create table if not exists public.category_worker_assignments (
  id bigint generated always as identity primary key,
  category_id bigint not null references public.estimate_categories (id) on delete cascade,
  worker_id bigint not null references public.workers (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (category_id, worker_id)
);

create index if not exists idx_category_worker_assignments_category_id
  on public.category_worker_assignments (category_id);
create index if not exists idx_category_worker_assignments_worker_id
  on public.category_worker_assignments (worker_id);

alter table public.category_worker_assignments enable row level security;

drop policy if exists "Admins can view category worker assignments" on public.category_worker_assignments;
create policy "Admins can view category worker assignments" on public.category_worker_assignments
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create category worker assignments" on public.category_worker_assignments;
create policy "Admins can create category worker assignments" on public.category_worker_assignments
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete category worker assignments" on public.category_worker_assignments;
create policy "Admins can delete category worker assignments" on public.category_worker_assignments
  for delete using (public.get_my_role() = 'admin');
