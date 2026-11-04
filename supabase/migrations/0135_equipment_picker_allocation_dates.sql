-- Intent: show task allocation project names and planned dates in the picker.
-- Return only unfinished allocations in projects the caller can already view.
-- Calendar dates use the project's existing Asia/Manila scheduling convention.
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
        and not public._equipment_work_complete(own.project_id,own.item_key)
        and not public._equipment_work_complete(other.project_id,other.item_key)
  )
  select jsonb_build_object(
    'equipment',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'name',e.name,'assetTag',e.asset_tag,'status',e.status,
      'allocations',coalesce((select jsonb_agg(jsonb_build_object(
        'projectId',ep.project_id,'projectName',ap.project_name,'itemKey',ep.item_key,
        'startDate',to_char(r.start_date::timestamptz at time zone 'Asia/Manila','YYYY-MM-DD'),
        'endDate',to_char(r.end_date::timestamptz at time zone 'Asia/Manila','YYYY-MM-DD'))
        order by r.start_date,ep.project_id,ep.item_key)
        from public.equipment_task_plans ep
        join work_ranges r on r.project_id=ep.project_id and r.item_key=ep.item_key
        join public.projects ap on ap.id=ep.project_id
        where ep.equipment_id=e.id and public.project_access_level(ep.project_id) in ('view','edit')
          and not public._equipment_work_complete(ep.project_id,ep.item_key)),'[]'::jsonb),
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

revoke all on function public.equipment_tracking_data(bigint) from public,anon;
grant execute on function public.equipment_tracking_data(bigint) to authenticated;
notify pgrst,'reload schema';
commit;
