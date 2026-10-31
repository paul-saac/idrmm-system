-- Intent: reserve account and project-access administration for Admin/Super Admin.
-- Keep existing project assignments and access settings; only management authority changes.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create or replace function public.can_manage_project_access(p_project_id bigint)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.app_session_is_active() and public.project_access_level(p_project_id) = 'edit'
    and exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','super_admin')
      and status='active' and not invitation_pending);
$$;

create or replace function public.project_account_access_editor(p_profile_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_target public.profiles; v_actor public.profiles;
begin
  select * into v_actor from public.profiles where id = auth.uid()
    and status = 'active' and not invitation_pending;
  if public.app_session_is_active() is not true or v_actor.id is null or v_actor.role not in ('admin','super_admin') then
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

create or replace function public.save_project_account_access(p_profile_id uuid, p_changes jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor public.profiles; v_target public.profiles; v_change jsonb;
  v_project public.projects; v_level text; v_previous text;
begin
  select * into v_actor from public.profiles where id = auth.uid()
    and status = 'active' and not invitation_pending;
  if public.app_session_is_active() is not true or v_actor.id is null or v_actor.role not in ('admin','super_admin') then
    raise exception 'Project access management denied.' using errcode = '42501';
  end if;
  if public.system_backup_maintenance() then
    raise exception 'Saving is temporarily paused.' using errcode='55000';
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

-- Approval authority must also hold for direct inserts/updates, while field
-- staff can still submit requests and fulfill requests already approved.
create or replace function public.enforce_admin_request_approval()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.get_my_role() is distinct from 'admin' then
    if tg_op='INSERT' then
      if new.status in ('approved','partially_fulfilled','fulfilled') or new.approved_by is not null or new.approved_at is not null then
        raise exception 'Only administrators can approve requests.' using errcode='42501';
      end if;
    elsif (new.status='approved' and old.status is distinct from 'approved')
      or (new.status in ('partially_fulfilled','fulfilled') and old.status not in ('approved','partially_fulfilled','fulfilled'))
      or new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at then
      raise exception 'Only administrators can approve requests.' using errcode='42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists material_request_admin_approval on public.material_requests;
create trigger material_request_admin_approval before insert or update on public.material_requests
  for each row execute function public.enforce_admin_request_approval();
drop trigger if exists equipment_request_admin_approval on public.equipment_requests;
create trigger equipment_request_admin_approval before insert or update on public.equipment_requests
  for each row execute function public.enforce_admin_request_approval();
revoke all on function public.enforce_admin_request_approval() from public,anon;

revoke all on function public.can_manage_project_access(bigint),public.project_account_access_editor(uuid),public.save_project_account_access(uuid,jsonb) from public,anon;
grant execute on function public.can_manage_project_access(bigint),public.project_account_access_editor(uuid),public.save_project_account_access(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
