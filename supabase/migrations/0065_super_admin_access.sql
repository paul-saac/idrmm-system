-- The super admin's end is the admin's own (/admin), everything in it. DD
--
-- get_my_role() — what every RLS policy and database helper checks — now
-- reads a super_admin as 'admin', so each policy's
-- `get_my_role() = 'admin'` (and `in ('admin', ...)`) covers them too,
-- without rewriting every one of them. The profiles policies' own
-- `in ('admin', 'super_admin')` still hold. Their real role stays as it is
-- in profiles.role, which the app reads for what only a super admin may do
-- (managing Administrator accounts — see MANAGED_ROLES in
-- lib/auth/roles.ts).
--
-- Progress-override notifications go to super admins as well as admins.
--
-- Run this AFTER 0064_retire_laborers.sql.

create or replace function public.get_my_role()
returns public.user_role
language sql
security definer
stable
set search_path = public
as $$
  select case when role = 'super_admin' then 'admin'::public.user_role else role end
  from public.profiles
  where id = auth.uid();
$$;

-- notify_progress_override (0061), its recipients now admins and super
-- admins (plus the project's foreman and PM, as before).
create or replace function public.notify_progress_override()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text := tg_argv[0];
  v_item_id bigint := (to_jsonb(new) ->> (tg_argv[0] || '_id'))::bigint;
  v_actor uuid := coalesce(new.recorded_by, auth.uid());
  v_actor_name text;
  v_item_name text;
  v_project_id bigint;
  v_project_name text;
  v_foreman uuid;
  v_manager uuid;
begin
  if v_kind = 'task' then
    select task_name, project_id into v_item_name, v_project_id
    from estimate_tasks where id = v_item_id;
  else
    select category_name, project_id into v_item_name, v_project_id
    from estimate_categories where id = v_item_id;
  end if;
  if v_project_id is null then
    return new;
  end if;

  select project_name, foreman_id, project_manager_id
    into v_project_name, v_foreman, v_manager
  from projects where id = v_project_id;

  select nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
    into v_actor_name
  from profiles where id = v_actor;

  -- One per item and day: saving the same day again replaces whatever's
  -- still unread from the earlier save instead of piling up.
  delete from notifications
  where kind = 'progress_override'
    and item_kind = v_kind
    and item_id = v_item_id
    and entry_date = new.entry_date
    and read_at is null;

  insert into notifications (
    recipient_id, actor_id, actor_name, project_id, project_name,
    item_kind, item_id, item_name, entry_date
  )
  select r.id, v_actor, v_actor_name, v_project_id, v_project_name,
         v_kind, v_item_id, v_item_name, new.entry_date
  from profiles r
  where (r.role in ('admin', 'super_admin') or r.id = v_foreman or r.id = v_manager)
    and r.id is distinct from v_actor;

  return new;
end;
$$;
