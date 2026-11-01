-- Intent: automatically show verified national holidays and allow per-project working-day choices.
-- Sources: Proclamations 1006 (2026), 1427 (2027), 1189 and 1264 (2026 Eid dates).
-- https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/7/102791
-- 2027 Eid dates are intentionally absent until separately proclaimed.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
select pg_advisory_xact_lock(18244,7291);
do $$ begin
 if exists(select 1 from public.system_backup_state where maintenance or recovery_required) then
  raise exception 'Finish backup or recovery before applying calendar changes';
 end if;
end $$;
alter table public.project_events add column if not exists is_working_day boolean not null default false;
alter table public.project_events add column if not exists national_holiday boolean not null default false;
create unique index if not exists project_events_national_date_key on public.project_events(project_id,event_date) where national_holiday;

create or replace function public.philippine_holidays()
returns table(holiday_date date,holiday_name text,working_day boolean)
language sql immutable set search_path='' as $$
 values
    ('2026-01-01'::date, 'New Year''s Day'::text, false),
    ('2026-02-17'::date, 'Chinese New Year'::text, false),
    ('2026-02-25'::date, 'EDSA People Power Revolution Anniversary'::text, true),
    ('2026-03-20'::date, 'Eid''l Fitr'::text, false),
    ('2026-04-02'::date, 'Maundy Thursday'::text, false),
    ('2026-04-03'::date, 'Good Friday'::text, false),
    ('2026-04-04'::date, 'Black Saturday'::text, false),
    ('2026-04-09'::date, 'Araw ng Kagitingan'::text, false),
    ('2026-05-01'::date, 'Labor Day'::text, false),
    ('2026-05-27'::date, 'Eid''l Adha'::text, false),
    ('2026-06-12'::date, 'Independence Day'::text, false),
    ('2026-08-21'::date, 'Ninoy Aquino Day'::text, false),
    ('2026-08-31'::date, 'National Heroes Day'::text, false),
    ('2026-11-01'::date, 'All Saints'' Day'::text, false),
    ('2026-11-02'::date, 'All Souls'' Day'::text, false),
    ('2026-11-30'::date, 'Bonifacio Day'::text, false),
    ('2026-12-08'::date, 'Immaculate Conception'::text, false),
    ('2026-12-24'::date, 'Christmas Eve'::text, false),
    ('2026-12-25'::date, 'Christmas Day'::text, false),
    ('2026-12-30'::date, 'Rizal Day'::text, false),
    ('2026-12-31'::date, 'Last Day of the Year'::text, false),
    ('2027-01-01'::date, 'New Year''s Day'::text, false),
    ('2027-02-06'::date, 'Chinese New Year'::text, false),
    ('2027-02-25'::date, 'EDSA People Power Revolution Anniversary'::text, true),
    ('2027-03-25'::date, 'Maundy Thursday'::text, false),
    ('2027-03-26'::date, 'Good Friday'::text, false),
    ('2027-03-27'::date, 'Black Saturday'::text, false),
    ('2027-04-09'::date, 'Araw ng Kagitingan'::text, false),
    ('2027-05-01'::date, 'Labor Day'::text, false),
    ('2027-06-12'::date, 'Independence Day'::text, false),
    ('2027-08-21'::date, 'Ninoy Aquino Day'::text, false),
    ('2027-08-30'::date, 'National Heroes Day'::text, false),
    ('2027-11-01'::date, 'All Saints'' Day'::text, false),
    ('2027-11-02'::date, 'All Souls'' Day'::text, false),
    ('2027-11-30'::date, 'Bonifacio Day'::text, false),
    ('2027-12-08'::date, 'Immaculate Conception'::text, false),
    ('2027-12-24'::date, 'Christmas Eve'::text, false),
    ('2027-12-25'::date, 'Christmas Day'::text, false),
    ('2027-12-30'::date, 'Rizal Day'::text, false),
    ('2027-12-31'::date, 'Last Day of the Year'::text, false)
$$;

create or replace function public.sync_project_holidays()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_id bigint;
begin
 for v_id in select distinct x from unnest(case when tg_op='DELETE' then array[old.project_id]
   when tg_op='INSERT' then array[new.project_id] else array[old.project_id,new.project_id] end) x
 loop
  update public.projects p set holidays=coalesce((select array_agg(distinct e.event_date order by e.event_date)
   from public.project_events e where e.project_id=v_id and e.event_type='holiday' and not e.is_working_day),'{}'::date[])
   where p.id=v_id;
 end loop;
 return null;
end $$;
revoke all on function public.sync_project_holidays() from public,anon;

create or replace function public.seed_project_national_holidays()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.project_events(project_id,event_type,name,event_date,is_working_day,national_holiday)
 select new.id,'holiday',h.holiday_name,h.holiday_date,h.working_day,true from public.philippine_holidays() h
 on conflict(project_id,event_date) where national_holiday do nothing;
 return new;
end $$;
revoke all on function public.seed_project_national_holidays() from public,anon,authenticated;
create or replace trigger project_seed_national_holidays after insert on public.projects
 for each row execute function public.seed_project_national_holidays();

-- Preserve any existing manual day-off choices; avoid adding a duplicate chip
-- when a holiday already exists on the same date.
insert into public.project_events(project_id,event_type,name,event_date,is_working_day,national_holiday)
select p.id,'holiday',h.holiday_name,h.holiday_date,h.working_day,true
from public.projects p cross join public.philippine_holidays() h
where p.project_name <> 'Sunrise Villas – Phase 1'
 and not exists(select 1 from public.project_events e where e.project_id=p.id and e.event_type='holiday' and e.event_date=h.holiday_date)
on conflict(project_id,event_date) where national_holiday do nothing;
notify pgrst,'reload schema';
commit;
