-- Intent: task planning may only use assets already checked out to this project.
create or replace function public.equipment_tracking_data(p_project_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not coalesce(public.get_my_role() = 'admin' or public.is_project_foreman(p_project_id),false) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'equipment', coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'name',e.name,'assetTag',e.asset_tag,'status',e.status,
      'currentProjectId',e.current_project_id,
      'currentItemKey',case when t.task_id is not null then 'task-'||t.task_id when t.category_id is not null then 'category-'||t.category_id end,
      'location',coalesce(t.task_name,'Project storage')
    ) order by e.name,e.asset_tag) from equipment e
      join equipment_assignments a on a.equipment_id=e.id and a.project_id=p_project_id and a.returned_at is null
      left join equipment_task_assignments t on t.equipment_assignment_id=a.id and t.released_at is null
      where e.current_project_id=p_project_id and e.status='assigned'), '[]'::jsonb),
    'plans', coalesce((select jsonb_agg(jsonb_build_object('itemKey',p.item_key,'equipmentId',p.equipment_id,'name',e.name,'assetTag',e.asset_tag))
      from equipment_task_plans p join equipment e on e.id=p.equipment_id where p.project_id=p_project_id),'[]'::jsonb),
    'events', coalesce((select jsonb_agg(j order by j->>'recordedAt' desc) from (
      select jsonb_build_object('id',m.id,'itemKey',m.item_key,'equipmentId',m.equipment_id,
      'name',e.name,'assetTag',e.asset_tag,'action',m.action,'entryDate',m.entry_date,
      'from',m.from_location,'to',m.to_location,'destinationKey',m.destination_key,'notes',m.notes,'recordedAt',m.recorded_at,
      'recordedBy',trim(p.first_name||' '||p.last_name)) j
      from equipment_movement_events m join equipment e on e.id=m.equipment_id
      join profiles p on p.id=m.recorded_by where m.project_id=p_project_id
    ) q),'[]'::jsonb));
end $$;

create or replace function public.save_equipment_task_plans(
  p_project_id bigint, p_item_key text, p_selected bigint[], p_previous bigint[]
) returns void language plpgsql security definer set search_path=public as $$
declare
  v_current bigint[];
  v_selected bigint[];
  v_previous bigint[];
  v_id bigint;
begin
  if auth.uid() is null or not coalesce(public.get_my_role()='admin' or public.is_project_foreman(p_project_id),false) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  if p_selected is null or p_previous is null or
    exists(select 1 from unnest(p_selected || p_previous) id where id is null or id<=0) then
    raise exception 'Invalid equipment selection';
  end if;
  if not (exists(select 1 from estimate_tasks where project_id=p_project_id and 'task-'||id=p_item_key)
    or exists(select 1 from estimate_categories c where project_id=p_project_id and 'category-'||id=p_item_key
      and not exists(select 1 from estimate_tasks t where t.category_id=c.id))) then
    raise exception 'Select a valid task in this project';
  end if;
  perform 1 from projects where id=p_project_id for update;
  select coalesce(array_agg(distinct id order by id),'{}'::bigint[]) into v_selected from unnest(p_selected) id;
  select coalesce(array_agg(distinct id order by id),'{}'::bigint[]) into v_previous from unnest(p_previous) id;
  if exists(select 1 from unnest(v_selected) selected(equipment_id) left join equipment e on e.id=selected.equipment_id
    left join equipment_assignments a on a.equipment_id=e.id and a.project_id=p_project_id and a.returned_at is null
    where e.id is null or e.current_project_id<>p_project_id or e.status<>'assigned' or a.id is null) then
    raise exception 'Only equipment currently assigned to this project can be assigned to its tasks';
  end if;
  select coalesce(array_agg(equipment_id order by equipment_id),'{}'::bigint[]) into v_current
    from equipment_task_plans where project_id=p_project_id and item_key=p_item_key;
  if v_current=v_selected then return; end if;
  if v_current<>v_previous then raise exception 'Assignments changed. Reopen this modal before saving again'; end if;
  for v_id in select id from unnest(v_current || v_selected) id group by id order by id loop
    if v_id=any(v_current) and not v_id=any(v_selected) then
      perform record_equipment_operation(p_project_id,jsonb_build_object('itemKey',p_item_key,'equipmentId',v_id,'action','unplan'));
    elsif not v_id=any(v_current) and v_id=any(v_selected) then
      perform record_equipment_operation(p_project_id,jsonb_build_object('itemKey',p_item_key,'equipmentId',v_id,'action','plan'));
    end if;
  end loop;
end $$;
