-- Intent: retain completed projects and attachments in a read-only archive;
-- only active administrators may archive/unarchive, without changing progress.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$ begin
  if to_regprocedure('public._project_access_level(bigint,uuid)') is null
    or to_regprocedure('public.enforce_project_write_access()') is null then
    raise exception 'Apply migration 0101 before project archiving.';
  end if;
end $$;

alter table public.projects
  add column archived_at timestamptz,
  add column archived_by uuid references public.profiles(id) on delete restrict,
  add column archive_reason text,
  add constraint projects_archive_metadata check (
    (archived_at is null and archived_by is null and archive_reason is null)
    or (archived_at is not null and archived_by is not null)
  );
create index projects_archived_at_idx on public.projects(archived_at);
-- Normal application accounts retain projects by archiving. Database-owner
-- maintenance remains available outside the application's delete flow.
revoke delete,truncate on public.projects from anon,authenticated;

-- Preserve the previous access decision, including explicit 'none' overrides.
-- Administrators still see every project, but nobody edits an archived one.
create or replace function public._project_access_level(p_project_id bigint, p_profile_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select case when p.archived_at is not null and permission.level = 'edit'
      then 'view' else permission.level end
    from public.projects p
    join public.profiles u on u.id = p_profile_id
      and u.status = 'active' and not u.invitation_pending
    left join public.project_account_access a on a.project_id=p.id and a.profile_id=u.id
    cross join lateral (select case
      when u.role in ('admin','super_admin') then 'edit'
      when u.role not in ('foreman','project_manager') then 'none'
      else coalesce(a.access_level, case
        when (u.role='foreman' and p.foreman_id=u.id)
          or (u.role='project_manager' and p.project_manager_id=u.id)
        then 'edit' else 'none' end)
    end as level) permission
    where p.id=p_project_id
  ), 'none');
$$;

-- Row locks serialize archive operations with in-flight project writes.
-- This also guards trusted server clients whose database role bypasses RLS.
create function public._assert_project_unarchived(p_id bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_archived timestamptz;
begin
  select archived_at into v_archived from public.projects where id=p_id for share;
  if v_archived is not null then
    raise exception 'This project is archived and read only. Unarchive it before making changes.' using errcode='42501';
  end if;
end;
$$;
revoke all on function public._assert_project_unarchived(bigint) from public,anon,authenticated;

create or replace function public.enforce_project_write_access()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old bigint; v_new bigint; v_actor uuid;
begin
  -- A narrowly scoped metadata transition is the only write allowed on an
  -- archived project. RLS is bypassed only by the dedicated definer RPC below.
  if tg_table_name='projects' then
    if tg_op='INSERT' then
      if new.archived_at is not null or new.archived_by is not null or new.archive_reason is not null then
        raise exception 'Create the project before archiving it.' using errcode='42501';
      end if;
    elsif tg_op='UPDATE' and (
      new.archived_at is distinct from old.archived_at
      or new.archived_by is distinct from old.archived_by
      or new.archive_reason is distinct from old.archive_reason
    ) then
      select id into v_actor from public.profiles where id=auth.uid()
        and role in ('admin','super_admin') and status='active' and not invitation_pending;
      if v_actor is null then
        raise exception 'Only administrators may archive or unarchive projects.' using errcode='42501';
      end if;
      if (to_jsonb(new)-array['archived_at','archived_by','archive_reason','updated_at'])
        is distinct from (to_jsonb(old)-array['archived_at','archived_by','archive_reason','updated_at']) then
        raise exception 'Archive changes cannot modify project records.' using errcode='42501';
      end if;
      if old.archived_at is null and new.archived_at is not null then
        if old.status <> 'completed' then raise exception 'Only completed projects can be archived.'; end if;
        if exists(select 1 from public.equipment where current_project_id=old.id)
          or exists(select 1 from public.equipment_assignments where project_id=old.id and returned_at is null)
          or exists(select 1 from public.equipment_task_assignments where project_id=old.id and released_at is null) then
          raise exception 'Return all assigned equipment before archiving this project.';
        end if;
        if exists(select 1 from public.material_requests where project_id=old.id and status not in ('fulfilled','canceled'))
          or exists(select 1 from public.equipment_requests where project_id=old.id and status not in ('fulfilled','canceled')) then
          raise exception 'Fulfill or cancel outstanding material and equipment requests before archiving.';
        end if;
        new.archived_at := now();
        new.archived_by := v_actor;
        new.archive_reason := nullif(btrim(new.archive_reason),'');
        if length(new.archive_reason)>1000 then raise exception 'Archive reason must be 1,000 characters or fewer.'; end if;
      elsif old.archived_at is not null and new.archived_at is null then
        new.archived_by := null;
        new.archive_reason := null;
      else
        raise exception 'Archive metadata cannot be edited. Unarchive the project first.' using errcode='42501';
      end if;
      return new;
    end if;
  end if;

  if tg_op <> 'INSERT' then
    v_old := public._access_row_project(tg_table_name,to_jsonb(old));
    if tg_op='DELETE' and pg_trigger_depth()>1
      and (v_old is null or not exists(select 1 from public.projects where id=v_old)) then return old; end if;
    perform public._assert_project_unarchived(v_old);
    if auth.uid() is not null and public.project_access_level(v_old)<>'edit' then
      raise exception 'This project is view only or access was removed.' using errcode='42501';
    end if;
  end if;
  if tg_op <> 'DELETE' then
    v_new := public._access_row_project(tg_table_name,to_jsonb(new));
    perform public._assert_project_unarchived(v_new);
    if auth.uid() is not null
      and not (tg_table_name='projects' and tg_op='INSERT' and public.get_my_role()='admin')
      and public.project_access_level(v_new)<>'edit' then
      raise exception 'This project is view only or access was removed.' using errcode='42501';
    end if;
    return new;
  end if;
  return old;
end;
$$;

create function public.set_project_archived(p_project_id bigint, p_archived boolean, p_reason text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_project public.projects;
begin
  if not exists(select 1 from public.profiles where id=auth.uid()
    and role in ('admin','super_admin') and status='active' and not invitation_pending) then
    raise exception 'Only administrators may archive or unarchive projects.' using errcode='42501';
  end if;
  if p_archived is null then raise exception 'Choose an archive action.'; end if;
  select * into v_project from public.projects where id=p_project_id for update;
  if not found then raise exception 'Project not found.'; end if;
  if (v_project.archived_at is not null)=p_archived then
    raise exception 'The project archive state changed. Refresh and try again.' using errcode='40001';
  end if;
  update public.projects set
    archived_at=case when p_archived then now() else null end,
    archived_by=case when p_archived then auth.uid() else null end,
    archive_reason=case when p_archived then p_reason else null end
  where id=p_project_id;
end;
$$;
revoke all on function public.set_project_archived(bigint,boolean,text) from public,anon;
grant execute on function public.set_project_archived(bigint,boolean,text) to authenticated;

-- Equipment lives in the global catalog; its current-project pointer must
-- not bypass the archive guard when assigning from Inventory.
create function public.enforce_equipment_project_archive()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op<>'INSERT' then perform public._assert_project_unarchived(old.current_project_id); end if;
  if tg_op<>'DELETE' then
    perform public._assert_project_unarchived(new.current_project_id);
    return new;
  end if;
  return old;
end;
$$;
revoke all on function public.enforce_equipment_project_archive() from public,anon,authenticated;
create trigger equipment_project_archive before insert or update or delete on public.equipment
  for each row execute function public.enforce_equipment_project_archive();

-- Include punch-list evidence as well as the buckets already guarded by
-- 0101. Read/download policies are unchanged.
do $$
declare v_cmd text; v_expression text;
begin
  if to_regclass('storage.objects') is null then return; end if;
  v_expression := '(bucket_id not in (''project-sheets'',''incident-evidence'',''purchase-receipts'',''punch-list-evidence'') or public.project_access_level(case when split_part(name,''/'',1) ~ ''^[1-9][0-9]{0,14}$'' then split_part(name,''/'',1)::bigint else null end) = ''edit'')';
  foreach v_cmd in array array['INSERT','UPDATE','DELETE'] loop
    execute format('create policy %I on storage.objects as restrictive for %s to authenticated %s',
      'Archived project attachment ' || lower(v_cmd),v_cmd,
      case v_cmd when 'INSERT' then 'with check (' || v_expression || ')'
        when 'UPDATE' then 'using (' || v_expression || ') with check (' || v_expression || ')'
        else 'using (' || v_expression || ')' end);
  end loop;
end;
$$;

notify pgrst,'reload schema';
commit;
