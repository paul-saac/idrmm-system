-- Team member categories (the Team page's tables), who employs them, and DD
-- optional link to the member's own login account, and every project
-- manager and foreman account on the Team.
--
--   category              — what they do: management (Project Manager,
--                           Foreman), professional (Engineers & Architects),
--                           skilled (the trades) or laborer. The title
--                           (trade) stays free text underneath it.
--   employment_type       — employee or subcontractor. A subcontracted
--                           electrician is still an Electrician, so this is
--                           its own column rather than a category.
--   subcontractor_company — the subcontractor's company, when one.
--   profile_id            — the member's own login account (a project
--                           manager's or foreman's), so the same person isn't
--                           typed in twice; at most one member per account.
--
-- Existing members get a category from their title. Every active project
-- manager and foreman account becomes a member — linked to a same-named
-- member already there, else added — and so does every one made from now
-- on (ensure_team_member, on profiles). team_assignments also lists the
-- projects those members run, so they read as Assigned while on one.
--
-- Run this AFTER 0062_cleanup.sql.

alter table public.workers
  add column if not exists category text not null default 'skilled',
  add column if not exists employment_type text not null default 'employee'
    check (employment_type in ('employee', 'subcontractor')),
  add column if not exists subcontractor_company text,
  add column if not exists profile_id uuid references public.profiles (id) on delete set null;

create unique index if not exists idx_workers_profile_id
  on public.workers (profile_id)
  where profile_id is not null;

alter table public.workers drop constraint if exists workers_category_check;

update public.workers
set category = case
  when trade ilike '%project manager%' or trade ilike '%foreman%' then 'management'
  when trade ilike '%engineer%' or trade ilike '%architect%' then 'professional'
  when trade ilike '%laborer%' or trade ilike '%helper%' then 'laborer'
  else 'skilled'
end;

alter table public.workers
  add constraint workers_category_check
  check (category in ('management', 'professional', 'skilled', 'laborer'));

-- ----------------------------------------------------------------------------
-- A project manager's or foreman's account on the Team: their member keeps
-- the account's name; without one, a same-named member nobody's linked yet
-- is taken to be them, else a new member is added. Inactive accounts and
-- every other role are left alone.
-- ----------------------------------------------------------------------------
create or replace function public.ensure_team_member(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_name text;
  v_title text;
  v_worker_id bigint;
begin
  select * into v_profile from public.profiles where id = p_profile_id;
  if not found
     or coalesce(v_profile.role::text, '') not in ('project_manager', 'foreman')
     or coalesce(v_profile.status::text, '') <> 'active' then
    return;
  end if;

  v_name := btrim(concat_ws(' ', btrim(v_profile.first_name), btrim(v_profile.last_name)));
  if v_name = '' then
    return;
  end if;
  v_title := case v_profile.role::text when 'project_manager' then 'Project Manager' else 'Foreman' end;

  update public.workers
     set full_name = v_name
   where profile_id = p_profile_id
     and full_name is distinct from v_name;
  if exists (select 1 from public.workers where profile_id = p_profile_id) then
    return;
  end if;

  select id into v_worker_id
    from public.workers
   where profile_id is null
     and lower(btrim(full_name)) = lower(v_name)
   order by id
   limit 1;

  if v_worker_id is not null then
    update public.workers
       set profile_id = p_profile_id,
           category = 'management',
           trade = coalesce(nullif(btrim(trade), ''), v_title)
     where id = v_worker_id;
    return;
  end if;

  insert into public.workers (full_name, trade, category, employment_type, profile_id)
  values (v_name, v_title, 'management', 'employee', p_profile_id);
end;
$$;

-- Only through the trigger below (and the catch-up after it).
revoke execute on function public.ensure_team_member(uuid) from public, anon, authenticated;

create or replace function public.profiles_ensure_team_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_team_member(new.id);
  return new;
end;
$$;

drop trigger if exists ensure_team_member on public.profiles;
create trigger ensure_team_member
  after insert or update of role, status, first_name, last_name on public.profiles
  for each row execute function public.profiles_ensure_team_member();

-- The accounts already there.
do $$
begin
  perform public.ensure_team_member(id)
  from public.profiles
  where role::text in ('project_manager', 'foreman');
end;
$$;

-- ----------------------------------------------------------------------------
-- team_assignments (0060), plus the projects a linked member runs as its
-- project manager or foreman — open until the project's completed or past
-- its end date, like any other assignment.
-- ----------------------------------------------------------------------------
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
  union all
  select w.id, 'project', p.id,
         case when w.profile_id = p.project_manager_id then 'Project Manager' else 'Foreman' end,
         p.id, p.project_name, p.status = 'completed',
         p.start_date, coalesce(p.actual_end_date, p.target_end_date)
  from projects p
  join workers w on w.profile_id in (p.project_manager_id, p.foreman_id)
  where get_my_role() in ('admin', 'foreman')
$$;
