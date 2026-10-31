-- Intent: save incoming/outgoing task dependencies together, retaining project
-- permissions, milestone/name fields, cycle protection and one history action.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create or replace function public.save_estimate_links(
  p_project_id bigint,p_source_kind text,p_source_id bigint,
  p_predecessor_kind text,p_predecessor_id bigint,p_successor_kind text,p_successor_id bigint,
  p_milestone boolean default null,p_name text default null,
  p_previous_successor_kind text default null,p_previous_successor_id bigint default null
) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_kind text;v_id bigint;v_count integer;v_cycle boolean;v_roots text[];
begin
  if public.app_session_is_active() is not true or public.project_access_level(p_project_id) is distinct from 'edit' then
    raise exception 'You do not have permission to edit this project.' using errcode='42501';
  end if;
  if public.system_backup_maintenance() then raise exception 'Saving is temporarily paused.' using errcode='55000';end if;
  if p_source_kind is null or p_source_kind not in ('task','category') or p_source_id is null or p_source_id<=0
    or num_nonnulls(p_predecessor_kind,p_predecessor_id)=1 or num_nonnulls(p_successor_kind,p_successor_id)=1
    or num_nonnulls(p_previous_successor_kind,p_previous_successor_id)=1 then
    raise exception 'Choose valid task dependencies.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('idrmm-gantt-project:'||p_project_id::text,0));
  perform 1 from public.estimate_categories where project_id=p_project_id order by id for update;
  perform 1 from public.estimate_tasks where project_id=p_project_id order by id for update;
  for v_kind,v_id in select * from (values(p_source_kind,p_source_id),(p_predecessor_kind,p_predecessor_id),(p_successor_kind,p_successor_id),(p_previous_successor_kind,p_previous_successor_id)) x(kind,id) loop
    if v_id is null then continue;end if;
    if v_kind is null or v_kind not in ('task','category') or v_id<=0 then raise exception 'Choose valid task dependencies.' using errcode='22023';end if;
    if v_kind='task' then perform 1 from public.estimate_tasks where id=v_id and project_id=p_project_id;
    else perform 1 from public.estimate_categories where id=v_id and project_id=p_project_id;end if;
    if not found then raise exception 'Dependencies must belong to the same project.' using errcode='22023';end if;
  end loop;
  if (p_predecessor_kind=p_source_kind and p_predecessor_id=p_source_id) or (p_successor_kind=p_source_kind and p_successor_id=p_source_id) then
    raise exception 'A task cannot depend on itself.' using errcode='22023';
  end if;
  if p_source_kind='category' then
    if p_milestone and exists(select 1 from public.estimate_tasks where category_id=p_source_id and project_id=p_project_id) then
      raise exception 'A main task with subtasks cannot be a milestone.' using errcode='22023';
    end if;
    if p_name is not null and nullif(btrim(p_name),'') is null then raise exception 'Task name is required.' using errcode='22023';end if;
    update public.estimate_categories set category_name=coalesce(btrim(p_name),category_name),is_milestone=coalesce(p_milestone,is_milestone),
      predecessor_task_id=case when p_predecessor_kind='task' then p_predecessor_id end,
      predecessor_category_id=case when p_predecessor_kind='category' then p_predecessor_id end
      where id=p_source_id and project_id=p_project_id;
  else
    update public.estimate_tasks set is_milestone=coalesce(p_milestone,is_milestone),
      predecessor_task_id=case when p_predecessor_kind='task' then p_predecessor_id end,
      predecessor_category_id=case when p_predecessor_kind='category' then p_predecessor_id end
      where id=p_source_id and project_id=p_project_id;
  end if;
  get diagnostics v_count=row_count;
  if v_count<>1 then raise exception 'Task editing was denied.' using errcode='42501';end if;
  -- Replace only the successor shown in this form. Incoming links configured on
  -- other tasks can create branches; changing a predecessor must preserve them.
  if p_previous_successor_id is not null and (p_previous_successor_kind,p_previous_successor_id) is distinct from (p_successor_kind,p_successor_id) then
    if p_previous_successor_kind='category' then
      update public.estimate_categories set predecessor_category_id=null,predecessor_task_id=null where id=p_previous_successor_id and project_id=p_project_id
        and (case when p_source_kind='category' then predecessor_category_id else predecessor_task_id end)=p_source_id;
    else
      update public.estimate_tasks set predecessor_category_id=null,predecessor_task_id=null where id=p_previous_successor_id and project_id=p_project_id
        and (case when p_source_kind='category' then predecessor_category_id else predecessor_task_id end)=p_source_id;
    end if;
    get diagnostics v_count=row_count;
    if v_count<>1 then raise exception 'The successor changed in another session. Reopen the task and retry.' using errcode='40001';end if;
  end if;
  if p_successor_id is not null then
    if p_successor_kind='category' then
      update public.estimate_categories set predecessor_task_id=case when p_source_kind='task' then p_source_id end,
        predecessor_category_id=case when p_source_kind='category' then p_source_id end where id=p_successor_id and project_id=p_project_id;
    else
      update public.estimate_tasks set predecessor_task_id=case when p_source_kind='task' then p_source_id end,
        predecessor_category_id=case when p_source_kind='category' then p_source_id end where id=p_successor_id and project_id=p_project_id;
    end if;
    get diagnostics v_count=row_count;
    if v_count<>1 then raise exception 'Successor editing was denied.' using errcode='42501';end if;
  end if;
  v_roots:=array[p_source_kind||':'||p_source_id,p_source_kind||':'||p_source_id||':start',p_successor_kind||':'||p_successor_id,p_successor_kind||':'||p_successor_id||':start'];
  -- Summary start and finish are separate virtual nodes. A successor waits for
  -- every child, and a group's incoming dependency constrains all its children.
  with recursive edges(source,target) as (
    select coalesce('task:'||c.predecessor_task_id,'category:'||c.predecessor_category_id),
      'category:'||c.id||case when exists(select 1 from public.estimate_tasks t where t.category_id=c.id and t.project_id=p_project_id) then ':start' else '' end
      from public.estimate_categories c where c.project_id=p_project_id and num_nonnulls(c.predecessor_task_id,c.predecessor_category_id)>0
    union select coalesce('task:'||predecessor_task_id,'category:'||predecessor_category_id),'task:'||id
      from public.estimate_tasks where project_id=p_project_id and num_nonnulls(predecessor_task_id,predecessor_category_id)>0
    union select 'category:'||category_id||':start','task:'||id from public.estimate_tasks where project_id=p_project_id
    union select 'task:'||id,'category:'||category_id from public.estimate_tasks where project_id=p_project_id
  ), walk(root,node) as (
    select source,target from edges where source=any(v_roots)
    union select walk.root,edges.target from edges join walk on edges.source=walk.node
  ) select exists(select 1 from walk where root=node) into v_cycle;
  if v_cycle then raise exception 'These dependencies would create a circular dependency.' using errcode='22023';end if;
end;
$$;
revoke all on function public.save_estimate_links(bigint,text,bigint,text,bigint,text,bigint,boolean,text,text,bigint) from public,anon;
grant execute on function public.save_estimate_links(bigint,text,bigint,text,bigint,text,bigint,boolean,text,text,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
