-- Intent: grant project managers assigned-project access across planning/Gantt,
-- progress, materials, equipment, expenses, documents, reports, and team
-- assignments, while keeping account management, project deletion, document
-- acceptance, and final request approvals admin-only.

begin;

-- 1. Extend the shared assigned-project helper so all project-scoped RLS
-- policies and RPCs (tasks, categories, progress, materials, equipment,
-- closeout reports, snapshots, events, worker assignments) allow the
-- project's assigned project_manager_id alongside its foreman_id.
create or replace function public.is_project_foreman(p_project_id bigint)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.projects
    where id = p_project_id
      and (
        (public.get_my_role() = 'foreman' and foreman_id = auth.uid())
        or (public.get_my_role() = 'project_manager' and project_manager_id = auth.uid())
      )
  );
$$;

-- 2. Staff profile names (PMs, foremen, approvers, record authors) and
-- read-only company equipment inventory for project managers.
drop policy if exists "Foremen can view staff profiles" on public.profiles;
create policy "Foremen can view staff profiles" on public.profiles
  for select using (
    public.get_my_role() in ('foreman', 'project_manager')
    and role in ('super_admin', 'admin', 'project_manager', 'foreman')
  );

drop policy if exists "Project managers can view equipment" on public.equipment;
create policy "Project managers can view equipment" on public.equipment
  for select using (public.get_my_role() = 'project_manager');

-- 3. Cross-project attendance check when recording progress from the PM portal.
create or replace function public.attendance_elsewhere(
  p_date date,
  p_worker_ids bigint[],
  p_task_id bigint,
  p_category_id bigint
)
returns table (worker_id bigint, hours numeric, item_name text, project_name text)
language sql
stable
security definer
set search_path = public
as $$
  select a.worker_id, a.hours, t.task_name, p.project_name
  from task_progress_attendance a
  join task_progress_entries e on e.id = a.progress_entry_id
  join estimate_tasks t on t.id = e.task_id
  join projects p on p.id = t.project_id
  where e.entry_date = p_date
    and a.worker_id = any (p_worker_ids)
    and (p_task_id is null or e.task_id <> p_task_id)
    and get_my_role() in ('admin', 'foreman', 'project_manager')
  union all
  select a.worker_id, a.hours, c.category_name, p.project_name
  from category_progress_attendance a
  join category_progress_entries e on e.id = a.progress_entry_id
  join estimate_categories c on c.id = e.category_id
  join projects p on p.id = c.project_id
  where e.entry_date = p_date
    and a.worker_id = any (p_worker_ids)
    and (p_category_id is null or e.category_id <> p_category_id)
    and get_my_role() in ('admin', 'foreman', 'project_manager')
$$;

revoke execute on function public.attendance_elsewhere(date, bigint[], bigint, bigint) from public, anon;
grant execute on function public.attendance_elsewhere(date, bigint[], bigint, bigint) to authenticated;

-- 4. Keep final request approvals admin-only at the database boundary while
-- still allowing assigned PMs and foremen to edit, cancel, and fulfill requests.
create or replace function public.enforce_admin_request_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    (new.status = 'approved' and old.status is distinct from 'approved')
    or (new.approved_by is distinct from old.approved_by)
    or (new.approved_at is distinct from old.approved_at)
  ) and public.get_my_role() <> 'admin' then
    raise exception 'Only administrators can approve requests.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_admin_request_approval() from public;

drop trigger if exists material_request_admin_approval on public.material_requests;
create trigger material_request_admin_approval
  before update on public.material_requests
  for each row execute function public.enforce_admin_request_approval();

drop trigger if exists equipment_request_admin_approval on public.equipment_requisitions;
create trigger equipment_request_admin_approval
  before update on public.equipment_requisitions
  for each row execute function public.enforce_admin_request_approval();

-- 5. Notify the project's assigned project manager on material/equipment requests.
create or replace function public.notify_project_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_kind text := tg_argv[0];
  v_project_name text;
  v_foreman uuid;
  v_manager uuid;
  v_actor_name text;
  v_number text;
begin
  if tg_op = 'DELETE' then
    delete from public.notifications where kind = v_kind and item_id = old.id;
    return old;
  end if;
  select project_name, foreman_id, project_manager_id
    into v_project_name, v_foreman, v_manager
    from public.projects where id = new.project_id;
  select nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
    into v_actor_name from public.profiles where id = new.requested_by;
  v_number := case when v_kind = 'material_request' then to_jsonb(new)->>'mr_no' else to_jsonb(new)->>'er_no' end;
  insert into public.notifications (recipient_id, actor_id, actor_name, kind,
    project_id, project_name, item_kind, item_id, item_name, entry_date)
  select p.id, new.requested_by, v_actor_name, v_kind, new.project_id,
    v_project_name, v_kind, new.id, v_number, new.request_date
  from public.profiles p
  where p.status = 'active'
    and (
      p.role in ('admin', 'super_admin')
      or (p.role = 'foreman' and p.id = v_foreman)
      or (p.role = 'project_manager' and p.id = v_manager)
    )
    and p.id is distinct from new.requested_by;
  return new;
end;
$$;

revoke all on function public.notify_project_request() from public;

commit;

