-- The company Team (the admin's Team page): workers becomes one D
-- company-wide roster instead of one per project. Members are added and
-- removed there, with a role (trade) and a skillset; tasks and phases are
-- assigned straight from it (the Gantt chart's Members button is gone),
-- and a member is Assigned while on any task or phase that hasn't ended
-- yet (team_open_assignments below), Available otherwise.
--
-- Existing per-project rosters are merged: workers sharing a name (case-
-- and space-insensitive) become one member — the earliest row — with
-- every task/phase assignment moved over to it.
--
-- Run this AFTER 0058_category_material_lines.sql.

alter table public.workers
  add column if not exists skills text[] not null default '{}';

-- 1. Merge same-named workers into the earliest one.
insert into public.task_worker_assignments (task_id, worker_id)
select a.task_id, m.keep_id
from public.task_worker_assignments a
join (
  select id, first_value(id) over (partition by lower(btrim(full_name)) order by id) as keep_id
  from public.workers
) m on m.id = a.worker_id
where m.id <> m.keep_id
on conflict (task_id, worker_id) do nothing;

insert into public.category_worker_assignments (category_id, worker_id)
select a.category_id, m.keep_id
from public.category_worker_assignments a
join (
  select id, first_value(id) over (partition by lower(btrim(full_name)) order by id) as keep_id
  from public.workers
) m on m.id = a.worker_id
where m.id <> m.keep_id
on conflict (category_id, worker_id) do nothing;

-- The kept row takes a role from any of its copies if it has none.
update public.workers w
set trade = r.trade
from (
  select distinct on (lower(btrim(full_name))) lower(btrim(full_name)) as name_key, trade
  from public.workers
  where btrim(coalesce(trade, '')) <> ''
  order by lower(btrim(full_name)), id
) r
where lower(btrim(w.full_name)) = r.name_key
  and btrim(coalesce(w.trade, '')) = '';

-- Their old assignments go with them (on delete cascade) — already copied.
delete from public.workers w
using (
  select id, first_value(id) over (partition by lower(btrim(full_name)) order by id) as keep_id
  from public.workers
) m
where w.id = m.id and m.id <> m.keep_id;

-- 2. No longer scoped to a project. The foreman policies keyed on
-- project_id (0051) go first — they depend on the column.
drop policy if exists "Foremen can view workers" on public.workers;
drop policy if exists "Foremen can create workers" on public.workers;
drop policy if exists "Foremen can update workers" on public.workers;
drop policy if exists "Foremen can delete workers" on public.workers;
alter table public.workers drop column if exists project_id;

-- Admins manage the Team (their 0038 policies stand); foremen see it, to
-- assign members to tasks on their own projects.
drop policy if exists "Foremen can view the team" on public.workers;
create policy "Foremen can view the team" on public.workers
  for select using (public.get_my_role() = 'foreman');

-- 3. Every member's open assignments: a task or phase that hasn't ended
-- (no end date yet, or one on/after p_today) on a project that isn't
-- completed. A phase with no dates of its own spans its tasks'. Security
-- definer so a foreman also sees a member's assignments on other
-- projects (just names and dates), which their own RLS would hide.
create or replace function public.team_open_assignments(p_today date)
returns table (
  worker_id bigint,
  item_kind text,
  item_id bigint,
  item_name text,
  project_id bigint,
  project_name text,
  start_date date,
  end_date date
)
language sql
stable
security definer
set search_path = public
as $$
  select a.worker_id, 'task', t.id, t.task_name, p.id, p.project_name,
         t.planned_start_date, t.planned_end_date
  from task_worker_assignments a
  join estimate_tasks t on t.id = a.task_id
  join projects p on p.id = t.project_id
  where get_my_role() in ('admin', 'foreman')
    and p.status <> 'completed'
    and (t.planned_end_date is null or t.planned_end_date >= p_today)
  union all
  select a.worker_id, 'category', c.id, c.category_name, p.id, p.project_name,
         s.start_date, s.end_date
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
    and p.status <> 'completed'
    and (s.end_date is null or s.end_date >= p_today)
$$;

grant execute on function public.team_open_assignments(date) to authenticated;
