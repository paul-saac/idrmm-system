-- Intent: centralize material purchase writes with Administrators and reserve
-- planned tasks, costs, schedules and allocations for Administrators/PMs.
-- Existing project access, session, invitation and backup guards remain active.
-- This migration changes permissions only; it does not change project records.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if not pg_try_advisory_xact_lock(18244,7291) then
    raise exception 'A backup operation is active. Retry after it finishes.';
  end if;
  if exists(select 1 from public.system_backup_state where maintenance or recovery_required) then
    raise exception 'Backup maintenance or recovery must finish before changing permissions.';
  end if;
end $$;

create or replace function public.project_workflow_role_allows_write(p_area text)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select coalesce(
    public.app_session_is_active() and public.invitation_setup_complete()
    and case p_area
      when 'purchases' then public.get_my_role() in ('admin','super_admin')
      when 'planning' then public.get_my_role() in ('admin','super_admin','project_manager')
      else false
    end, false);
$$;
revoke all on function public.project_workflow_role_allows_write(text) from public, anon;
grant execute on function public.project_workflow_role_allows_write(text) to authenticated;

-- Ordinary triggers also protect writes inside SECURITY DEFINER RPCs, which
-- bypass RLS. Trusted maintenance operations without an end-user JWT retain
-- their existing grants; anonymous clients receive no additional privileges.
create or replace function public.enforce_project_workflow_role()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_project bigint;
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if not public.project_workflow_role_allows_write(tg_argv[0]) then
    raise exception 'Your role cannot change project % records.', tg_argv[0] using errcode = '42501';
  end if;
  if tg_op <> 'INSERT' then
    v_project := public._access_row_project(tg_table_name,to_jsonb(old));
    -- A permitted parent deletion may cascade after that parent is gone.
    if tg_op = 'DELETE' and pg_trigger_depth() > 1
      and (v_project is null or not exists(select 1 from public.projects where id = v_project)) then
      return old;
    end if;
    if public.project_access_level(v_project) is distinct from 'edit' then
      raise exception 'Project edit access is required.' using errcode = '42501';
    end if;
  end if;
  if tg_op <> 'DELETE' then
    v_project := public._access_row_project(tg_table_name,to_jsonb(new));
    if public.project_access_level(v_project) is distinct from 'edit' then
      raise exception 'Project edit access is required.' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;
revoke all on function public.enforce_project_workflow_role() from public, anon, authenticated;

do $$
declare v_table text; v_area text; v_cmd text; v_check text;
begin
  foreach v_table in array array[
    'material_purchases','estimate_categories','estimate_tasks',
    'estimate_category_material_assignments','estimate_task_material_assignments',
    'estimate_task_other_costs','estimate_dependencies','gantt_snapshots',
    'task_worker_assignments','category_worker_assignments','equipment_task_plans'
  ] loop
    v_area := case when v_table = 'material_purchases' then 'purchases' else 'planning' end;
    v_check := format('public.project_workflow_role_allows_write(%L)',v_area);
    execute format('create or replace trigger project_workflow_role_guard before insert or update or delete on public.%I for each row execute function public.enforce_project_workflow_role(%L)',v_table,v_area);
    foreach v_cmd in array array['insert','update','delete'] loop
      execute format('drop policy if exists %I on public.%I','Workflow role ' || v_cmd,v_table);
      execute format('create policy %I on public.%I as restrictive for %s to authenticated %s',
        'Workflow role ' || v_cmd,v_table,v_cmd,
        case v_cmd when 'insert' then 'with check (' || v_check || ')'
          when 'update' then 'using (' || v_check || ') with check (' || v_check || ')'
          else 'using (' || v_check || ')' end);
    end loop;
  end loop;
end $$;

-- The planning RPCs also change the project's rate and history cursor.
create or replace trigger project_planning_fields_role_guard
before update of start_date, target_end_date, working_days, holidays,
  allocated_budget, default_labor_cost_percent, gantt_undo_cursor_id
on public.projects for each row
execute function public.enforce_project_workflow_role('planning');

-- Purchase attachments follow the same centralized recording policy.
-- Reading existing receipts and uploads to other buckets are unchanged.
do $$
declare v_cmd text; v_check text := '(bucket_id <> ''purchase-receipts'' or public.project_workflow_role_allows_write(''purchases''))';
begin
  foreach v_cmd in array array['insert','update','delete'] loop
    execute format('drop policy if exists %I on storage.objects','Purchase recorder ' || v_cmd);
    execute format('create policy %I on storage.objects as restrictive for %s to authenticated %s',
      'Purchase recorder ' || v_cmd,v_cmd,
      case v_cmd when 'insert' then 'with check (' || v_check || ')'
        when 'update' then 'using (' || v_check || ') with check (' || v_check || ')'
        else 'using (' || v_check || ')' end);
  end loop;
end $$;
commit;
