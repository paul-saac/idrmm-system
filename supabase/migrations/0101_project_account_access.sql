-- Intent: editable per-account project access, with view-only protection for
-- project records, database RPC writes, and project attachment uploads.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$ begin
  if to_regclass('public.equipment_requisitions') is not null
    or to_regclass('public.equipment_movement_events') is not null
    or to_regprocedure('public.record_equipment_operation(bigint,jsonb)') is not null then
    raise exception 'Apply migrations 0099 and 0100 before project access migration 0101.';
  end if;
end $$;

create table public.project_account_access (
  project_id bigint not null references public.projects(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  access_level text not null check (access_level in ('none', 'view', 'edit')),
  granted_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (project_id, profile_id)
);
create index project_account_access_profile_idx on public.project_account_access(profile_id);
alter table public.project_account_access enable row level security;
revoke all on public.project_account_access from anon, authenticated;
grant select on public.project_account_access to authenticated;

-- Internal helper can evaluate a target account; it is not client-callable.
create function public._project_access_level(p_project_id bigint, p_profile_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select 'edit' from public.profiles 
    where id = p_profile_id and role in ('admin','super_admin')
      and status = 'active' and not invitation_pending), (
    select case
      when u.role in ('admin','super_admin') then 'edit'
      when u.role not in ('foreman','project_manager') then 'none'
      else coalesce(a.access_level,
        case when (u.role = 'foreman' and p.foreman_id = u.id)
          or (u.role = 'project_manager' and p.project_manager_id = u.id)
        then 'edit' else 'none' end)
    end
    from public.projects p
    join public.profiles u on u.id = p_profile_id
      and u.status = 'active' and not u.invitation_pending
    left join public.project_account_access a on a.project_id = p.id and a.profile_id = u.id
    where p.id = p_project_id
  ), 'none');
$$;
revoke all on function public._project_access_level(bigint,uuid) from public, anon, authenticated;

create function public.project_access_level(p_project_id bigint)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select public._project_access_level(p_project_id, auth.uid());
$$;
revoke all on function public.project_access_level(bigint) from public, anon;
grant execute on function public.project_access_level(bigint) to authenticated;

create function public.can_manage_project_access(p_project_id bigint)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.project_access_level(p_project_id) = 'edit'
    and exists (select 1 from public.profiles u join public.projects p on p.id = p_project_id
      where u.id = auth.uid() and (u.role in ('admin','super_admin')
        or (u.role = 'project_manager' and p.project_manager_id = u.id)));
$$;
revoke all on function public.can_manage_project_access(bigint) from public, anon;
grant execute on function public.can_manage_project_access(bigint) to authenticated;

-- Existing project-scoped read policies already use this shared helper.
-- Restrictive write policies and triggers below distinguish view from edit.
create or replace function public.is_project_foreman(p_project_id bigint)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.get_my_role() in ('foreman','project_manager')
    and public.project_access_level(p_project_id) in ('view','edit');
$$;
create or replace function public.can_read_project_sheets(p_id bigint)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.project_access_level(p_id) in ('view','edit');
$$;

create policy "Read own or managed project access" on public.project_account_access
  for select to authenticated using (
    profile_id = auth.uid() or public.can_manage_project_access(project_id)
  );

create function public.project_account_access_editor(p_profile_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_target public.profiles; v_actor public.profiles;
begin
  select * into v_actor from public.profiles where id = auth.uid()
    and status = 'active' and not invitation_pending;
  if v_actor.id is null or v_actor.role not in ('admin','super_admin','project_manager') then
    raise exception 'Project access management denied.' using errcode = '42501';
  end if;
  select * into v_target from public.profiles where id = p_profile_id;
  if v_target.id is null or v_target.role not in ('project_manager','foreman') then
    raise exception 'Choose a project manager or foreman account.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'eligible', v_target.status = 'active' and not v_target.invitation_pending,
    'projects', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.project_name, 'location', p.location,
      'level', public._project_access_level(p.id, v_target.id),
      'assigned', p.project_manager_id = v_target.id or p.foreman_id = v_target.id
    ) order by p.project_name, p.id) from public.projects p
      where public.can_manage_project_access(p.id)), '[]'::jsonb)
  );
end;
$$;

create function public.save_project_account_access(p_profile_id uuid, p_changes jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor public.profiles; v_target public.profiles; v_change jsonb;
  v_project public.projects; v_level text; v_previous text;
begin
  select * into v_actor from public.profiles where id = auth.uid()
    and status = 'active' and not invitation_pending;
  if v_actor.id is null or v_actor.role not in ('admin','super_admin','project_manager') then
    raise exception 'Project access management denied.' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array'
    or jsonb_array_length(p_changes) not between 1 and 500 then
    raise exception 'Choose valid project access changes.' using errcode = '22023';
  end if;
  select * into v_target from public.profiles where id = p_profile_id for update;
  if v_target.id is null or v_target.role not in ('project_manager','foreman')
    or v_target.id = v_actor.id then
    raise exception 'You cannot change this account''s project access.' using errcode = '42501';
  end if;
  if (select count(*) <> count(distinct value->>'id') from jsonb_array_elements(p_changes)) then
    raise exception 'Each project may appear only once.' using errcode = '22023';
  end if;
  for v_change in select value from jsonb_array_elements(p_changes) order by (value->>'id')::bigint loop
    v_level := v_change->>'level'; v_previous := v_change->>'previous';
    if v_level is null or v_level not in ('none','view','edit')
      or v_previous is null or v_previous not in ('none','view','edit') then
      raise exception 'Choose a valid access level.' using errcode = '22023';
    end if;
    select * into v_project from public.projects where id = (v_change->>'id')::bigint for update;
    if v_project.id is null or not public.can_manage_project_access(v_project.id) then
      raise exception 'You may only manage access to projects you manage.' using errcode = '42501';
    end if;
    if v_level <> 'none' and (v_target.status <> 'active' or v_target.invitation_pending) then
      raise exception 'The account must be active and accept its invitation first.' using errcode = '22023';
    end if;
    if public._project_access_level(v_project.id, v_target.id) <> v_previous then
      raise exception 'Access changed since this panel opened. Reopen it and try again.' using errcode = '40001';
    end if;
    insert into public.project_account_access(project_id,profile_id,access_level,granted_by)
      values(v_project.id,v_target.id,v_level,v_actor.id)
      on conflict(project_id,profile_id) do update set access_level = excluded.access_level,
        granted_by = excluded.granted_by, updated_at = now();
    insert into public.account_events(actor_id,actor_name,target_id,target_name,action,details)
      values(v_actor.id,concat_ws(' ',v_actor.first_name,v_actor.last_name),v_target.id,
        concat_ws(' ',v_target.first_name,v_target.last_name),'edited',
        format('Project access: %s — %s',v_project.project_name,v_level));
  end loop;
end;
$$;
revoke all on function public.project_account_access_editor(uuid) from public, anon;
revoke all on function public.save_project_account_access(uuid,jsonb) from public, anon;
grant execute on function public.project_account_access_editor(uuid) to authenticated;
grant execute on function public.save_project_account_access(uuid,jsonb) to authenticated;

-- Resolve only the current workflow's project-owned records. Indirect child
-- tables are checked through their saved parent, never a client-supplied grant.
create function public._access_row_project(p_table text, p_row jsonb)
returns bigint language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  if p_table = 'projects' then return (p_row->>'id')::bigint; end if;
  if p_row ? 'project_id' then return (p_row->>'project_id')::bigint; end if;
  if p_table like 'task_progress_%' and p_row ? 'progress_entry_id' then
    select t.project_id into v_id from task_progress_entries e join estimate_tasks t on t.id=e.task_id
      where e.id=(p_row->>'progress_entry_id')::bigint;
  elsif p_table like 'category_progress_%' and p_row ? 'progress_entry_id' then
    select c.project_id into v_id from category_progress_entries e join estimate_categories c on c.id=e.category_id
      where e.id=(p_row->>'progress_entry_id')::bigint;
  elsif p_table = 'project_sheet_reviews' then
    select project_id into v_id from project_sheets where id=(p_row->>'sheet_id')::bigint;
  elsif p_table = 'material_request_items' then
    select project_id into v_id from material_requests where id=(p_row->>'material_request_id')::bigint;
  elsif p_table = 'equipment_request_items' then
    select project_id into v_id from equipment_requests where id=(p_row->>'equipment_request_id')::bigint;
  elsif p_row->>'task_id' is not null then
    select project_id into v_id from estimate_tasks where id=(p_row->>'task_id')::bigint;
  elsif p_row->>'category_id' is not null then
    select project_id into v_id from estimate_categories where id=(p_row->>'category_id')::bigint;
  end if;
  return v_id;
end;
$$;
revoke all on function public._access_row_project(text,jsonb) from public, anon, authenticated;

create function public.can_write_project_row(p_table text, p_row jsonb)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.project_access_level(public._access_row_project(p_table,p_row)) = 'edit';
$$;
revoke all on function public.can_write_project_row(text,jsonb) from public, anon;
grant execute on function public.can_write_project_row(text,jsonb) to authenticated;

create function public.can_read_project_row(p_table text, p_row jsonb)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.project_access_level(public._access_row_project(p_table,p_row)) in ('view','edit');
$$;
revoke all on function public.can_read_project_row(text,jsonb) from public, anon;
grant execute on function public.can_read_project_row(text,jsonb) to authenticated;

-- SECURITY DEFINER RPCs bypass RLS, but cannot bypass ordinary row triggers.
create function public.enforce_project_write_access()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old bigint; v_new bigint;
begin
  -- Maintenance/service operations have no end-user JWT. Their table grants
  -- and RLS remain unchanged; authenticated operations must pass this guard.
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op <> 'INSERT' then
    v_old := public._access_row_project(tg_table_name,to_jsonb(old));
    -- A checked parent deletion can cascade after the parent is gone.
    if tg_op = 'DELETE' and pg_trigger_depth() > 1
      and (v_old is null or not exists (select 1 from projects where id = v_old)) then return old; end if;
    if public.project_access_level(v_old) <> 'edit' then
      raise exception 'This project is view only or access was removed.' using errcode = '42501';
    end if;
  end if;
  if tg_op <> 'DELETE' then
    v_new := public._access_row_project(tg_table_name,to_jsonb(new));
    -- Creating the project is an existing administrator-only operation.
    if not (tg_table_name = 'projects' and tg_op = 'INSERT' and public.get_my_role() = 'admin')
      and public.project_access_level(v_new) <> 'edit' then
      raise exception 'This project is view only or access was removed.' using errcode = '42501';
    end if;
    return new;
  end if;
  return old;
end;
$$;
revoke all on function public.enforce_project_write_access() from public, anon, authenticated;

do $$
declare v_table text; v_cmd text;
begin
  foreach v_table in array array[
    'projects','estimate_categories','estimate_tasks','estimate_category_material_assignments',
    'estimate_task_material_assignments','estimate_task_other_costs','category_worker_assignments',
    'task_worker_assignments','gantt_snapshots','task_progress_entries','category_progress_entries',
    'task_progress_attendance','category_progress_attendance','task_progress_material_entries',
    'category_progress_material_entries','task_progress_equipment_cost_entries',
    'category_progress_equipment_cost_entries','task_progress_other_cost_entries',
    'category_progress_other_cost_entries','progress_override_logs','equipment_assignments',
    'equipment_task_assignments','equipment_task_plans','equipment_requests','equipment_request_items',
    'material_requests','material_request_items','material_purchases','project_materials',
    'project_events','project_sheets','project_sheet_reviews','project_closeout_reports',
    'project_punch_items','project_quality_inspections','project_safety_incidents'
  ] loop
    if to_regclass('public.' || v_table) is null then continue; end if;
    -- TRUNCATE bypasses both row policies and row triggers; the application
    -- uses scoped DELETE operations, never client-side table truncation.
    execute format('revoke truncate on public.%I from anon, authenticated',v_table);
    execute format('create trigger project_write_access before insert or update or delete on public.%I for each row execute function public.enforce_project_write_access()',v_table);
    execute format('create policy %I on public.%I as restrictive for select to authenticated using (public.can_read_project_row(%L,to_jsonb(%I.*)))',
      'Project access read guard',v_table,v_table,v_table);
    foreach v_cmd in array array['INSERT','UPDATE','DELETE'] loop
      if v_cmd = 'INSERT' then
        execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (%s)',
          'Project access insert guard',v_table,
          case when v_table = 'projects' then 'public.get_my_role() = ''admin'''
          else format('public.can_write_project_row(%L,to_jsonb(%I.*))',v_table,v_table) end);
      elsif v_cmd = 'UPDATE' then
        execute format('create policy %I on public.%I as restrictive for update to authenticated using (public.can_write_project_row(%L,to_jsonb(%I.*))) with check (public.can_write_project_row(%L,to_jsonb(%I.*)))',
          'Project access update guard',v_table,v_table,v_table,v_table,v_table);
      else
        execute format('create policy %I on public.%I as restrictive for delete to authenticated using (public.can_write_project_row(%L,to_jsonb(%I.*)))',
          'Project access delete guard',v_table,v_table,v_table);
      end if;
    end loop;
  end loop;
end;
$$;

-- Keep read/download access. Upload, replace and delete require edit access.
do $$
declare v_cmd text; v_expression text;
begin
  if to_regclass('storage.objects') is null then return; end if;
  execute 'create policy "Project access attachment read" on storage.objects as restrictive for select to authenticated using (bucket_id not in (''project-sheets'',''incident-evidence'') or public.project_access_level(case when split_part(name,''/'',1) ~ ''^[1-9][0-9]{0,14}$'' then split_part(name,''/'',1)::bigint else null end) in (''view'',''edit''))';
  v_expression := '(bucket_id not in (''project-sheets'',''incident-evidence'',''purchase-receipts'') or public.project_access_level(case when split_part(name,''/'',1) ~ ''^[1-9][0-9]{0,14}$'' then split_part(name,''/'',1)::bigint else null end) = ''edit'')';
  foreach v_cmd in array array['INSERT','UPDATE','DELETE'] loop
    execute format('create policy %I on storage.objects as restrictive for %s to authenticated %s',
      'Project access attachment ' || lower(v_cmd),v_cmd,
      case v_cmd when 'INSERT' then 'with check (' || v_expression || ')'
        when 'UPDATE' then 'using (' || v_expression || ') with check (' || v_expression || ')'
        else 'using (' || v_expression || ')' end);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
