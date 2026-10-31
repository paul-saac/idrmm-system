-- Intent: make Gantt checkpoints and Undo/Redo transactional and project scoped.
-- Schedule history never restores saved accomplishment logs or actual progress.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.gantt_snapshot(p_project_id bigint)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'categories',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.estimate_categories c where c.project_id=p_project_id),'[]'::jsonb),
    'tasks',coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.estimate_tasks t where t.project_id=p_project_id),'[]'::jsonb),
    'otherCosts',coalesce((select jsonb_agg(to_jsonb(o) order by o.id) from public.estimate_task_other_costs o where
      o.task_id in(select id from public.estimate_tasks where project_id=p_project_id) or
      o.category_id in(select id from public.estimate_categories where project_id=p_project_id)),'[]'::jsonb),
    'materialAssignments',coalesce((select jsonb_agg(to_jsonb(m) order by m.id) from public.estimate_task_material_assignments m
      where m.task_id in(select id from public.estimate_tasks where project_id=p_project_id)),'[]'::jsonb),
    'categoryMaterialAssignments',coalesce((select jsonb_agg(to_jsonb(m) order by m.id) from public.estimate_category_material_assignments m
      where m.category_id in(select id from public.estimate_categories where project_id=p_project_id)),'[]'::jsonb)
  ) where public.app_session_is_active() and public.project_access_level(p_project_id) in ('view','edit');
$$;

-- Only this narrow cursor write needs elevated rights: foremen can edit schedules
-- without permission to edit the project's general information. No client-supplied
-- project fields or snapshot contents are written by this helper.
create or replace function public.set_gantt_history_cursor(p_project_id bigint,p_cursor bigint)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.app_session_is_active() is not true or public.invitation_setup_complete() is not true
    or public.project_access_level(p_project_id) is distinct from 'edit' then
    raise exception 'You do not have permission to edit this project.' using errcode='42501';
  end if;
  if public.system_backup_maintenance() then raise exception 'Saving is temporarily paused.' using errcode='55000'; end if;
  if not exists(select 1 from public.gantt_snapshots where id=p_cursor and project_id=p_project_id and created_by=auth.uid()) then
    raise exception 'This history belongs to a different editing session.' using errcode='40001';
  end if;
  update public.projects set gantt_undo_cursor_id=p_cursor where id=p_project_id;
end;
$$;

create or replace function public.gantt_history(p_project_id bigint,p_action text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_cursor bigint;
  v_target_id bigint;
  v_owner uuid;
  v_current jsonb;
  v_head jsonb;
  v_target jsonb;
  v_table text;
  v_key text;
  v_columns text;
  v_updates text;
  v_ignored text[];
  v_rows jsonb;
  v_deleted_tasks bigint[];
  v_deleted_categories bigint[];
begin
  if public.app_session_is_active() is not true or public.invitation_setup_complete() is not true
    or public.project_access_level(p_project_id) is distinct from 'edit' then
    raise exception 'You do not have permission to edit this project.' using errcode='42501';
  end if;
  if public.system_backup_maintenance() then raise exception 'Saving is temporarily paused.' using errcode='55000'; end if;
  if p_action is null or p_action not in ('reset','checkpoint','undo','redo') then
    raise exception 'Invalid history action.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('idrmm-gantt-project:'||p_project_id::text,0));
  select gantt_undo_cursor_id into v_cursor from public.projects where id=p_project_id;
  if not found then raise exception 'Project is unavailable.' using errcode='42501'; end if;
  -- Ordinary row edits also honor these locks, even if they do not use the
  -- history RPC. Wait before capturing, so Undo cannot overwrite an edit that
  -- committed while it was waiting for a row. Parent-first ordering is stable.
  perform 1 from public.estimate_categories where project_id=p_project_id order by id for update;
  perform 1 from public.estimate_tasks where project_id=p_project_id order by id for update;
  perform 1 from public.estimate_task_other_costs where task_id in(select id from public.estimate_tasks where project_id=p_project_id)
    or category_id in(select id from public.estimate_categories where project_id=p_project_id) order by id for update;
  perform 1 from public.estimate_task_material_assignments where task_id in(select id from public.estimate_tasks where project_id=p_project_id) order by id for update;
  perform 1 from public.estimate_category_material_assignments where category_id in(select id from public.estimate_categories where project_id=p_project_id) order by id for update;
  v_current:=public.gantt_snapshot(p_project_id);
  select snapshot,created_by into v_head,v_owner from public.gantt_snapshots where id=v_cursor and project_id=p_project_id;

  if p_action in ('reset','checkpoint') then
    -- Keep the existing visit-scoped baseline. A different editor starting a visit
    -- cannot later undo this editor's work: history traversal checks its author.
    if p_action='reset' or v_owner is distinct from auth.uid() then
      delete from public.gantt_snapshots where project_id=p_project_id;
    elsif v_head is not distinct from v_current then
      return jsonb_build_object('canUndo',exists(select 1 from public.gantt_snapshots where project_id=p_project_id and id<v_cursor),
        'canRedo',exists(select 1 from public.gantt_snapshots where project_id=p_project_id and id>v_cursor));
    else
      delete from public.gantt_snapshots where project_id=p_project_id and (v_cursor is null or id>v_cursor);
    end if;
    insert into public.gantt_snapshots(project_id,snapshot,created_by) values(p_project_id,v_current,auth.uid()) returning id into v_cursor;
    perform public.set_gantt_history_cursor(p_project_id,v_cursor);
    delete from public.gantt_snapshots where project_id=p_project_id and id in
      (select id from public.gantt_snapshots where project_id=p_project_id order by id desc offset 101);
  else
    if v_cursor is null or v_owner is distinct from auth.uid() then
      raise exception 'The schedule history changed in another session. Refresh the project before continuing.' using errcode='40001';
    end if;
    -- Ignore the legacy cached percent_complete column when detecting conflicts;
    -- actual progress belongs to saved logs and is never restored by this function.
    v_head:=jsonb_set(v_head,'{tasks}',coalesce((select jsonb_agg(value-'percent_complete' order by (value->>'id')::bigint) from jsonb_array_elements(v_head->'tasks')),'[]'::jsonb));
    if v_head is distinct from jsonb_set(v_current,'{tasks}',coalesce((select jsonb_agg(value-'percent_complete' order by (value->>'id')::bigint) from jsonb_array_elements(v_current->'tasks')),'[]'::jsonb)) then
      raise exception 'The schedule changed outside this history. Refresh the project before continuing.' using errcode='40001';
    end if;
    select id,snapshot into v_target_id,v_target from public.gantt_snapshots where project_id=p_project_id
      and created_by=auth.uid() and case when p_action='undo' then id<v_cursor else id>v_cursor end
      order by case when p_action='undo' then -id else id end limit 1;
    if not found then raise exception 'Nothing to %.',p_action using errcode='P0002'; end if;
    select coalesce(array_agg((value->>'id')::bigint),'{}'::bigint[]) into v_deleted_tasks from jsonb_array_elements(v_current->'tasks')
      where (value->>'id')::bigint not in(select (value->>'id')::bigint from jsonb_array_elements(v_target->'tasks'));
    select coalesce(array_agg((value->>'id')::bigint),'{}'::bigint[]) into v_deleted_categories from jsonb_array_elements(v_current->'categories')
      where (value->>'id')::bigint not in(select (value->>'id')::bigint from jsonb_array_elements(v_target->'categories'));
    if exists(select 1 from public.task_progress_entries where task_id=any(v_deleted_tasks))
      or exists(select 1 from public.category_progress_entries where category_id=any(v_deleted_categories))
      or exists(select 1 from public.task_worker_assignments where task_id=any(v_deleted_tasks))
      or exists(select 1 from public.category_worker_assignments where category_id=any(v_deleted_categories))
      or exists(select 1 from public.equipment_task_assignments where task_id=any(v_deleted_tasks) or category_id=any(v_deleted_categories))
      or exists(select 1 from public.project_safety_incidents where task_id=any(v_deleted_tasks) or category_id=any(v_deleted_categories)) then
      raise exception 'This task now has progress, assigned resources, or incidents. Undo cannot remove those records.' using errcode='55000';
    end if;

    -- Restore parents before children. Temporarily omit dependency links until all
    -- referenced rows exist; changed rows alone are written. RLS remains enabled.
    for v_table,v_key in select * from (values
      ('estimate_categories','categories'),('estimate_tasks','tasks'),
      ('estimate_task_other_costs','otherCosts'),('estimate_task_material_assignments','materialAssignments'),
      ('estimate_category_material_assignments','categoryMaterialAssignments')) as t(tab,key)
    loop
      v_rows:=coalesce(v_target->v_key,'[]'::jsonb);
      v_ignored:=array['percent_complete'];
      if v_table in ('estimate_categories','estimate_tasks') then
        v_ignored:=v_ignored||array['predecessor_task_id','predecessor_category_id'];
        select coalesce(jsonb_agg(value||jsonb_build_object('predecessor_task_id',null,'predecessor_category_id',null)),'[]'::jsonb)
          into v_rows from jsonb_array_elements(v_rows);
      end if;
      -- Whitelisted tables only; SQL identifiers come from PostgreSQL's catalog,
      -- never from user input. Exclude actual progress from both INSERT and UPDATE.
      select string_agg(format('%I',attname),',' order by attnum),
        string_agg(format('%1$I=excluded.%1$I',attname),',' order by attnum) filter(where attname<>'id')
        into v_columns,v_updates from pg_attribute where attrelid=('public.'||v_table)::regclass
          and attnum>0 and not attisdropped and attgenerated='' and attname<>'percent_complete';
      execute format('insert into public.%1$I as live(%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I,$1)
        on conflict(id) do update set %3$s where (to_jsonb(live)-$2) is distinct from (to_jsonb(excluded)-$2)',
        v_table,v_columns,v_updates) using v_rows,v_ignored;
    end loop;
    -- Tasks that changed parents have already moved, so category deletion cannot
    -- cascade into a task that should survive in the destination snapshot.
    delete from public.estimate_tasks where project_id=p_project_id and id=any(v_deleted_tasks);
    delete from public.estimate_categories where project_id=p_project_id and id=any(v_deleted_categories);
    for v_table,v_key in select * from (values
      ('estimate_task_other_costs','otherCosts'),('estimate_task_material_assignments','materialAssignments'),
      ('estimate_category_material_assignments','categoryMaterialAssignments')) as t(tab,key)
    loop
      execute format('delete from public.%I where id in(select (value->>''id'')::bigint from jsonb_array_elements($1))
        and id not in(select (value->>''id'')::bigint from jsonb_array_elements($2))',v_table)
        using coalesce(v_current->v_key,'[]'::jsonb),coalesce(v_target->v_key,'[]'::jsonb);
    end loop;
    update public.estimate_categories live set predecessor_task_id=x.predecessor_task_id,predecessor_category_id=x.predecessor_category_id
      from jsonb_populate_recordset(null::public.estimate_categories,v_target->'categories') x
      where live.id=x.id and live.project_id=p_project_id and
        (live.predecessor_task_id,live.predecessor_category_id) is distinct from (x.predecessor_task_id,x.predecessor_category_id);
    update public.estimate_tasks live set predecessor_task_id=x.predecessor_task_id,predecessor_category_id=x.predecessor_category_id
      from jsonb_populate_recordset(null::public.estimate_tasks,v_target->'tasks') x
      where live.id=x.id and live.project_id=p_project_id and
        (live.predecessor_task_id,live.predecessor_category_id) is distinct from (x.predecessor_task_id,x.predecessor_category_id);
    -- A concurrent insertion is never swept into the deletion set. If it changed
    -- the final schedule, abort this traversal rather than claim a partial restore.
    v_current:=public.gantt_snapshot(p_project_id);
    if jsonb_set(v_current,'{tasks}',coalesce((select jsonb_agg(value-'percent_complete' order by (value->>'id')::bigint) from jsonb_array_elements(v_current->'tasks')),'[]'::jsonb))
      is distinct from jsonb_set(v_target,'{tasks}',coalesce((select jsonb_agg(value-'percent_complete' order by (value->>'id')::bigint) from jsonb_array_elements(v_target->'tasks')),'[]'::jsonb)) then
      raise exception 'The schedule changed during Undo/Redo. Refresh the project and retry.' using errcode='40001';
    end if;
    v_cursor:=v_target_id;
    perform public.set_gantt_history_cursor(p_project_id,v_cursor);
  end if;
  return jsonb_build_object('canUndo',exists(select 1 from public.gantt_snapshots where project_id=p_project_id and id<v_cursor and created_by=auth.uid()),
    'canRedo',exists(select 1 from public.gantt_snapshots where project_id=p_project_id and id>v_cursor and created_by=auth.uid()));
end;
$$;

revoke all on function public.gantt_snapshot(bigint),public.set_gantt_history_cursor(bigint,bigint),public.gantt_history(bigint,text) from public,anon;
grant execute on function public.gantt_snapshot(bigint),public.set_gantt_history_cursor(bigint,bigint),public.gantt_history(bigint,text) to authenticated;
notify pgrst,'reload schema';
commit;
