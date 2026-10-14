-- A Team member's own details for the Team page's profile — a contact DD
-- number and the date they were hired — and every assignment a member has
-- had, not just the open ones, for that profile's list. Skills (0059) are
-- dropped: a member's title (the trade column) says enough.
--
-- Run this AFTER 0059_company_team.sql.

alter table public.workers
  add column if not exists contact_number text,
  add column if not exists date_hired date,
  drop column if exists skills;

-- Every task/phase assignment on any project, with what decides whether
-- it's still open (a completed project, or an end date before today) —
-- replaces team_open_assignments (0059), which only returned the open
-- ones. Same access as before: admins and foremen, security definer so a
-- foreman also sees a member's assignments on other projects.
drop function if exists public.team_open_assignments(date);

create or replace function public.team_assignments()
returns table (
  worker_id bigint,
  item_kind text,
  item_id bigint,
  item_name text,
  project_id bigint,
  project_name text,
  project_completed boolean,
  start_date date,
  end_date date
)
language sql
stable
security definer
set search_path = public
as $$
  select a.worker_id, 'task', t.id, t.task_name, p.id, p.project_name,
         p.status = 'completed', t.planned_start_date, t.planned_end_date
  from task_worker_assignments a
  join estimate_tasks t on t.id = a.task_id
  join projects p on p.id = t.project_id
  where get_my_role() in ('admin', 'foreman')
  union all
  select a.worker_id, 'category', c.id, c.category_name, p.id, p.project_name,
         p.status = 'completed', s.start_date, s.end_date
  from category_worker_assignments a
  join estimate_categories c on c.id = a.category_id
  join projects p on p.id = c.project_id
  cross join lateral (
    select coalesce(c.planned_start_date, min(t.planned_start_date)) as start_date,
           coalesce(c.planned_end_date, max(t.planned_end_date)) as end_date
    from estimate_tasks t
    where t.category_id = c.id
  ) s
  where get_my_role() in ('admin', 'foreman')
$$;

grant execute on function public.team_assignments() to authenticated;
