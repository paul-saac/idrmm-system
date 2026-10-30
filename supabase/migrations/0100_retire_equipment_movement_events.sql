-- Intent: remove the dormant movement-event feature while keeping project
-- checkout/return, task placements, and the current Gantt equipment planner.
-- Rebuild the planner's RPC without the retired movement-operation helper.
-- Refuse to discard event records; abort if the table is not empty.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local row_security = off;

do $$
declare
  event_table regclass := to_regclass('public.equipment_movement_events');
  event_count bigint;
begin
  if event_table is not null then
    execute format('lock table %s in access exclusive mode', event_table);
    execute format('select count(*) from %s', event_table) into event_count;
    if event_count > 0 then
      raise exception 'Removal cancelled: equipment_movement_events contains % records. Preserve or review them first.', event_count;
    end if;
  end if;
end;
$$;

-- Same project authorization and project-assigned asset filter as 0089.
-- Events were not consumed by the current Assign Equipment UI.
create or replace function public.equipment_tracking_data(p_project_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not coalesce(public.get_my_role() = 'admin' or public.is_project_foreman(p_project_id), false) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'equipment', coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'name', e.name, 'assetTag', e.asset_tag, 'status', e.status,
      'currentProjectId', e.current_project_id,
      'currentItemKey', case when t.task_id is not null then 'task-' || t.task_id when t.category_id is not null then 'category-' || t.category_id end,
      'location', coalesce(t.task_name, 'Project storage')
    ) order by e.name, e.asset_tag)
      from equipment e
      join equipment_assignments a on a.equipment_id = e.id and a.project_id = p_project_id and a.returned_at is null
      left join equipment_task_assignments t on t.equipment_assignment_id = a.id and t.released_at is null
      where e.current_project_id = p_project_id and e.status = 'assigned'), '[]'::jsonb),
    'plans', coalesce((select jsonb_agg(jsonb_build_object(
      'itemKey', p.item_key, 'equipmentId', p.equipment_id, 'name', e.name, 'assetTag', e.asset_tag
    )) from equipment_task_plans p join equipment e on e.id = p.equipment_id
      where p.project_id = p_project_id), '[]'::jsonb)
  );
end;
$$;

create or replace function public.save_equipment_task_plans(
  p_project_id bigint, p_item_key text, p_selected bigint[], p_previous bigint[]
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_current bigint[];
  v_selected bigint[];
  v_previous bigint[];
  v_id bigint;
begin
  if auth.uid() is null or not coalesce(public.get_my_role() = 'admin' or public.is_project_foreman(p_project_id), false) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_selected is null or p_previous is null or exists (
    select 1 from unnest(p_selected || p_previous) id where id is null or id <= 0
  ) then
    raise exception 'Invalid equipment selection';
  end if;
  if not (
    exists (select 1 from estimate_tasks where project_id = p_project_id and 'task-' || id = p_item_key)
    or exists (select 1 from estimate_categories c where project_id = p_project_id and 'category-' || id = p_item_key
      and not exists (select 1 from estimate_tasks t where t.category_id = c.id))
  ) then
    raise exception 'Select a valid task in this project';
  end if;

  perform 1 from projects where id = p_project_id for update;
  select coalesce(array_agg(distinct id order by id), '{}'::bigint[]) into v_selected from unnest(p_selected) id;
  select coalesce(array_agg(distinct id order by id), '{}'::bigint[]) into v_previous from unnest(p_previous) id;
  select coalesce(array_agg(equipment_id order by equipment_id), '{}'::bigint[]) into v_current
    from equipment_task_plans where project_id = p_project_id and item_key = p_item_key;

  -- Lock the same asset rows as Inventory checkout/return; preserve atomic
  -- saves and stale-selection rejection without calling the movement RPC.
  perform e.id from equipment e where e.id = any(v_current || v_selected) order by e.id for update;
  if exists (
    select 1 from unnest(v_selected) selected(equipment_id)
    left join equipment e on e.id = selected.equipment_id
    left join equipment_assignments a on a.equipment_id = e.id and a.project_id = p_project_id and a.returned_at is null
    where e.id is null or e.current_project_id is distinct from p_project_id or e.status <> 'assigned' or a.id is null
  ) then
    raise exception 'Only equipment currently assigned to this project can be assigned to its tasks';
  end if;
  if v_current = v_selected then return; end if;
  if v_current <> v_previous then
    raise exception 'Assignments changed. Reopen this modal before saving again';
  end if;

  delete from equipment_task_plans
    where project_id = p_project_id and item_key = p_item_key and not (equipment_id = any(v_selected));
  foreach v_id in array v_selected loop
    insert into equipment_task_plans(project_id, item_key, equipment_id)
      values (p_project_id, p_item_key, v_id) on conflict do nothing;
  end loop;
end;
$$;

-- Keep the existing authenticated-only RPC entry points.
revoke all on function public.equipment_tracking_data(bigint) from public, anon;
grant execute on function public.equipment_tracking_data(bigint) to authenticated;
revoke all on function public.save_equipment_task_plans(bigint, text, bigint[], bigint[]) from public, anon;
grant execute on function public.save_equipment_task_plans(bigint, text, bigint[], bigint[]) to authenticated;

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname !~ '^pg_toast'
      and p.prokind in ('f', 'p')
      and p.oid is distinct from to_regprocedure('public.record_equipment_operation(bigint,jsonb)')
      and p.prosrc ~ '\m(equipment_movement_events|record_equipment_operation)\M'
  ) then
    raise exception 'Removal cancelled: another stored function still references equipment movements. Review its dependency first.';
  end if;
end;
$$;

drop function if exists public.record_equipment_operation(bigint, jsonb) restrict;
drop table if exists public.equipment_movement_events restrict;

notify pgrst, 'reload schema';
commit;

select
  to_regclass('public.equipment_movement_events') is null as movement_event_table_removed,
  to_regprocedure('public.record_equipment_operation(bigint,jsonb)') is null as movement_rpc_removed,
  to_regclass('public.equipment_task_plans') is not null as equipment_plans_preserved;
