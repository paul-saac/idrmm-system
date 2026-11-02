-- Intent: move subtasks between main tasks and nest unstarted standalone tasks
-- and milestones, preserving planned costs, materials, dates and dependencies.
-- Reject standalone conversion with operational records rather than cascade-delete
-- history. Existing subtasks retain their IDs and all linked operational records.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $$
begin
 if not pg_try_advisory_xact_lock_shared(18244,7291) or public.system_backup_maintenance() then
   raise exception 'Task move setup cancelled: backup or recovery is running.';
 end if;
end;
$$;
create or replace function public.nest_estimate_row(
 p_project_id bigint, p_kind text, p_row_id bigint, p_category_id bigint, p_before_task_id bigint default null
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 c public.estimate_categories%rowtype;
 target public.estimate_categories%rowtype;
 v_task_id bigint;
 v_old_category bigint;
 v_ids bigint[];
 v_position integer;
 v_count integer;
 v_cycle boolean;
begin
 if public.app_session_is_active() is not true or public.invitation_setup_complete() is not true
   or public.project_access_level(p_project_id) is distinct from 'edit' then
   raise exception 'Project editing is not permitted.' using errcode='42501'; end if;
 if public.system_backup_maintenance() then raise exception 'Saving is temporarily paused.' using errcode='55000'; end if;
 if p_kind is null or p_kind not in ('category','task') or p_row_id is null or p_row_id<=0
   or p_category_id is null or p_category_id<=0 then raise exception 'Invalid task move.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('idrmm-gantt-project:'||p_project_id::text,0));
 perform 1 from public.estimate_categories where project_id=p_project_id order by id for update;
 perform 1 from public.estimate_tasks where project_id=p_project_id order by id for update;
 select * into target from public.estimate_categories where id=p_category_id and project_id=p_project_id;
 if not found or target.is_milestone then raise exception 'Choose a main task, not a milestone.' using errcode='22023'; end if;
 if exists(select 1 from public.category_progress_entries where category_id=p_category_id) then
   raise exception 'This main task already has its own progress logs. Keep its work structure unchanged.' using errcode='55000'; end if;
 if p_before_task_id is not null and not exists(select 1 from public.estimate_tasks where id=p_before_task_id and category_id=p_category_id and project_id=p_project_id) then
   raise exception 'The drop position changed. Please retry.' using errcode='40001'; end if;
 if p_kind='task' then
   select category_id into v_old_category from public.estimate_tasks where id=p_row_id and project_id=p_project_id;
   if not found or p_row_id=p_before_task_id then raise exception 'Task is unavailable.' using errcode='22023'; end if;
   v_task_id:=p_row_id;
   update public.estimate_tasks set category_id=p_category_id where id=v_task_id and project_id=p_project_id;
   get diagnostics v_count=row_count;
   if v_count<>1 then raise exception 'Task editing was denied.' using errcode='42501'; end if;
 else
   select * into c from public.estimate_categories where id=p_row_id and project_id=p_project_id;
   if not found or p_row_id=p_category_id or exists(select 1 from public.estimate_tasks where category_id=p_row_id) then
     raise exception 'Only a standalone task or milestone can be nested.' using errcode='22023'; end if;
   -- Schedule Undo intentionally does not recreate progress or operating records.
   -- Keep these identities intact instead of silently converting/deleting them.
   if exists(select 1 from public.category_progress_entries where category_id=p_row_id)
     or exists(select 1 from public.progress_override_logs where category_id=p_row_id)
     or exists(select 1 from public.category_worker_assignments where category_id=p_row_id)
     or exists(select 1 from public.equipment_task_assignments where category_id=p_row_id)
     or exists(select 1 from public.project_safety_incidents where category_id=p_row_id)
     or exists(select 1 from public.equipment_task_plans where project_id=p_project_id and item_key='category-'||p_row_id) then
     raise exception 'This standalone task has logs, assigned resources or incident records. Keep its existing identity; nesting it would affect those records.' using errcode='55000'; end if;
   insert into public.estimate_tasks(project_id,category_id,task_name,estimated_quantity,unit,
     labor_estimate,material_estimate,equipment_estimate,other_cost_estimate,total_estimate_cost,
     weight,weight_override,created_at,planned_start_date,planned_end_date,priority,is_milestone,
     material_direct_quantity,material_direct_unit,material_unit_cost,material_direct_amount,equipment_cost_items,
     predecessor_task_id,predecessor_category_id)
   values(p_project_id,p_category_id,c.category_name,coalesce(c.estimated_quantity,0),c.unit,
     c.category_labor_estimate,c.category_material_estimate,c.category_equipment_estimate,c.category_other_estimate,
     c.category_labor_estimate+c.category_material_estimate+c.category_equipment_estimate+c.category_other_estimate,
     c.weight,c.weight_override,c.created_at,c.planned_start_date,c.planned_end_date,c.priority,c.is_milestone,
     c.material_direct_quantity,c.material_direct_unit,c.material_unit_cost,c.material_direct_amount,c.equipment_cost_items,
     c.predecessor_task_id,c.predecessor_category_id) returning id into v_task_id;
   insert into public.estimate_task_material_assignments(task_id,material_name,specification,planned_quantity,unit,unit_cost,amount,created_at)
     select v_task_id,material_name,specification,planned_quantity,unit,unit_cost,amount,created_at
     from public.estimate_category_material_assignments where category_id=p_row_id;
   update public.estimate_task_other_costs set task_id=v_task_id,category_id=null where category_id=p_row_id;
   update public.estimate_categories set predecessor_category_id=null,predecessor_task_id=v_task_id
     where predecessor_category_id=p_row_id and project_id=p_project_id;
   update public.estimate_tasks set predecessor_category_id=null,predecessor_task_id=v_task_id
     where predecessor_category_id=p_row_id and project_id=p_project_id;
   delete from public.estimate_categories where id=p_row_id and project_id=p_project_id;
   get diagnostics v_count=row_count;
   if v_count<>1 then raise exception 'Task conversion was denied.' using errcode='42501'; end if;
 end if;
 -- Validate the full dependency graph including summary start/finish gates.
 with recursive edges(source,dest) as (
   select coalesce('task:'||x.predecessor_task_id,'category:'||x.predecessor_category_id),
     'category:'||x.id||case when exists(select 1 from public.estimate_tasks t where t.category_id=x.id) then ':start' else '' end
     from public.estimate_categories x where x.project_id=p_project_id and num_nonnulls(x.predecessor_task_id,x.predecessor_category_id)>0
   union select coalesce('task:'||predecessor_task_id,'category:'||predecessor_category_id),'task:'||id
     from public.estimate_tasks where project_id=p_project_id and num_nonnulls(predecessor_task_id,predecessor_category_id)>0
   union select 'category:'||category_id||':start','task:'||id from public.estimate_tasks where project_id=p_project_id
   union select 'task:'||id,'category:'||category_id from public.estimate_tasks where project_id=p_project_id
 ), walk(root,node) as (
   select source,dest from edges where source=any(array['task:'||v_task_id,'category:'||p_category_id||':start','category:'||p_category_id])
   union select walk.root,edges.dest from edges join walk on edges.source=walk.node
 ) select exists(select 1 from walk where root=node) into v_cycle;
 if v_cycle then raise exception 'These dependencies would create a circular dependency.' using errcode='22023'; end if;
 select coalesce(array_agg(id order by sort_order nulls last,id),'{}'::bigint[]) into v_ids
   from public.estimate_tasks where category_id=p_category_id and project_id=p_project_id and id<>v_task_id;
 v_position:=coalesce(array_position(v_ids,p_before_task_id),cardinality(v_ids)+1);
 v_ids:=coalesce(v_ids[1:v_position-1],'{}'::bigint[])||array[v_task_id]||coalesce(v_ids[v_position:cardinality(v_ids)],'{}'::bigint[]);
 update public.estimate_tasks t set sort_order=r.pos from unnest(v_ids) with ordinality r(id,pos)
   where t.id=r.id and t.category_id=p_category_id and t.project_id=p_project_id;
 get diagnostics v_count=row_count;
 if v_count<>cardinality(v_ids) then raise exception 'Not all rows could be moved.' using errcode='42501'; end if;
 return jsonb_build_object('task_id',v_task_id,'category_id',p_category_id,'ids',v_ids);
end;
$$;
revoke all on function public.nest_estimate_row(bigint,text,bigint,bigint,bigint) from public,anon;
grant execute on function public.nest_estimate_row(bigint,text,bigint,bigint,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
