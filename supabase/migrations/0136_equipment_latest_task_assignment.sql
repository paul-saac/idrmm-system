-- Intent: record the latest real task allocation time for the equipment catalog.
-- Existing rows stay NULL: a project checkout date or planned start date must
-- not be presented as the time a task allocation was created.
begin;
alter table public.equipment add column last_task_assigned_at timestamptz;
comment on column public.equipment.last_task_assigned_at is 'Latest recorded creation of a task allocation; NULL for legacy records without that information.';
create or replace function public._equipment_stamp_task_assignment()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update public.equipment set last_task_assigned_at=greatest(last_task_assigned_at,statement_timestamp()) where id=new.equipment_id;
 return new;
end $$;
create trigger equipment_task_assignment_timestamp after insert on public.equipment_task_plans
 for each row execute function public._equipment_stamp_task_assignment();
revoke all on function public._equipment_stamp_task_assignment() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
