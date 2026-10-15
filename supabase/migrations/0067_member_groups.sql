-- Member groups — crews like "Mason Crew A" on the Team page (its Groups
-- tab), which the Gantt chart's Assign picker can put on a task all at
-- once. Someone can be in any number of groups. Admins, super admins and
-- project managers create and manage them; foremen see them, to assign a
-- crew on their own projects.
--
-- Project managers get the Team too (their portal's own Team page,
-- view-only for members): the workers list and team_assignments.
--
-- Run this AFTER 0066_account_management.sql.

create table if not exists public.member_groups (
  id bigint generated always as identity primary key,
  name text not null check (btrim(name) <> ''),
  description text,
  created_by uuid references public.profiles (id) on delete set null,
  -- A snapshot, so a project manager sees who made it without reading
  -- anyone else's profile.
  created_by_name text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_member_groups_name
  on public.member_groups (lower(btrim(name)));

create table if not exists public.member_group_members (
  group_id bigint not null references public.member_groups (id) on delete cascade,
  worker_id bigint not null references public.workers (id) on delete cascade,
  primary key (group_id, worker_id)
);

create index if not exists idx_member_group_members_worker
  on public.member_group_members (worker_id);

alter table public.member_groups enable row level security;
alter table public.member_group_members enable row level security;

-- get_my_role() reads a super admin as 'admin' (0065).
drop policy if exists "Team roles can view groups" on public.member_groups;
create policy "Team roles can view groups" on public.member_groups
  for select using (public.get_my_role() in ('admin', 'project_manager', 'foreman'));

drop policy if exists "Admins and PMs can create groups" on public.member_groups;
create policy "Admins and PMs can create groups" on public.member_groups
  for insert with check (public.get_my_role() in ('admin', 'project_manager'));

drop policy if exists "Admins and PMs can update groups" on public.member_groups;
create policy "Admins and PMs can update groups" on public.member_groups
  for update using (public.get_my_role() in ('admin', 'project_manager'));

drop policy if exists "Admins and PMs can delete groups" on public.member_groups;
create policy "Admins and PMs can delete groups" on public.member_groups
  for delete using (public.get_my_role() in ('admin', 'project_manager'));

drop policy if exists "Team roles can view group members" on public.member_group_members;
create policy "Team roles can view group members" on public.member_group_members
  for select using (public.get_my_role() in ('admin', 'project_manager', 'foreman'));

drop policy if exists "Admins and PMs can add group members" on public.member_group_members;
create policy "Admins and PMs can add group members" on public.member_group_members
  for insert with check (public.get_my_role() in ('admin', 'project_manager'));

drop policy if exists "Admins and PMs can remove group members" on public.member_group_members;
create policy "Admins and PMs can remove group members" on public.member_group_members
  for delete using (public.get_my_role() in ('admin', 'project_manager'));

-- ----------------------------------------------------------------------------
-- Project managers see the Team.
-- ----------------------------------------------------------------------------
drop policy if exists "Project managers can view the team" on public.workers;
create policy "Project managers can view the team" on public.workers
  for select using (public.get_my_role() = 'project_manager');

-- team_assignments (0063), now for project managers too.
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
  where get_my_role() in ('admin', 'foreman', 'project_manager')
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
  where get_my_role() in ('admin', 'foreman', 'project_manager')
  union all
  select w.id, 'project', p.id,
         case when w.profile_id = p.project_manager_id then 'Project Manager' else 'Foreman' end,
         p.id, p.project_name, p.status = 'completed',
         p.start_date, coalesce(p.actual_end_date, p.target_end_date)
  from projects p
  join workers w on w.profile_id in (p.project_manager_id, p.foreman_id)
  where get_my_role() in ('admin', 'foreman', 'project_manager')
$$;
