-- Labor by the hour: a member's Default Rate is per hour (0068 had it per
-- day), and each member has their own Working Days — hours for each day
-- of the week, Monday to Sunday (e.g. 8,8,8,8,8,0,0). A day's attendance
-- on a task starts from that weekday's hours, and its labor cost is
-- hours × rate. Attendance records hours (0068 had a full or half day),
-- each row keeping the hourly rate it was paid at.
--
-- Converts what 0068 already holds: a daily rate becomes ÷ 8 per hour, a
-- full or half day 8 or 4 hours. Safe to run again.
--
-- Run this AFTER 0068_progress_attendance.sql.

-- ----------------------------------------------------------------------------
-- Members: a rate per hour, and their week (Monday first).
-- ----------------------------------------------------------------------------
alter table public.workers
  add column if not exists hourly_rate numeric check (hourly_rate >= 0),
  add column if not exists work_hours numeric[] not null default '{8,8,8,8,8,0,0}';

alter table public.workers drop constraint if exists workers_work_hours_check;
alter table public.workers
  add constraint workers_work_hours_check check (
    array_length(work_hours, 1) = 7
    and array_position(work_hours, null) is null
    and 0 <= all (work_hours)
    and 24 >= all (work_hours)
  );

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workers' and column_name = 'daily_rate'
  ) then
    update public.workers
    set hourly_rate = round(daily_rate / 8, 2)
    where hourly_rate is null and daily_rate is not null;
    alter table public.workers drop column daily_rate;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Attendance in hours.
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['task_progress_attendance', 'category_progress_attendance'] loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'day_fraction'
    ) then
      execute format('alter table public.%I add column if not exists hours numeric', t);
      execute format('alter table public.%I add column if not exists hourly_rate numeric', t);
      execute format(
        'update public.%I set hours = day_fraction * 8, hourly_rate = round(daily_rate / 8, 2)',
        t
      );
      execute format('alter table public.%I drop column day_fraction, drop column daily_rate', t);
    end if;
  end loop;
end;
$$;

alter table public.task_progress_attendance
  alter column hours set not null,
  alter column hourly_rate set not null,
  alter column hourly_rate set default 0;
alter table public.task_progress_attendance drop constraint if exists task_progress_attendance_hours_check;
alter table public.task_progress_attendance
  add constraint task_progress_attendance_hours_check check (hours > 0 and hours <= 24);
alter table public.task_progress_attendance drop constraint if exists task_progress_attendance_hourly_rate_check;
alter table public.task_progress_attendance
  add constraint task_progress_attendance_hourly_rate_check check (hourly_rate >= 0);

alter table public.category_progress_attendance
  alter column hours set not null,
  alter column hourly_rate set not null,
  alter column hourly_rate set default 0;
alter table public.category_progress_attendance drop constraint if exists category_progress_attendance_hours_check;
alter table public.category_progress_attendance
  add constraint category_progress_attendance_hours_check check (hours > 0 and hours <= 24);
alter table public.category_progress_attendance drop constraint if exists category_progress_attendance_hourly_rate_check;
alter table public.category_progress_attendance
  add constraint category_progress_attendance_hourly_rate_check check (hourly_rate >= 0);

-- ----------------------------------------------------------------------------
-- attendance_elsewhere (0068), in hours: nobody's counted more than 24
-- hours in a day across every task and phase, any project.
-- ----------------------------------------------------------------------------
drop function if exists public.attendance_elsewhere(date, bigint[], bigint, bigint);
create function public.attendance_elsewhere(
  p_date date,
  p_worker_ids bigint[],
  p_task_id bigint,
  p_category_id bigint
)
returns table (worker_id bigint, hours numeric, item_name text, project_name text)
language sql
stable
security definer
set search_path = public
as $$
  select a.worker_id, a.hours, t.task_name, p.project_name
  from task_progress_attendance a
  join task_progress_entries e on e.id = a.progress_entry_id
  join estimate_tasks t on t.id = e.task_id
  join projects p on p.id = t.project_id
  where e.entry_date = p_date
    and a.worker_id = any (p_worker_ids)
    and (p_task_id is null or e.task_id <> p_task_id)
    and get_my_role() in ('admin', 'foreman')
  union all
  select a.worker_id, a.hours, c.category_name, p.project_name
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
-- team_days_worked (0068) becomes hours worked, per member per project.
-- ----------------------------------------------------------------------------
drop function if exists public.team_days_worked();
create or replace function public.team_hours_worked()
returns table (worker_id bigint, project_id bigint, project_name text, hours numeric)
language sql
stable
security definer
set search_path = public
as $$
  select x.worker_id, x.project_id, x.project_name, sum(x.hours)
  from (
    select a.worker_id, p.id as project_id, p.project_name, a.hours
    from task_progress_attendance a
    join task_progress_entries e on e.id = a.progress_entry_id
    join estimate_tasks t on t.id = e.task_id
    join projects p on p.id = t.project_id
    union all
    select a.worker_id, p.id, p.project_name, a.hours
    from category_progress_attendance a
    join category_progress_entries e on e.id = a.progress_entry_id
    join estimate_categories c on c.id = e.category_id
    join projects p on p.id = c.project_id
  ) x
  where x.worker_id is not null
    and get_my_role() in ('admin', 'project_manager')
  group by x.worker_id, x.project_id, x.project_name
$$;

revoke execute on function public.team_hours_worked() from public, anon;
grant execute on function public.team_hours_worked() to authenticated;
