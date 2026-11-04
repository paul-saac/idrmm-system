-- Intent: separate planned task allocations from physical project checkout.
-- Allow company equipment in project task plans, retain unavailable existing
-- plans for removal, and report overlapping plans without disclosing other
-- projects' protected task details. Checkout/return records are never changed.
begin;

create or replace function public.equipment_tracking_data(p_project_id bigint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
  if auth.uid() is null or public.app_session_is_active() is not true
    or public.invitation_setup_complete() is not true
    or coalesce(public.get_my_role()::text,'') not in ('admin','super_admin','project_manager','foreman')
    or coalesce(public.project_access_level(p_project_id),'none') not in ('view','edit') then
    raise exception 'Not authorized to view equipment planning.' using errcode='42501';
  end if;
  with work_ranges as (
    select t.project_id,'task-'||t.id item_key,
      coalesce(t.planned_start_date,t.planned_end_date) start_date,
      coalesce(t.planned_end_date,t.planned_start_date) end_date
      from public.estimate_tasks t join public.projects p on p.id=t.project_id where p.archived_at is null
    union all
    select c.project_id,'category-'||c.id,
      coalesce(c.planned_start_date,c.planned_end_date),coalesce(c.planned_end_date,c.planned_start_date)
      from public.estimate_categories c join public.projects p on p.id=c.project_id
      where p.archived_at is null and not exists(select 1 from public.estimate_tasks t where t.project_id=c.project_id and t.category_id=c.id)
  ), conflicts as (
    select distinct own.item_key,plan.equipment_id
      from work_ranges own
      join work_ranges other on other.start_date<=own.end_date and other.end_date>=own.start_date
        and (other.project_id<>own.project_id or other.item_key<>own.item_key)
      join public.equipment_task_plans plan on plan.project_id=other.project_id and plan.item_key=other.item_key
      where own.project_id=p_project_id
  )
  select jsonb_build_object(
    'equipment',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'name',e.name,'assetTag',e.asset_tag,'status',e.status,
      'currentProjectId',case when access.visible then e.current_project_id end,
      'currentItemKey',case when access.visible then case when placement.task_id is not null then 'task-'||placement.task_id
        when placement.category_id is not null then 'category-'||placement.category_id end end,
      'location',case when e.status='assigned' then case when access.visible then coalesce(p.project_name,'Assigned to a project')
          else 'Assigned to another project' end
        when e.status='maintenance' then 'Under maintenance' when e.status='retired' then 'Retired' else 'Available' end
      ) order by e.name,e.asset_tag)
      from public.equipment e left join public.projects p on p.id=e.current_project_id
      cross join lateral (select coalesce(e.current_project_id=p_project_id
        or public.project_access_level(e.current_project_id) in ('view','edit'),false) visible) access
      left join lateral (select t.task_id,t.category_id from public.equipment_assignments a
        join public.equipment_task_assignments t on t.equipment_assignment_id=a.id and t.released_at is null
        where a.equipment_id=e.id and a.returned_at is null order by t.assigned_at desc,t.id desc limit 1) placement on true
      where e.status in ('available','assigned') or exists(select 1 from public.equipment_task_plans ep where ep.equipment_id=e.id and ep.project_id=p_project_id)), '[]'::jsonb),
    'plans',coalesce((select jsonb_agg(jsonb_build_object('itemKey',ep.item_key,'equipmentId',ep.equipment_id,
      'name',e.name,'assetTag',e.asset_tag) order by ep.item_key,ep.equipment_id)
      from public.equipment_task_plans ep join public.equipment e on e.id=ep.equipment_id where ep.project_id=p_project_id),'[]'::jsonb),
    'conflicts',coalesce((select jsonb_agg(jsonb_build_object('itemKey',item_key,'equipmentId',equipment_id)
      order by item_key,equipment_id) from conflicts),'[]'::jsonb)
  ) into result;
  return result;
end $$;

create or replace function public.save_equipment_task_plans(
  p_project_id bigint,p_item_key text,p_selected bigint[],p_previous bigint[]
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare
  current_ids bigint[];
  selected_ids bigint[];
  previous_ids bigint[];
  equipment_id bigint;
begin
  if auth.uid() is null or public.app_session_is_active() is not true
    or public.invitation_setup_complete() is not true
    or coalesce(public.get_my_role()::text,'') not in ('admin','super_admin','project_manager','foreman')
    or public.project_access_level(p_project_id) is distinct from 'edit' then
    raise exception 'Not authorized to edit equipment planning.' using errcode='42501';
  end if;
  if public.system_backup_maintenance() then raise exception 'Saving is temporarily paused.' using errcode='55000';end if;
  if p_selected is null or p_previous is null or exists(select 1 from unnest(p_selected||p_previous) id where id is null or id<=0) then
    raise exception 'Invalid equipment selection.' using errcode='22023';end if;
  perform id from public.projects where id=p_project_id for update;
  if not found then raise exception 'Project not found.' using errcode='P0002';end if;
  if not (exists(select 1 from public.estimate_tasks where project_id=p_project_id and 'task-'||id=p_item_key)
    or exists(select 1 from public.estimate_categories c where c.project_id=p_project_id and 'category-'||c.id=p_item_key
      and not exists(select 1 from public.estimate_tasks t where t.project_id=c.project_id and t.category_id=c.id))) then
    raise exception 'Select a valid task in this project.' using errcode='22023';end if;
  select coalesce(array_agg(distinct id order by id),'{}'::bigint[]) into selected_ids from unnest(p_selected) id;
  select coalesce(array_agg(distinct id order by id),'{}'::bigint[]) into previous_ids from unnest(p_previous) id;
  select coalesce(array_agg(ep.equipment_id order by ep.equipment_id),'{}'::bigint[]) into current_ids
    from public.equipment_task_plans ep where ep.project_id=p_project_id and ep.item_key=p_item_key;
  perform e.id from public.equipment e where e.id=any(current_ids||selected_ids) order by e.id for update;
  if current_ids=selected_ids then return;end if;
  if current_ids<>previous_ids then raise exception 'Assignments changed. Reopen this modal before saving again.' using errcode='40001';end if;
  if exists(select 1 from unnest(selected_ids) chosen(id) left join public.equipment e on e.id=chosen.id
    where e.id is null or (not(e.id=any(current_ids)) and e.status not in ('available','assigned'))) then
    raise exception 'Equipment under maintenance or retired cannot be newly allocated.' using errcode='22023';end if;
  delete from public.equipment_task_plans ep where ep.project_id=p_project_id and ep.item_key=p_item_key and not(ep.equipment_id=any(selected_ids));
  foreach equipment_id in array selected_ids loop
    insert into public.equipment_task_plans(project_id,item_key,equipment_id) values(p_project_id,p_item_key,equipment_id) on conflict do nothing;
  end loop;
end $$;

revoke all on function public.equipment_tracking_data(bigint) from public,anon;
grant execute on function public.equipment_tracking_data(bigint) to authenticated;
revoke all on function public.save_equipment_task_plans(bigint,text,bigint[],bigint[]) from public,anon;
grant execute on function public.save_equipment_task_plans(bigint,text,bigint[],bigint[]) to authenticated;
notify pgrst,'reload schema';
commit;
