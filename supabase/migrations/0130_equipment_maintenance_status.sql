-- Intent: let active administrators take equipment out of service and release
-- it after maintenance. Close checkout/task periods atomically, retain history
-- and planned task allocations, and reject stale or invalid transitions.
begin;

create or replace function public.set_equipment_service_status(
  p_equipment_id bigint, p_expected_status text, p_status text
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  asset public.equipment%rowtype;
  project_ids bigint[];
  changed_at timestamptz := now();
begin
  if auth.uid() is null or public.app_session_is_active() is not true
    or public.invitation_setup_complete() is not true
    or coalesce(public.get_my_role()::text,'') not in ('admin','super_admin') then
    raise exception 'Only administrators can change equipment maintenance status.' using errcode='42501';
  end if;
  if public.system_backup_maintenance() then
    raise exception 'Saving is temporarily paused.' using errcode='55000';
  end if;
  if p_equipment_id is null or p_equipment_id<=0 or p_status is null or p_expected_status is null
    or not ((p_status='maintenance' and p_expected_status in ('available','assigned'))
      or (p_status='available' and p_expected_status='maintenance')) then
    raise exception 'Choose a valid equipment status change.' using errcode='22023';
  end if;
  select * into asset from public.equipment where id=p_equipment_id for update;
  if not found then raise exception 'Equipment not found.' using errcode='P0002';end if;
  if asset.status is distinct from p_expected_status then
    raise exception 'This equipment has changed. Refresh and try again.' using errcode='40001';
  end if;

  perform id from public.equipment_assignments
    where equipment_id=asset.id and returned_at is null order by id for update;
  select coalesce(array_agg(distinct project_id),'{}'::bigint[]) into project_ids from (
    select project_id from public.equipment_assignments where equipment_id=asset.id and returned_at is null
    union select asset.current_project_id where asset.current_project_id is not null
  ) affected;

  -- Maintenance ends physical checkout, not the historical record or the
  -- future plan. Database project/session/backup triggers still apply.
  if p_status='maintenance' then
    update public.equipment_task_assignments t
      set released_at=greatest(changed_at,t.assigned_at),release_reason='returned'
      where t.released_at is null and exists (
        select 1 from public.equipment_assignments a where a.id=t.equipment_assignment_id
          and a.equipment_id=asset.id and a.returned_at is null);
    update public.equipment_assignments set returned_at=greatest(changed_at,assigned_at)
      where equipment_id=asset.id and returned_at is null;
  elsif exists(select 1 from public.equipment_assignments where equipment_id=asset.id and returned_at is null) then
    raise exception 'This equipment still has an active checkout. Refresh and review its assignments.' using errcode='40001';
  end if;

  update public.equipment set status=p_status,current_project_id=null,
    last_returned_at=case when cardinality(project_ids)>0 then changed_at else last_returned_at end
    where id=asset.id;
  return jsonb_build_object('projectIds',to_jsonb(project_ids));
end $$;

-- Use the same asset lock for checkout so maintenance cannot race with an
-- assignment between a status check and a later, separate update.
create or replace function public.assign_available_equipment(
  p_equipment_id bigint,p_project_id bigint,p_notes text default null
) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  asset public.equipment%rowtype;
  changed_at timestamptz:=now();
begin
  if auth.uid() is null or public.app_session_is_active() is not true
    or public.invitation_setup_complete() is not true
    or coalesce(public.get_my_role()::text,'') not in ('admin','super_admin')
    or public.project_access_level(p_project_id) is distinct from 'edit' then
    raise exception 'You are not authorized to assign equipment to this project.' using errcode='42501';
  end if;
  if public.system_backup_maintenance() then
    raise exception 'Saving is temporarily paused.' using errcode='55000';
  end if;
  if p_equipment_id is null or p_equipment_id<=0 or p_project_id is null or p_project_id<=0 then
    raise exception 'Choose valid equipment and a project.' using errcode='22023';
  end if;
  select * into asset from public.equipment where id=p_equipment_id for update;
  if not found then raise exception 'Equipment not found.' using errcode='P0002';end if;
  if asset.status is distinct from 'available'
    or exists(select 1 from public.equipment_assignments where equipment_id=asset.id and returned_at is null) then
    raise exception 'Only available equipment can be assigned. Refresh and check its status.' using errcode='40001';
  end if;
  insert into public.equipment_assignments(equipment_id,project_id,assigned_by,assigned_at,notes)
    values(asset.id,p_project_id,auth.uid(),changed_at,nullif(btrim(p_notes),''));
  update public.equipment set status='assigned',current_project_id=p_project_id,last_assigned_at=changed_at where id=asset.id;
end $$;

revoke all on function public.set_equipment_service_status(bigint,text,text) from public,anon;
grant execute on function public.set_equipment_service_status(bigint,text,text) to authenticated;
revoke all on function public.assign_available_equipment(bigint,bigint,text) from public,anon;
grant execute on function public.assign_available_equipment(bigint,bigint,text) to authenticated;
notify pgrst,'reload schema';
commit;
