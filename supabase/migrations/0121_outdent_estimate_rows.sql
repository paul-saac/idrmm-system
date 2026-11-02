-- Intent: outdent unstarted subtasks and milestones into standalone main tasks.
-- Preserve planned costs, materials, dates, dependencies and Undo/Redo snapshots.
-- Refuse conversion with operating records rather than delete their history.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $$ begin
 if not pg_try_advisory_xact_lock_shared(18244,7291) or public.system_backup_maintenance() then
   raise exception 'Task move setup cancelled: backup or recovery is running.';
 end if;
end $$;
create or replace function public.outdent_estimate_row(
 p_project_id bigint, p_task_id bigint, p_target_category_id bigint, p_after boolean
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 t public.estimate_tasks%rowtype;
 v_category_id bigint;
 v_ids bigint[];
 v_position integer;
 v_count integer;
begin
 if public.app_session_is_active() is not true or public.invitation_setup_complete() is not true
   or public.project_access_level(p_project_id) is distinct from 'edit' then
   raise exception 'Project editing is not permitted.' using errcode='42501'; end if;
 if public.system_backup_maintenance() then raise exception 'Saving is temporarily paused.' using errcode='55000'; end if;
 if p_task_id is null or p_task_id<=0 or p_target_category_id is null or p_target_category_id<=0 or p_after is null then
   raise exception 'Invalid task move.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('idrmm-gantt-project:'||p_project_id::text,0));
 perform 1 from public.estimate_categories where project_id=p_project_id order by id for update;
 perform 1 from public.estimate_tasks where project_id=p_project_id order by id for update;
 select * into t from public.estimate_tasks where id=p_task_id and project_id=p_project_id;
 if not found then raise exception 'Subtask is unavailable.' using errcode='22023'; end if;
 if not exists(select 1 from public.estimate_categories where id=p_target_category_id and project_id=p_project_id) then
   raise exception 'The drop position changed. Please retry.' using errcode='40001'; end if;
 if exists(select 1 from public.task_progress_entries where task_id=p_task_id)
   or exists(select 1 from public.progress_override_logs where task_id=p_task_id)
   or exists(select 1 from public.task_worker_assignments where task_id=p_task_id)
   or exists(select 1 from public.equipment_task_assignments where task_id=p_task_id)
   or exists(select 1 from public.project_safety_incidents where task_id=p_task_id)
   or exists(select 1 from public.equipment_task_plans where project_id=p_project_id and item_key='task-'||p_task_id) then
   raise exception 'This subtask has logs, assigned resources or incident records. Keep its existing identity; outdenting it would affect those records.' using errcode='55000'; end if;
 insert into public.estimate_categories(project_id,category_name,estimated_quantity,unit,
   category_labor_estimate,category_material_estimate,category_equipment_estimate,category_other_estimate,
   weight,weight_override,created_at,planned_start_date,planned_end_date,priority,is_milestone,
   material_direct_quantity,material_direct_unit,material_unit_cost,material_direct_amount,equipment_cost_items,
   predecessor_task_id,predecessor_category_id)
 values(p_project_id,t.task_name,t.estimated_quantity,t.unit,
   t.labor_estimate,t.material_estimate,t.equipment_estimate,t.other_cost_estimate,
   t.weight,t.weight_override,t.created_at,t.planned_start_date,t.planned_end_date,t.priority,t.is_milestone,
   t.material_direct_quantity,t.material_direct_unit,t.material_unit_cost,t.material_direct_amount,t.equipment_cost_items,
   t.predecessor_task_id,t.predecessor_category_id) returning id into v_category_id;
 insert into public.estimate_category_material_assignments(category_id,material_name,specification,planned_quantity,unit,unit_cost,amount,created_at)
   select v_category_id,material_name,specification,planned_quantity,unit,unit_cost,amount,created_at
   from public.estimate_task_material_assignments where task_id=p_task_id;
 update public.estimate_task_other_costs set task_id=null,category_id=v_category_id where task_id=p_task_id;
 update public.estimate_categories set predecessor_task_id=null,predecessor_category_id=v_category_id
   where predecessor_task_id=p_task_id and project_id=p_project_id;
 update public.estimate_tasks set predecessor_task_id=null,predecessor_category_id=v_category_id
   where predecessor_task_id=p_task_id and project_id=p_project_id;
 delete from public.estimate_tasks where id=p_task_id and project_id=p_project_id;
 get diagnostics v_count=row_count;
 if v_count<>1 then raise exception 'Task conversion was denied.' using errcode='42501'; end if;
 select coalesce(array_agg(id order by sort_order nulls last,id),'{}'::bigint[]) into v_ids
   from public.estimate_categories where project_id=p_project_id and id<>v_category_id;
 v_position:=array_position(v_ids,p_target_category_id)+case when p_after then 1 else 0 end;
 v_ids:=coalesce(v_ids[1:v_position-1],'{}'::bigint[])||array[v_category_id]||coalesce(v_ids[v_position:cardinality(v_ids)],'{}'::bigint[]);
 update public.estimate_categories c set sort_order=r.pos from unnest(v_ids) with ordinality r(id,pos)
   where c.id=r.id and c.project_id=p_project_id;
 get diagnostics v_count=row_count;
 if v_count<>cardinality(v_ids) then raise exception 'Not all rows could be moved.' using errcode='42501'; end if;
 return jsonb_build_object('category_id',v_category_id,'ids',v_ids);
end $$;
revoke all on function public.outdent_estimate_row(bigint,bigint,bigint,boolean) from public,anon;
grant execute on function public.outdent_estimate_row(bigint,bigint,bigint,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
