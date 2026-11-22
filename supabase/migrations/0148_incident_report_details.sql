-- Intent: preserve structured people, incident types, injury and medical details
-- for task incident reports without changing historical incident records or access policies.
begin;
set local lock_timeout='5s';
alter table public.project_safety_incidents add column details jsonb not null default '{}'::jsonb
 constraint incident_details_object check (jsonb_typeof(details)='object');
notify pgrst,'reload schema';
commit;
