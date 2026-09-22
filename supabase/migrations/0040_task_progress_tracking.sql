-- Task Progress Tracking — the Gantt Chart's own two-mechanism progress
-- system:
--
--  1. Automatic Progress Completion — a task's percent complete
--     advances on its own, day by day, based purely on its planned
--     schedule (how many *working* days have elapsed out of the task's
--     own total working days) — computed live in lib/task-progress/
--     calculate.ts, never stored.
--  2. Progress Tracking Override — clicking a task's own bar on the
--     Gantt Chart opens a modal where the admin records what actually
--     happened *today*: quantity completed, materials consumed, labor
--     headcount. Saved here as one row per task per day. Automatic
--     progress for any day after the most recent override then
--     projects forward from that override's own cumulative standing,
--     not from the task's original start date — so a task that ran
--     ahead or behind schedule keeps reflecting that until corrected
--     again.
--
-- Deliberately independent of Daily Logs (daily_log_*) — a different,
-- separate "what happened today" ledger by explicit choice, not an
-- oversight; reconciling the two is a known open question, not solved
-- here.
--
-- Supersedes estimate_tasks.percent_complete (0039) as the actual
-- source of a task's own percent complete — that column is left in
-- place (untouched, no data loss) but the app itself stops reading or
-- writing it; every consumer (the Gantt Chart's own display, the phase-
-- row rollup, the delay-risk/EVM forecast) now gets a live-computed
-- value instead of a manually-typed one. The Percent Complete cell's
-- own free-typing is removed to match — the only way to change a
-- task's progress now is a real, dated Progress Tracking Override.
--
-- Run this AFTER 0039_estimate_task_percent_complete.sql.
-- ============================================================================

-- Which weekdays count toward Automatic Progress Completion's own
-- working-day math — ISO weekday numbers, 1=Monday..7=Sunday. Defaults
-- to a 6-day week (Mon-Sat), the common Philippine construction
-- schedule; editable per project from Edit Project.
alter table public.projects
  add column if not exists working_days integer[] not null default '{1,2,3,4,5,6}';

create table if not exists public.task_progress_entries (
  id bigint generated always as identity primary key,
  task_id bigint not null references public.estimate_tasks (id) on delete cascade,
  -- The calendar day this entry's own numbers happened on — always
  -- "today" at the moment it's recorded (see recordTaskProgress in
  -- lib/task-progress/actions.ts, which has no date picker; this isn't
  -- a historical backfill tool). Unique per task/day so resaving the
  -- same day's entry (correcting a mistake) updates it in place rather
  -- than creating a second entry for the same day.
  entry_date date not null,
  -- How much MORE quantity was completed on this specific day, not a
  -- running cumulative total — matching the same "quantity done today"
  -- shape lib/progress/data.ts's own (separate, Daily-Log-driven)
  -- calculation already uses for the same estimated_quantity
  -- denominator, summed across every entry up to a given date to get
  -- the cumulative standing Automatic Progress projects forward from.
  quantity_completed numeric not null default 0,
  -- How many workers were on this task this specific day — a plain
  -- headcount, not a pick from the Members/workers roster (see
  -- task_worker_assignments, 0038) — deliberately simpler, since this
  -- is one of three quick daily inputs, not its own roster-management
  -- feature.
  labor_headcount integer not null default 0 check (labor_headcount >= 0),
  recorded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (task_id, entry_date)
);

create index if not exists idx_task_progress_entries_task_id
  on public.task_progress_entries (task_id);

-- Materials consumed on one override entry's own day — a separate table
-- (not columns on task_progress_entries) since a single day can
-- reasonably consume several different materials. Each row is a real
-- project_materials.quantity deduction at save time (see
-- recordTaskProgress) — the actual Gantt <-> Materials page connection,
-- not just a logged number nobody else ever sees. Resaving the same
-- day's entry reverses its own prior deduction before applying the new
-- one, rather than double-deducting.
create table if not exists public.task_progress_material_usage (
  id bigint generated always as identity primary key,
  progress_entry_id bigint not null references public.task_progress_entries (id) on delete cascade,
  material_id bigint not null references public.project_materials (id) on delete cascade,
  quantity numeric not null default 0 check (quantity >= 0)
);

create index if not exists idx_task_progress_material_usage_entry_id
  on public.task_progress_material_usage (progress_entry_id);

alter table public.task_progress_entries enable row level security;
alter table public.task_progress_material_usage enable row level security;

-- Admin-only, same convention as every other table — see
-- 0004_cost_estimates.sql for the RLS policy convention copied below.
drop policy if exists "Admins can view task progress entries" on public.task_progress_entries;
create policy "Admins can view task progress entries" on public.task_progress_entries
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create task progress entries" on public.task_progress_entries;
create policy "Admins can create task progress entries" on public.task_progress_entries
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can update task progress entries" on public.task_progress_entries;
create policy "Admins can update task progress entries" on public.task_progress_entries
  for update using (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete task progress entries" on public.task_progress_entries;
create policy "Admins can delete task progress entries" on public.task_progress_entries
  for delete using (public.get_my_role() = 'admin');

drop policy if exists "Admins can view task progress material usage" on public.task_progress_material_usage;
create policy "Admins can view task progress material usage" on public.task_progress_material_usage
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create task progress material usage" on public.task_progress_material_usage;
create policy "Admins can create task progress material usage" on public.task_progress_material_usage
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete task progress material usage" on public.task_progress_material_usage;
create policy "Admins can delete task progress material usage" on public.task_progress_material_usage
  for delete using (public.get_my_role() = 'admin');
