-- ============================================================================
-- Equipment task placements
--
-- equipment_assignments remains the project checkout/check-in record. This
-- table records where that checked-out physical asset moved inside the project:
-- one open row is its current task; closing it and inserting another records a
-- move without falsely returning the asset to Inventory.
-- ============================================================================

create table if not exists public.equipment_task_assignments (
  id bigint generated always as identity primary key,
  equipment_assignment_id bigint not null references public.equipment_assignments (id) on delete cascade,
  project_id bigint not null references public.projects (id) on delete cascade,
  task_id bigint references public.estimate_tasks (id) on delete set null,
  task_name text not null,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  released_at timestamptz,
  release_reason text check (release_reason in ('moved', 'returned')),
  notes text,
  created_at timestamptz not null default now(),
  check (released_at is null or released_at >= assigned_at),
  check (
    (released_at is null and release_reason is null)
    or (released_at is not null and release_reason is not null)
  )
);

create unique index if not exists idx_equipment_task_assignments_one_active
  on public.equipment_task_assignments (equipment_assignment_id)
  where released_at is null;
create index if not exists idx_equipment_task_assignments_project
  on public.equipment_task_assignments (project_id, assigned_at desc);
create index if not exists idx_equipment_task_assignments_task
  on public.equipment_task_assignments (task_id);

alter table public.equipment_task_assignments enable row level security;

drop policy if exists "Admins can manage equipment task assignments"
  on public.equipment_task_assignments;
create policy "Admins can manage equipment task assignments"
  on public.equipment_task_assignments
  for all
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');

drop policy if exists "Foremen can view equipment task assignments"
  on public.equipment_task_assignments;
create policy "Foremen can view equipment task assignments"
  on public.equipment_task_assignments
  for select using (public.is_project_foreman(project_id));

-- The move is atomic: the old task period closes at exactly the same instant
-- the new one opens. Project/task ownership is re-read here rather than trusted
-- from the client-side form.
create or replace function public.move_equipment_to_task(
  p_equipment_assignment_id bigint,
  p_project_id bigint,
  p_task_id bigint,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task_name text;
  v_current_task_id bigint;
  v_now timestamptz := now();
begin
  if not (
    public.get_my_role() = 'admin'
    or public.is_project_foreman(p_project_id)
  ) then
    raise exception 'Not authorized to assign equipment on this project' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.equipment_assignments
    where id = p_equipment_assignment_id
      and project_id = p_project_id
      and returned_at is null
  ) then
    raise exception 'This equipment is not currently checked out to the project';
  end if;

  select task_name into v_task_name
  from public.estimate_tasks
  where id = p_task_id and project_id = p_project_id;

  if not found then
    raise exception 'Select a valid task from this project';
  end if;

  select task_id into v_current_task_id
  from public.equipment_task_assignments
  where equipment_assignment_id = p_equipment_assignment_id
    and released_at is null
  for update;

  if found and v_current_task_id = p_task_id then
    raise exception 'This equipment is already assigned to that task';
  end if;

  update public.equipment_task_assignments
  set released_at = v_now, release_reason = 'moved'
  where equipment_assignment_id = p_equipment_assignment_id
    and released_at is null;

  insert into public.equipment_task_assignments (
    equipment_assignment_id, project_id, task_id, task_name,
    assigned_by, assigned_at, notes
  ) values (
    p_equipment_assignment_id, p_project_id, p_task_id, v_task_name,
    auth.uid(), v_now, nullif(trim(p_notes), '')
  );
end;
$$;

create or replace function public.close_equipment_task_assignment(
  p_equipment_assignment_id bigint,
  p_project_id bigint,
  p_released_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.get_my_role() = 'admin'
    or public.is_project_foreman(p_project_id)
  ) then
    raise exception 'Not authorized to return equipment on this project' using errcode = '42501';
  end if;

  update public.equipment_task_assignments
  set released_at = greatest(p_released_at, assigned_at),
      release_reason = 'returned'
  where equipment_assignment_id = p_equipment_assignment_id
    and project_id = p_project_id
    and released_at is null;
end;
$$;
