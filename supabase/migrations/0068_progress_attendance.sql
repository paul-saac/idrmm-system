-- Labor cost from attendance: each member's daily rate, and who worked on DDD
-- a task (or task-less phase) each day — a full or half day — recorded
-- with that day's progress update. The day's labor cost is worked out
-- from it (rate × day) instead of typed in, and each attendance row keeps
-- the rate it was paid at, so a later raise never changes a past day.
-- Subcontractors (paid per contract) aren't counted this way.
--
-- Run this AFTER 0067_member_groups.sql.

alter table public.workers
  add column if not exists daily_rate numeric check (daily_rate >= 0);

-- ----------------------------------------------------------------------------
-- Attendance, one row per person per progress entry (task or phase, one
-- entry per day) — replaced wholesale whenever that day is saved again.
-- The name is a snapshot, so the record outlives a removed member.
-- ----------------------------------------------------------------------------
create table if not exists public.task_progress_attendance (
  id bigint generated always as identity primary key,
  progress_entry_id bigint not null references public.task_progress_entries (id) on delete cascade,
  worker_id bigint references public.workers (id) on delete set null,
  worker_name text not null,
  day_fraction numeric not null check (day_fraction in (0.5, 1)),
  daily_rate numeric not null default 0 check (daily_rate >= 0)
);

create index if not exists idx_task_progress_attendance_entry
  on public.task_progress_attendance (progress_entry_id);
create index if not exists idx_task_progress_attendance_worker
  on public.task_progress_attendance (worker_id);

create table if not exists public.category_progress_attendance (
  id bigint generated always as identity primary key,
  progress_entry_id bigint not null references public.category_progress_entries (id) on delete cascade,
  worker_id bigint references public.workers (id) on delete set null,
  worker_name text not null,
  day_fraction numeric not null check (day_fraction in (0.5, 1)),
  daily_rate numeric not null default 0 check (daily_rate >= 0)
);

create index if not exists idx_category_progress_attendance_entry
  on public.category_progress_attendance (progress_entry_id);
create index if not exists idx_category_progress_attendance_worker
  on public.category_progress_attendance (worker_id);

-- 0051's is_task_progress_entry_foreman, for a phase's entries.
create or replace function public.is_category_progress_entry_foreman(p_entry_id bigint)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.category_progress_entries e
    where e.id = p_entry_id and public.is_category_foreman(e.category_id)
  );
$$;

alter table public.task_progress_attendance enable row level security;
alter table public.category_progress_attendance enable row level security;

-- get_my_role() reads a super admin as 'admin' (0065).
drop policy if exists "Admins can view task attendance" on public.task_progress_attendance;
create policy "Admins can view task attendance" on public.task_progress_attendance
  for select using (public.get_my_role() = 'admin');
drop policy if exists "Admins can create task attendance" on public.task_progress_attendance;
create policy "Admins can create task attendance" on public.task_progress_attendance
  for insert with check (public.get_my_role() = 'admin');
drop policy if exists "Admins can delete task attendance" on public.task_progress_attendance;
create policy "Admins can delete task attendance" on public.task_progress_attendance
  for delete using (public.get_my_role() = 'admin');

drop policy if exists "Foremen can view task attendance" on public.task_progress_attendance;
create policy "Foremen can view task attendance" on public.task_progress_attendance
  for select using (public.is_task_progress_entry_foreman(progress_entry_id));
drop policy if exists "Foremen can create task attendance" on public.task_progress_attendance;
create policy "Foremen can create task attendance" on public.task_progress_attendance
  for insert with check (public.is_task_progress_entry_foreman(progress_entry_id));
drop policy if exists "Foremen can delete task attendance" on public.task_progress_attendance;
create policy "Foremen can delete task attendance" on public.task_progress_attendance
  for delete using (public.is_task_progress_entry_foreman(progress_entry_id));

drop policy if exists "Admins can view phase attendance" on public.category_progress_attendance;
create policy "Admins can view phase attendance" on public.category_progress_attendance
  for select using (public.get_my_role() = 'admin');
drop policy if exists "Admins can create phase attendance" on public.category_progress_attendance;
create policy "Admins can create phase attendance" on public.category_progress_attendance
  for insert with check (public.get_my_role() = 'admin');
drop policy if exists "Admins can delete phase attendance" on public.category_progress_attendance;
create policy "Admins can delete phase attendance" on public.category_progress_attendance
  for delete using (public.get_my_role() = 'admin');

drop policy if exists "Foremen can view phase attendance" on public.category_progress_attendance;
create policy "Foremen can view phase attendance" on public.category_progress_attendance
  for select using (public.is_category_progress_entry_foreman(progress_entry_id));
drop policy if exists "Foremen can create phase attendance" on public.category_progress_attendance;
create policy "Foremen can create phase attendance" on public.category_progress_attendance
  for insert with check (public.is_category_progress_entry_foreman(progress_entry_id));
drop policy if exists "Foremen can delete phase attendance" on public.category_progress_attendance;
create policy "Foremen can delete phase attendance" on public.category_progress_attendance
  for delete using (public.is_category_progress_entry_foreman(progress_entry_id));

-- ----------------------------------------------------------------------------
-- Where these people are already counted on a day — any project, other
-- than the task or phase being saved — so nobody's counted for more than
-- a full day. Security definer: a foreman sees only their own projects,
-- but a crew member can be counted on someone else's.
-- ----------------------------------------------------------------------------
create or replace function public.attendance_elsewhere(
  p_date date,
  p_worker_ids bigint[],
  p_task_id bigint,
  p_category_id bigint
)
returns table (worker_id bigint, day_fraction numeric, item_name text, project_name text)
language sql
stable
security definer
set search_path = public
as $$
  select a.worker_id, a.day_fraction, t.task_name, p.project_name
  from task_progress_attendance a
  join task_progress_entries e on e.id = a.progress_entry_id
  join estimate_tasks t on t.id = e.task_id
  join projects p on p.id = t.project_id
  where e.entry_date = p_date
    and a.worker_id = any (p_worker_ids)
    and (p_task_id is null or e.task_id <> p_task_id)
    and get_my_role() in ('admin', 'foreman')
  union all
  select a.worker_id, a.day_fraction, c.category_name, p.project_name
  from category_progress_attendance a
  join category_progress_entries e on e.id = a.progress_entry_id
  join estimate_categories c on c.id = e.category_id
  join projects p on p.id = c.project_id
  where e.entry_date = p_date
    and a.worker_id = any (p_worker_ids)
    and (p_category_id is null or e.category_id <> p_category_id)
    and get_my_role() in ('admin', 'foreman')
$$;

revoke execute on function public.attendance_elsewhere(date, bigint[], bigint, bigint) from public, anon;
grant execute on function public.attendance_elsewhere(date, bigint[], bigint, bigint) to authenticated;

-- ----------------------------------------------------------------------------
-- Each member's days worked per project (half days count as 0.5) — the
-- Team page's member profiles.
-- ----------------------------------------------------------------------------
create or replace function public.team_days_worked()
returns table (worker_id bigint, project_id bigint, project_name text, days numeric)
language sql
stable
security definer
set search_path = public
as $$
  select x.worker_id, x.project_id, x.project_name, sum(x.day_fraction)
  from (
    select a.worker_id, p.id as project_id, p.project_name, a.day_fraction
    from task_progress_attendance a
    join task_progress_entries e on e.id = a.progress_entry_id
    join estimate_tasks t on t.id = e.task_id
    join projects p on p.id = t.project_id
    union all
    select a.worker_id, p.id, p.project_name, a.day_fraction
    from category_progress_attendance a
    join category_progress_entries e on e.id = a.progress_entry_id
    join estimate_categories c on c.id = e.category_id
    join projects p on p.id = c.project_id
  ) x
  where x.worker_id is not null
    and get_my_role() in ('admin', 'project_manager')
  group by x.worker_id, x.project_id, x.project_name
$$;

revoke execute on function public.team_days_worked() from public, anon;
grant execute on function public.team_days_worked() to authenticated;
