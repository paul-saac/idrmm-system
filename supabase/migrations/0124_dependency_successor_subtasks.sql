-- Intent: limit the Dependencies successor checklist to subtasks.
-- Preserve all existing category links; edit those through their predecessor checklist.
begin;
create or replace function public.save_estimate_dependencies(
 p_project_id bigint,p_source_kind text,p_source_id bigint,p_predecessors text[],p_successors text[],
 p_previous_predecessors text[] default null,p_previous_successors text[] default null,p_milestone boolean default null,p_name text default null
) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 v_source text;v_key text;v_in text[];v_out text[];v_current_in text[];v_current_out text[];
 v_sync text:=current_setting('idrmm.dependency_sync',true);v_count integer;
begin
 if public.app_session_is_active() is not true or public.invitation_setup_complete() is not true or public.project_access_level(p_project_id) is distinct from 'edit' then
   raise exception 'Project editing is not permitted.' using errcode='42501';end if;
 if public.system_backup_maintenance() then raise exception 'Saving is temporarily paused.' using errcode='55000';end if;
 if p_source_kind is null or p_source_kind not in ('task','category') or p_source_id is null or p_source_id<=0 or p_predecessors is null or p_successors is null
   or cardinality(p_predecessors)>2000 or cardinality(p_successors)>2000 then raise exception 'Choose valid task dependencies.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('idrmm-gantt-project:'||p_project_id::text,0));
 perform 1 from public.estimate_categories where project_id=p_project_id order by id for update;
 perform 1 from public.estimate_tasks where project_id=p_project_id order by id for update;
 v_source:=p_source_kind||':'||p_source_id;
 select coalesce(array_agg(distinct x order by x),'{}'::text[]) into v_in from unnest(p_predecessors)x;
 select coalesce(array_agg(distinct x order by x),'{}'::text[]) into v_out from unnest(p_successors)x;
 for v_key in select unnest(v_in||v_out||array[v_source]) loop
   if v_key is null or v_key !~ '^(task|category):[1-9][0-9]*$' then raise exception 'Choose valid task dependencies.' using errcode='22023';end if;
   if split_part(v_key,':',1)='task' then perform 1 from public.estimate_tasks where id=split_part(v_key,':',2)::bigint and project_id=p_project_id;
   else perform 1 from public.estimate_categories where id=split_part(v_key,':',2)::bigint and project_id=p_project_id;end if;
   if not found then raise exception 'Dependencies must belong to the same project.' using errcode='22023';end if;
 end loop;
 if v_source=any(v_in||v_out) then raise exception 'A task cannot depend on itself.' using errcode='22023';end if;
 if exists(select 1 from unnest(v_out) key where key !~ '^task:') then
   raise exception 'Choose subtasks as successors.' using errcode='22023';end if;
 select coalesce(array_agg(predecessor_key order by predecessor_key),'{}'::text[]) into v_current_in from public.estimate_dependencies where project_id=p_project_id and successor_key=v_source;
 select coalesce(array_agg(successor_key order by successor_key),'{}'::text[]) into v_current_out from public.estimate_dependencies d where project_id=p_project_id and predecessor_key=v_source
   and d.successor_task_id is not null;
 if p_previous_predecessors is not null and v_current_in is distinct from array(select distinct x from unnest(p_previous_predecessors)x order by x)
   or p_previous_successors is not null and v_current_out is distinct from array(select distinct x from unnest(p_previous_successors)x order by x) then
   raise exception 'Dependencies changed while this form was open. Reopen the task and retry.' using errcode='40001';end if;
 if p_source_kind='category' and p_milestone is true and exists(select 1 from public.estimate_tasks where category_id=p_source_id) then
   raise exception 'A main task with subtasks cannot be a milestone.' using errcode='22023';end if;
 perform set_config('idrmm.dependency_sync','edges',true);
 if p_source_kind='category' then
   if p_name is not null and nullif(trim(p_name),'') is null then raise exception 'Task name is required.' using errcode='22023';end if;
   update public.estimate_categories set category_name=coalesce(trim(p_name),category_name),is_milestone=coalesce(p_milestone,is_milestone) where id=p_source_id and project_id=p_project_id;
 else update public.estimate_tasks set is_milestone=coalesce(p_milestone,is_milestone) where id=p_source_id and project_id=p_project_id;end if;
 get diagnostics v_count=row_count;if v_count<>1 then raise exception 'Task editing was denied.' using errcode='42501';end if;
 delete from public.estimate_dependencies where project_id=p_project_id and successor_key=v_source and not(predecessor_key=any(v_in));
 delete from public.estimate_dependencies d where project_id=p_project_id and predecessor_key=v_source and not(successor_key=any(v_out)) and d.successor_task_id is not null;
 insert into public.estimate_dependencies(project_id,predecessor_category_id,predecessor_task_id,successor_category_id,successor_task_id)
 select p_project_id,case when split_part(a,':',1)='category' then split_part(a,':',2)::bigint end,case when split_part(a,':',1)='task' then split_part(a,':',2)::bigint end,
   case when split_part(b,':',1)='category' then split_part(b,':',2)::bigint end,case when split_part(b,':',1)='task' then split_part(b,':',2)::bigint end
 from(select unnest(v_in) a,v_source b union select v_source a,unnest(v_out) b)x on conflict do nothing;
 perform public.assert_estimate_dependency_graph(p_project_id);perform public.project_dependency_projection(p_project_id);
 perform set_config('idrmm.dependency_sync',coalesce(v_sync,''),true);
end $$;
notify pgrst,'reload schema';
commit;
