-- ============================================================================
-- daily_logs: the header row for a project's daily log — a foreman
-- submits one per date, a project manager or admin then approves or
-- rejects it.
--
-- Actual progress data lives on daily_log_work_items (0010, created
-- alongside Work Logs) — a task's completion % is derived from summing
-- "Quantity Completed" across every approved day's Work Log entries for
-- that task, divided by the task's estimated_quantity. That's why
-- estimate_tasks.weight (0004) is computed and stored rather than left
-- for display-time math only: it's what turns each task's % into its
-- share of overall project completion.
--
-- Run this AFTER 0004_cost_estimates.sql.
-- ============================================================================

create table if not exists public.daily_logs (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id) on delete cascade,
  submitted_by uuid not null references public.profiles (id) on delete restrict,
  log_date date not null default current_date,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  notes text,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_daily_logs_project_id on public.daily_logs (project_id);
create index if not exists idx_daily_logs_submitted_by on public.daily_logs (submitted_by);
create index if not exists idx_daily_logs_status on public.daily_logs (status);

alter table public.daily_logs enable row level security;

-- Admin-only for now, matching every other table so far — this will need
-- Project Manager (view/approve on their own projects) and Foreman
-- (submit on their own projects) policies added once those dashboards
-- are built; that access pattern isn't guessable yet without that code
-- to check it against.
drop policy if exists "Admins can view daily logs" on public.daily_logs;
create policy "Admins can view daily logs" on public.daily_logs
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create daily logs" on public.daily_logs;
create policy "Admins can create daily logs" on public.daily_logs
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can update daily logs" on public.daily_logs;
create policy "Admins can update daily logs" on public.daily_logs
  for update using (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete daily logs" on public.daily_logs;
create policy "Admins can delete daily logs" on public.daily_logs
  for delete using (public.get_my_role() = 'admin');

drop trigger if exists set_daily_logs_updated_at on public.daily_logs;
create trigger set_daily_logs_updated_at
  before update on public.daily_logs
  for each row execute function public.set_updated_at();
