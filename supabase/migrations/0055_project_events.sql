-- Project events: what's happening on a given day — a holiday, a DONEEE
-- meeting, a site inspection, a delivery, or anything else. Added from
-- the Gantt chart's Calendar view ("Add event").
--
--   event_type  — holiday | meeting | inspection | delivery | other
--   name        — e.g. "All Saints' Day", "Weekly site meeting"
--   event_date  — the day it happens on
--   start_time / end_time — meetings only (both set, end after start);
--                every other type has neither
--
-- Holidays: a holiday event is what marks a day off now. projects.
-- holidays (0053_project_holidays.sql) stays as the plain date list
-- Expected progress and planned labor read — kept in sync from this
-- table by the trigger below, so nothing that reads it has to change.
-- The holidays already set there are copied in as "Holiday" events.
--
-- Admins add/edit/remove events; a project's own foreman can see them
-- (same helper as 0051_foreman_project_access.sql).
--
-- Run this AFTER 0054_weight_overrides.sql.

create table if not exists public.project_events (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id) on delete cascade,
  event_type text not null
    check (event_type in ('holiday', 'meeting', 'inspection', 'delivery', 'other')),
  name text not null check (char_length(trim(name)) between 1 and 100),
  event_date date not null,
  start_time time,
  end_time time,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint project_events_meeting_times check (
    case
      when event_type = 'meeting'
        then start_time is not null and end_time is not null and end_time > start_time
      else start_time is null and end_time is null
    end
  )
);

create index if not exists idx_project_events_project_date
  on public.project_events (project_id, event_date);

alter table public.project_events enable row level security;

drop policy if exists "Admins can view project events" on public.project_events;
create policy "Admins can view project events" on public.project_events
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create project events" on public.project_events;
create policy "Admins can create project events" on public.project_events
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can update project events" on public.project_events;
create policy "Admins can update project events" on public.project_events
  for update using (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete project events" on public.project_events;
create policy "Admins can delete project events" on public.project_events
  for delete using (public.get_my_role() = 'admin');

drop policy if exists "Foremen can view their project's events" on public.project_events;
create policy "Foremen can view their project's events" on public.project_events
  for select using (public.is_project_foreman(project_id));

-- projects.holidays = every holiday event's date, after any change.
-- security definer so it can write projects whoever made the change.
create or replace function public.sync_project_holidays()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id bigint;
begin
  if tg_op = 'DELETE' then
    v_project_id := old.project_id;
  else
    v_project_id := new.project_id;
  end if;

  update public.projects p
     set holidays = coalesce(
       (select array_agg(distinct e.event_date order by e.event_date)
          from public.project_events e
         where e.project_id = v_project_id
           and e.event_type = 'holiday'),
       '{}'
     )
   where p.id = v_project_id;

  return null;
end;
$$;

revoke all on function public.sync_project_holidays() from public, anon;

drop trigger if exists project_events_sync_holidays on public.project_events;
create trigger project_events_sync_holidays
  after insert or update or delete on public.project_events
  for each row execute function public.sync_project_holidays();

-- Holidays already set on a project become "Holiday" events.
insert into public.project_events (project_id, event_type, name, event_date)
select p.id, 'holiday', 'Holiday', h.day
  from public.projects p
 cross join lateral unnest(p.holidays) as h(day)
 where not exists (
   select 1
     from public.project_events e
    where e.project_id = p.id
      and e.event_type = 'holiday'
      and e.event_date = h.day
 );
