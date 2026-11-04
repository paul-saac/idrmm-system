-- Intent: block overlapping task allocations and release equipment automatically
-- from saved actual completion. Preserve assignment history; remove manual returns
-- from the application. Private project details must never appear in conflicts.
begin;

-- Internal only. Match computeProgressBreakdown: quantity, then cost excluding
-- unplanned material spend, then value-weighted planned material usage. Dates and
-- the legacy percent_complete column never establish actual completion.
create or replace function public._equipment_work_complete(p_project bigint,p_key text)
returns boolean language plpgsql stable set search_path=public,pg_temp as $$
declare
 r jsonb; prefix text; owner_column text; owner_id bigint;
 planned numeric; qty numeric; spent numeric; unplanned numeric; materials_complete boolean;
begin
 if p_key ~ '^task-[1-9][0-9]*$' then
  owner_id:=substring(p_key from 6)::bigint;
  select to_jsonb(t) into r from public.estimate_tasks t where t.id=owner_id and t.project_id=p_project;
  prefix:='task';owner_column:='task_id';
 elsif p_key ~ '^category-[1-9][0-9]*$' then
  owner_id:=substring(p_key from 10)::bigint;
  select to_jsonb(c) into r from public.estimate_categories c where c.id=owner_id and c.project_id=p_project;
  if exists(select 1 from public.estimate_tasks where category_id=owner_id and project_id=p_project) then
   return (select bool_and(public._equipment_work_complete(p_project,'task-'||t.id)) from public.estimate_tasks t where t.category_id=owner_id and t.project_id=p_project);
  end if;
  prefix:='category';owner_column:='category_id';
 else return false;end if;
 if r is null then return false;end if;
 execute format('select coalesce(sum(quantity_completed),0),coalesce(sum(coalesce(labor_cost,0)+coalesce(material_cost,0)+coalesce(equipment_cost,0)+coalesce(other_cost,0)),0) from public.%I where %I=$1',prefix||'_progress_entries',owner_column)
  into qty,spent using owner_id;
 if coalesce((r->>'estimated_quantity')::numeric,0)>0 then return qty >= (r->>'estimated_quantity')::numeric;end if;
 planned:=case when prefix='task' then coalesce((r->>'labor_estimate')::numeric,0)+coalesce((r->>'material_estimate')::numeric,0)+coalesce((r->>'equipment_estimate')::numeric,0)+coalesce((r->>'other_cost_estimate')::numeric,0)
  else coalesce((r->>'category_labor_estimate')::numeric,0)+coalesce((r->>'category_material_estimate')::numeric,0)+coalesce((r->>'category_equipment_estimate')::numeric,0)+coalesce((r->>'category_other_estimate')::numeric,0) end;
 if planned>0 then
  execute format('select coalesce(sum(m.quantity_used*m.unit_cost),0) from public.%I m join public.%I e on e.id=m.progress_entry_id where e.%I=$1 and m.unit_cost is not null',prefix||'_progress_material_entries',prefix||'_progress_entries',owner_column)
   into unplanned using owner_id;
  return spent-unplanned>=planned;
 end if;
 execute format($q$
  with planned as (
   select lower(btrim(material_name)) name,lower(btrim(coalesce(unit,''))) unit,
    sum(planned_quantity) quantity,greatest(0,sum(coalesce(amount,planned_quantity*unit_cost))) value
   from public.%I where %I=$1 and btrim(material_name)<>'' group by 1,2 having sum(planned_quantity)>0
  ), used as (
   select lower(btrim(m.material_name)) name,lower(btrim(coalesce(m.unit,''))) unit,sum(m.quantity_used) quantity
   from public.%I m join public.%I e on e.id=m.progress_entry_id
   where e.%I=$1 and m.unit_cost is null group by 1,2
  ) select case when sum(p.value)>0 then sum(least(1,coalesce(u.quantity,0)/p.quantity)*p.value)>=sum(p.value)
    else bool_and(coalesce(u.quantity,0)>=p.quantity) end
    from planned p left join used u using(name,unit)
 $q$,'estimate_'||prefix||'_material_assignments',owner_column,prefix||'_progress_material_entries',prefix||'_progress_entries',owner_column)
 into materials_complete using owner_id;
 return coalesce(materials_complete,false);
end $$;

-- Only callable by trusted trigger/RPC code, never directly through PostgREST.
create or replace function public._equipment_sync_allocations(p_equipment bigint)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare next_project bigint;
begin
 perform id from public.equipment where id=p_equipment and status not in ('maintenance','retired') for update;
 if not found then return;end if;
 -- Automatically close a project assignment only when it has allocations and
 -- every one is complete. Run deferred so an edit's intermediate rows never
 -- accidentally release equipment. Historical records are retained.
 update public.equipment_task_assignments t set released_at=greatest(now(),t.assigned_at),release_reason='returned'
 where t.released_at is null and (auth.uid() is null or public.project_access_level(t.project_id)='edit')
 and exists(select 1 from public.equipment_assignments a where a.id=t.equipment_assignment_id and a.equipment_id=p_equipment)
 and public._equipment_work_complete(t.project_id,case when t.task_id is not null then 'task-'||t.task_id else 'category-'||t.category_id end);
 update public.equipment_assignments a set returned_at=greatest(now(),a.assigned_at)
 where a.equipment_id=p_equipment and a.returned_at is null
 and (auth.uid() is null or public.project_access_level(a.project_id)='edit')
 and exists(select 1 from public.equipment_task_plans ep where ep.equipment_id=p_equipment and ep.project_id=a.project_id)
 and not exists(select 1 from public.equipment_task_plans ep where ep.equipment_id=p_equipment and ep.project_id=a.project_id
   and not public._equipment_work_complete(ep.project_id,ep.item_key));
 select ep.project_id into next_project from public.equipment_task_plans ep join public.projects p on p.id=ep.project_id
 where ep.equipment_id=p_equipment and p.archived_at is null and not public._equipment_work_complete(ep.project_id,ep.item_key)
 order by ep.project_id,ep.item_key limit 1;
 if next_project is null then
  select a.project_id into next_project from public.equipment_assignments a join public.projects p on p.id=a.project_id
   where a.equipment_id=p_equipment and a.returned_at is null and p.archived_at is null
   and (not exists(select 1 from public.equipment_task_plans ep where ep.equipment_id=p_equipment and ep.project_id=a.project_id)
     or exists(select 1 from public.equipment_task_plans ep where ep.equipment_id=p_equipment and ep.project_id=a.project_id and not public._equipment_work_complete(ep.project_id,ep.item_key))) order by a.assigned_at desc,a.id desc limit 1;
 end if;
 update public.equipment set status=case when next_project is null then 'available' else 'assigned' end,current_project_id=next_project,
  last_returned_at=case when next_project is null then coalesce((select max(returned_at) from public.equipment_assignments where equipment_id=p_equipment),last_returned_at) else last_returned_at end
 where id=p_equipment and (status,current_project_id) is distinct from (case when next_project is null then 'available' else 'assigned' end,next_project);
end $$;

create or replace function public._equipment_allocation_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare own_start date;own_end date;other record; asset_name text;visible boolean;
begin
 perform id from public.equipment where id=new.equipment_id for update;
 select name into asset_name from public.equipment where id=new.equipment_id;
 if exists(select 1 from public.equipment_task_plans where project_id=new.project_id and item_key=new.item_key and equipment_id=new.equipment_id) then return new;end if;
 if exists(select 1 from public.equipment where id=new.equipment_id and status in ('maintenance','retired')) then
  raise exception 'Equipment under maintenance or retired cannot be newly allocated.' using errcode='22023';end if;
 -- Completed allocations are historical and do not reserve future use.
 if public._equipment_work_complete(new.project_id,new.item_key) then return new;end if;
 select start_date,end_date into own_start,own_end from (
  select t.planned_start_date start_date,t.planned_end_date end_date from public.estimate_tasks t where t.project_id=new.project_id and 'task-'||t.id=new.item_key
  union all select c.planned_start_date,c.planned_end_date from public.estimate_categories c where c.project_id=new.project_id and 'category-'||c.id=new.item_key
 ) ranges;
 if own_start is null or own_end is null or own_end<own_start then raise exception 'Set valid task start and end dates before assigning equipment.' using errcode='22023';end if;
 for other in
  select ep.project_id,ep.item_key,w.name,w.start_date,w.end_date from public.equipment_task_plans ep join public.projects p on p.id=ep.project_id and p.archived_at is null
  cross join lateral (
   select t.task_name name,t.planned_start_date start_date,t.planned_end_date end_date from public.estimate_tasks t where t.project_id=ep.project_id and 'task-'||t.id=ep.item_key
   union all select c.category_name,c.planned_start_date,c.planned_end_date from public.estimate_categories c where c.project_id=ep.project_id and 'category-'||c.id=ep.item_key
  ) w
  where ep.equipment_id=new.equipment_id and (ep.project_id,ep.item_key)<>(new.project_id,new.item_key)
   and not public._equipment_work_complete(ep.project_id,ep.item_key)
   and (w.start_date is null or w.end_date is null or (w.start_date<=own_end and w.end_date>=own_start))
  order by ep.project_id,ep.item_key
 loop
  visible:=coalesce(public.project_access_level(other.project_id) in ('view','edit'),false);
  raise exception '% is already assigned to overlapping unfinished work.',asset_name using errcode='P0001',
   detail=jsonb_build_object('equipmentConflict',true,'equipment',asset_name,
    'task',case when visible then other.name else 'A task in another project' end,
    'startDate',case when visible then other.start_date end,'endDate',case when visible then other.end_date end)::text;
 end loop;
 return new;
end $$;
create trigger equipment_allocation_conflict before insert or update on public.equipment_task_plans
 for each row execute function public._equipment_allocation_guard();

-- Keep the older Project Equipment task-placement entry point under the same
-- reservation checks as the Gantt picker (including serialized asset locks).
create or replace function public._equipment_placement_plan()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare asset bigint;work_key text;
begin
 if new.released_at is not null then return new;end if;
 select equipment_id into asset from public.equipment_assignments where id=new.equipment_assignment_id;
 work_key:=case when new.task_id is not null then 'task-'||new.task_id else 'category-'||new.category_id end;
 insert into public.equipment_task_plans(project_id,item_key,equipment_id) values(new.project_id,work_key,asset) on conflict do nothing;
 return new;
end $$;
create trigger equipment_placement_plan before insert on public.equipment_task_assignments
 for each row execute function public._equipment_placement_plan();

create or replace function public._equipment_refresh_project()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare row_data jsonb; old_data jsonb;project_ids bigint[]:='{}';project_id_value bigint;owner_id bigint;asset bigint;prefix text;owner_column text;
begin
 row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 old_data:=case when tg_op='UPDATE' then to_jsonb(old) else row_data end;
 -- Renaming a project or updating Undo/Redo metadata does not change equipment
 -- availability. Avoid recalculating all saved progress for those operations.
 if tg_table_name='projects' and tg_op='UPDATE' and row_data->'archived_at' is not distinct from old_data->'archived_at' then return null;end if;
 if tg_op='UPDATE' and tg_table_name in ('task_progress_entries','category_progress_entries')
  and (row_data-array['created_at','recorded_by','entry_date']) is not distinct from (old_data-array['created_at','recorded_by','entry_date']) then return null;end if;

 if tg_table_name='equipment' then
  if row_data->>'status'='available' and row_data->>'status' is distinct from old_data->>'status' then perform public._equipment_sync_allocations((row_data->>'id')::bigint);end if;
  return null;
 end if;
 if tg_table_name in ('equipment_task_plans','equipment_assignments') then
  for asset in select distinct id from unnest(array[(row_data->>'equipment_id')::bigint,(old_data->>'equipment_id')::bigint]) id where id is not null order by id loop
   perform public._equipment_sync_allocations(asset);
  end loop;return null;
 end if;
 if tg_table_name='projects' then project_ids:=array[(row_data->>'id')::bigint];
 elsif row_data ? 'project_id' then project_ids:=array[(row_data->>'project_id')::bigint,(old_data->>'project_id')::bigint];
 else
  prefix:=case when tg_table_name like 'task_%' or tg_table_name='estimate_task_material_assignments' then 'task' else 'category' end;
  owner_column:=prefix||'_id';
  for owner_id in select distinct id from unnest(array[(row_data->>owner_column)::bigint,(old_data->>owner_column)::bigint]) id where id is not null loop
   execute format('select project_id from public.%I where id=$1',case when prefix='task' then 'estimate_tasks' else 'estimate_categories' end) into project_id_value using owner_id;
   project_ids:=array_append(project_ids,project_id_value);
  end loop;
  if row_data ? 'progress_entry_id' then
   for owner_id in select distinct id from unnest(array[(row_data->>'progress_entry_id')::bigint,(old_data->>'progress_entry_id')::bigint]) id where id is not null loop
    execute format('select w.project_id from public.%I e join public.%I w on w.id=e.%I where e.id=$1',prefix||'_progress_entries',case when prefix='task' then 'estimate_tasks' else 'estimate_categories' end,owner_column)
     into project_id_value using owner_id;
    project_ids:=array_append(project_ids,project_id_value);
   end loop;
  end if;
 end if;
 for asset in select distinct equipment_id from (
  select equipment_id from public.equipment_task_plans where project_id=any(project_ids)
  union select equipment_id from public.equipment_assignments where project_id=any(project_ids) and returned_at is null
 ) ids order by equipment_id loop perform public._equipment_sync_allocations(asset);end loop;
 return null;
end $$;

do $$ declare tbl text;begin
 foreach tbl in array array['equipment_task_plans','equipment_assignments','estimate_tasks','estimate_categories','projects',
  'task_progress_entries','category_progress_entries','task_progress_material_entries','category_progress_material_entries',
  'estimate_task_material_assignments','estimate_category_material_assignments'] loop
  execute format('create constraint trigger equipment_availability_refresh after insert or update or delete on public.%I deferrable initially deferred for each row execute function public._equipment_refresh_project()',tbl);
 end loop;
end $$;
create constraint trigger equipment_availability_refresh after update on public.equipment
 deferrable initially deferred for each row execute function public._equipment_refresh_project();

-- Preserve the public sync endpoint but use the new source of truth and current
-- session/project guards. There is no client-side manual-return endpoint.
create or replace function public.sync_equipment_status(p_equipment_id bigint)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or public.app_session_is_active() is not true or public.invitation_setup_complete() is not true
 or not (public.get_my_role()::text in ('admin','super_admin') or exists(select 1 from public.equipment_task_plans ep where ep.equipment_id=p_equipment_id and public.project_access_level(ep.project_id)='edit')
 or exists(select 1 from public.equipment_assignments a where a.equipment_id=p_equipment_id and public.project_access_level(a.project_id)='edit')) then
  raise exception 'Not authorized to update this equipment.' using errcode='42501';end if;
 if public.system_backup_maintenance() then raise exception 'Saving is temporarily paused.' using errcode='55000';end if;
 perform public._equipment_sync_allocations(p_equipment_id);
end $$;
revoke all on function public._equipment_work_complete(bigint,text),public._equipment_sync_allocations(bigint),public._equipment_allocation_guard(),public._equipment_placement_plan(),public._equipment_refresh_project() from public,anon,authenticated;
revoke all on function public.sync_equipment_status(bigint) from public,anon;
grant execute on function public.sync_equipment_status(bigint) to authenticated;
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

-- Preserve existing data during deployment. Deferred triggers reconcile affected
-- equipment on subsequent log, allocation, estimate or project changes.
revoke execute on function public.close_equipment_task_assignment(bigint,bigint,timestamptz) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
