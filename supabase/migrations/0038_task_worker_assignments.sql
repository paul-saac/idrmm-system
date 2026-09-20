-- DONE
-- Manpower roster + per-task "Assigned" accountability, requested after the
-- adviser review: when a conflict happens on a task, there needs to be a
-- way to know exactly who to look for.
--
-- Deliberately separate from estimate_task_labor_assignments (migration
-- 0035) — that table is a role + headcount tally used for cost
-- estimation ("3x Electrician" for budgeting labor cost). This one holds
-- real names for accountability, a different purpose entirely; the two
-- are not merged.
--
-- workers is scoped per-project (not a company-wide directory) — it's
-- populated from the Gantt Chart's own "Manpower" toolbar button, one
-- project at a time. task_worker_assignments is a plain many-to-many:
-- one task can have several workers, and the same worker can appear on
-- several tasks.
--
-- Admin-only for now, same as every other table this app has — see
-- 0004_cost_estimates.sql for the exact RLS policy convention copied
-- below. No project_manager/foreman access yet (that's deferred, not
-- being built this round).
--
-- Run this AFTER 0037_gantt_undo_redo.sql.
-- ============================================================================

create table if not exists public.workers (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id) on delete cascade,
  full_name text not null,
  trade text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_workers_project_id on public.workers (project_id);

create table if not exists public.task_worker_assignments (
  id bigint generated always as identity primary key,
  task_id bigint not null references public.estimate_tasks (id) on delete cascade,
  worker_id bigint not null references public.workers (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (task_id, worker_id)
);

create index if not exists idx_task_worker_assignments_task_id
  on public.task_worker_assignments (task_id);
create index if not exists idx_task_worker_assignments_worker_id
  on public.task_worker_assignments (worker_id);

alter table public.workers enable row level security;
alter table public.task_worker_assignments enable row level security;

drop policy if exists "Admins can view workers" on public.workers;
create policy "Admins can view workers" on public.workers
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create workers" on public.workers;
create policy "Admins can create workers" on public.workers
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can update workers" on public.workers;
create policy "Admins can update workers" on public.workers
  for update using (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete workers" on public.workers;
create policy "Admins can delete workers" on public.workers
  for delete using (public.get_my_role() = 'admin');

drop policy if exists "Admins can view task worker assignments" on public.task_worker_assignments;
create policy "Admins can view task worker assignments" on public.task_worker_assignments
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create task worker assignments" on public.task_worker_assignments;
create policy "Admins can create task worker assignments" on public.task_worker_assignments
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete task worker assignments" on public.task_worker_assignments;
create policy "Admins can delete task worker assignments" on public.task_worker_assignments
  for delete using (public.get_my_role() = 'admin');
