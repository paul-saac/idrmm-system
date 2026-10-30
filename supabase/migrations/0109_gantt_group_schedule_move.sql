-- Intent: move selected Gantt schedules atomically, preserving actual progress,
-- existing permissions, maintenance guards and concurrent schedule edits.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.move_selected_schedules(p_project_id bigint, p_changes jsonb)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_change record;
  v_start date;
  v_end date;
  v_milestone boolean;
  v_count integer;
begin
  if public.app_session_is_active() is not true or public.project_access_level(p_project_id) is distinct from 'edit' then
    raise exception 'You do not have permission to edit this project.' using errcode='42501';
  end if;
  if public.system_backup_maintenance() then
    raise exception 'Saving is temporarily paused.' using errcode='55000';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'Select valid schedule rows.' using errcode='22023';
  end if;
  if jsonb_array_length(p_changes) not between 1 and 1000 then
    raise exception 'Select between 1 and 1,000 schedule rows.' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_to_recordset(p_changes) as x(kind text,id bigint) group by kind,id having count(*)>1) then
    raise exception 'A schedule row was selected more than once.' using errcode='22023';
  end if;
  -- Foremen may edit schedules without UPDATE rights on the project itself.
  -- Serialize group moves without requiring a broader project-row permission.
  perform pg_advisory_xact_lock(hashtextextended('idrmm-gantt-project:'||p_project_id::text,0));
  perform 1 from public.projects where id=p_project_id;
  if not found then raise exception 'Project is unavailable.' using errcode='42501'; end if;

  for v_change in
    select * from jsonb_to_recordset(p_changes) as x(kind text,id bigint,start date,"end" date,"previousStart" date,"previousEnd" date)
    order by kind,id
  loop
    if v_change.kind is null or v_change.kind not in ('category','task') or v_change.id is null or v_change.id<=0
      or v_change.start is null or v_change."end" is null or v_change."end"<v_change.start
      or v_change.start<date '1980-01-01' or v_change."end">date '2100-12-31' then
      raise exception 'Selected schedules contain invalid dates or records.' using errcode='22023';
    end if;
    if v_change.kind='category' then
      select planned_start_date,planned_end_date,is_milestone into v_start,v_end,v_milestone
        from public.estimate_categories where id=v_change.id and project_id=p_project_id for update;
      if not found then raise exception 'A selected main task is unavailable.' using errcode='22023'; end if;
      if exists(select 1 from public.estimate_tasks where category_id=v_change.id and project_id=p_project_id) then
        raise exception 'Move a summary through its subtasks.' using errcode='22023';
      end if;
    else
      select planned_start_date,planned_end_date,is_milestone into v_start,v_end,v_milestone
        from public.estimate_tasks where id=v_change.id and project_id=p_project_id for update;
      if not found then raise exception 'A selected task is unavailable.' using errcode='22023'; end if;
    end if;
    if v_start is distinct from v_change."previousStart" or v_end is distinct from v_change."previousEnd" then
      raise exception 'A selected schedule changed. Refresh the project and retry.' using errcode='40001';
    end if;
    if v_milestone and v_change.start<>v_change."end" then
      raise exception 'A milestone must remain a single date.' using errcode='22023';
    end if;
    if v_change.kind='category' then
      update public.estimate_categories set planned_start_date=v_change.start,planned_end_date=v_change."end"
        where id=v_change.id and project_id=p_project_id;
    else
      update public.estimate_tasks set planned_start_date=v_change.start,planned_end_date=v_change."end"
        where id=v_change.id and project_id=p_project_id;
    end if;
    get diagnostics v_count=row_count;
    if v_count<>1 then raise exception 'A selected schedule could not be updated.' using errcode='42501'; end if;
  end loop;
end;
$$;
revoke all on function public.move_selected_schedules(bigint,jsonb) from public,anon;
grant execute on function public.move_selected_schedules(bigint,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
