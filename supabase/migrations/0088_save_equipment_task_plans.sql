-- Intent: commit the Assign Equipment modal's draft selection atomically.
-- Cancel is client-only; a failed Save must never leave partial assignments.
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
  select coalesce(array_agg(equipment_id order by equipment_id),'{}'::bigint[]) into v_current
    from equipment_task_plans where project_id=p_project_id and item_key=p_item_key;
  if v_current=v_selected then return; end if; -- safe retry after a lost response
  if v_current<>v_previous then raise exception 'Assignments changed. Reopen this modal before saving again'; end if;
  for v_id in select id from unnest(v_current || v_selected) id group by id order by id loop
    if v_id=any(v_current) and not v_id=any(v_selected) then
      perform record_equipment_operation(p_project_id,jsonb_build_object('itemKey',p_item_key,'equipmentId',v_id,'action','unplan'));
    elsif not v_id=any(v_current) and v_id=any(v_selected) then
      perform record_equipment_operation(p_project_id,jsonb_build_object('itemKey',p_item_key,'equipmentId',v_id,'action','plan'));
    end if;
  end loop;
end $$;
revoke all on function public.save_equipment_task_plans(bigint,text,bigint[],bigint[]) from public, anon;
grant execute on function public.save_equipment_task_plans(bigint,text,bigint[],bigint[]) to authenticated;
