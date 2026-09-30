--DONE
-- Foreman project access.
--
-- A foreman works inside the projects they're assigned to
-- (projects.foreman_id) with the same abilities an admin has there, except:
--   - the project itself is read-only (no create/edit/delete),
--   - the company-wide equipment inventory is read-only.
--
-- Every policy here is additive — Postgres ORs permissive policies — so
-- the existing admin policies are untouched, and each foreman policy only
-- ever matches rows under one of that foreman's own projects.
--
-- DAILY LOGS — ON HOLD: no daily_log_* table gets a foreman policy yet
-- (daily_logs, daily_log_work_items, daily_log_labor_items,
-- daily_log_expense_items, daily_log_material_usage_items,
-- daily_log_material_procurement(_items), daily_log_equipment_acquisition,
-- daily_log_entry_flags, daily_log_survey_questions, daily_log_survey_answers).
-- Until they do, anything a foreman sees that's derived from daily logs
-- (Expenses, Material Usage History, delay-risk incident counts) reads empty.
--
-- Run this AFTER 0050_task_progress_material_entries.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helpers. security definer (like get_my_role) so a policy can resolve a
-- row's project without re-entering RLS on the parent tables.
-- ----------------------------------------------------------------------------

create or replace function public.is_project_foreman(p_project_id bigint)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.get_my_role() = 'foreman'
    and exists (
      select 1 from public.projects
      where id = p_project_id and foreman_id = auth.uid()
    );
$$;

create or replace function public.is_task_foreman(p_task_id bigint)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.estimate_tasks t
    where t.id = p_task_id and public.is_project_foreman(t.project_id)
  );
$$;

create or replace function public.is_category_foreman(p_category_id bigint)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.estimate_categories c
    where c.id = p_category_id and public.is_project_foreman(c.project_id)
  );
$$;

create or replace function public.is_task_progress_entry_foreman(p_entry_id bigint)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.task_progress_entries e
    where e.id = p_entry_id and public.is_task_foreman(e.task_id)
  );
$$;

create or replace function public.is_material_request_foreman(p_request_id bigint)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.material_requests r
    where r.id = p_request_id and public.is_project_foreman(r.project_id)
  );
$$;

create or replace function public.is_equipment_requisition_foreman(p_request_id bigint)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.equipment_requisitions r
    where r.id = p_request_id and public.is_project_foreman(r.project_id)
  );
$$;

-- ----------------------------------------------------------------------------
-- Projects & profiles (read-only).
-- ----------------------------------------------------------------------------

drop policy if exists "Foremen can view their assigned projects" on public.projects;
create policy "Foremen can view their assigned projects" on public.projects
  for select using (public.is_project_foreman(id));

-- Names shown across a foreman's projects (project manager, approvers,
-- snapshot/record authors) all belong to admins or project managers;
-- the foreman's own row is already covered by "Users can view own profile".
drop policy if exists "Foremen can view staff profiles" on public.profiles;
create policy "Foremen can view staff profiles" on public.profiles
  for select using (
    public.get_my_role() = 'foreman'
    and role in ('super_admin', 'admin', 'project_manager')
  );

-- ----------------------------------------------------------------------------
-- Cost estimate / Gantt.
-- ----------------------------------------------------------------------------

drop policy if exists "Foremen can view estimate categories" on public.estimate_categories;
create policy "Foremen can view estimate categories" on public.estimate_categories
  for select using (public.is_project_foreman(project_id));
drop policy if exists "Foremen can create estimate categories" on public.estimate_categories;
create policy "Foremen can create estimate categories" on public.estimate_categories
  for insert with check (public.is_project_foreman(project_id));
drop policy if exists "Foremen can update estimate categories" on public.estimate_categories;
create policy "Foremen can update estimate categories" on public.estimate_categories
  for update using (public.is_project_foreman(project_id))
  with check (public.is_project_foreman(project_id));
drop policy if exists "Foremen can delete estimate categories" on public.estimate_categories;
create policy "Foremen can delete estimate categories" on public.estimate_categories
  for delete using (public.is_project_foreman(project_id));

drop policy if exists "Foremen can view estimate tasks" on public.estimate_tasks;
create policy "Foremen can view estimate tasks" on public.estimate_tasks
  for select using (public.is_project_foreman(project_id));
drop policy if exists "Foremen can create estimate tasks" on public.estimate_tasks;
create policy "Foremen can create estimate tasks" on public.estimate_tasks
  for insert with check (public.is_project_foreman(project_id));
drop policy if exists "Foremen can update estimate tasks" on public.estimate_tasks;
create policy "Foremen can update estimate tasks" on public.estimate_tasks
  for update using (public.is_project_foreman(project_id))
  with check (public.is_project_foreman(project_id));
drop policy if exists "Foremen can delete estimate tasks" on public.estimate_tasks;
create policy "Foremen can delete estimate tasks" on public.estimate_tasks
  for delete using (public.is_project_foreman(project_id));

drop policy if exists "Foremen can view task other costs" on public.estimate_task_other_costs;
create policy "Foremen can view task other costs" on public.estimate_task_other_costs
  for select using (public.is_task_foreman(task_id));
drop policy if exists "Foremen can create task other costs" on public.estimate_task_other_costs;
create policy "Foremen can create task other costs" on public.estimate_task_other_costs
  for insert with check (public.is_task_foreman(task_id));
drop policy if exists "Foremen can update task other costs" on public.estimate_task_other_costs;
create policy "Foremen can update task other costs" on public.estimate_task_other_costs
  for update using (public.is_task_foreman(task_id))
  with check (public.is_task_foreman(task_id));
drop policy if exists "Foremen can delete task other costs" on public.estimate_task_other_costs;
create policy "Foremen can delete task other costs" on public.estimate_task_other_costs
  for delete using (public.is_task_foreman(task_id));

drop policy if exists "Foremen can view task material assignments" on public.estimate_task_material_assignments;
create policy "Foremen can view task material assignments" on public.estimate_task_material_assignments
  for select using (public.is_task_foreman(task_id));
drop policy if exists "Foremen can create task material assignments" on public.estimate_task_material_assignments;
create policy "Foremen can create task material assignments" on public.estimate_task_material_assignments
  for insert with check (public.is_task_foreman(task_id));
drop policy if exists "Foremen can update task material assignments" on public.estimate_task_material_assignments;
create policy "Foremen can update task material assignments" on public.estimate_task_material_assignments
  for update using (public.is_task_foreman(task_id))
  with check (public.is_task_foreman(task_id));
drop policy if exists "Foremen can delete task material assignments" on public.estimate_task_material_assignments;
create policy "Foremen can delete task material assignments" on public.estimate_task_material_assignments
  for delete using (public.is_task_foreman(task_id));

drop policy if exists "Foremen can view task labor assignments" on public.estimate_task_labor_assignments;
create policy "Foremen can view task labor assignments" on public.estimate_task_labor_assignments
  for select using (public.is_task_foreman(task_id));
drop policy if exists "Foremen can create task labor assignments" on public.estimate_task_labor_assignments;
create policy "Foremen can create task labor assignments" on public.estimate_task_labor_assignments
  for insert with check (public.is_task_foreman(task_id));
drop policy if exists "Foremen can update task labor assignments" on public.estimate_task_labor_assignments;
create policy "Foremen can update task labor assignments" on public.estimate_task_labor_assignments
  for update using (public.is_task_foreman(task_id))
  with check (public.is_task_foreman(task_id));
drop policy if exists "Foremen can delete task labor assignments" on public.estimate_task_labor_assignments;
create policy "Foremen can delete task labor assignments" on public.estimate_task_labor_assignments
  for delete using (public.is_task_foreman(task_id));

drop policy if exists "Foremen can view gantt snapshots" on public.gantt_snapshots;
create policy "Foremen can view gantt snapshots" on public.gantt_snapshots
  for select using (public.is_project_foreman(project_id));
drop policy if exists "Foremen can create gantt snapshots" on public.gantt_snapshots;
create policy "Foremen can create gantt snapshots" on public.gantt_snapshots
  for insert with check (public.is_project_foreman(project_id));
drop policy if exists "Foremen can delete gantt snapshots" on public.gantt_snapshots;
create policy "Foremen can delete gantt snapshots" on public.gantt_snapshots
  for delete using (public.is_project_foreman(project_id));

-- ----------------------------------------------------------------------------
-- Members (workers) and their task/phase assignments.
-- ----------------------------------------------------------------------------

drop policy if exists "Foremen can view workers" on public.workers;
create policy "Foremen can view workers" on public.workers
  for select using (public.is_project_foreman(project_id));
drop policy if exists "Foremen can create workers" on public.workers;
create policy "Foremen can create workers" on public.workers
  for insert with check (public.is_project_foreman(project_id));
drop policy if exists "Foremen can update workers" on public.workers;
create policy "Foremen can update workers" on public.workers
  for update using (public.is_project_foreman(project_id))
  with check (public.is_project_foreman(project_id));
drop policy if exists "Foremen can delete workers" on public.workers;
create policy "Foremen can delete workers" on public.workers
  for delete using (public.is_project_foreman(project_id));

drop policy if exists "Foremen can view task worker assignments" on public.task_worker_assignments;
create policy "Foremen can view task worker assignments" on public.task_worker_assignments
  for select using (public.is_task_foreman(task_id));
drop policy if exists "Foremen can create task worker assignments" on public.task_worker_assignments;
create policy "Foremen can create task worker assignments" on public.task_worker_assignments
  for insert with check (public.is_task_foreman(task_id));
drop policy if exists "Foremen can delete task worker assignments" on public.task_worker_assignments;
create policy "Foremen can delete task worker assignments" on public.task_worker_assignments
  for delete using (public.is_task_foreman(task_id));

drop policy if exists "Foremen can view category worker assignments" on public.category_worker_assignments;
create policy "Foremen can view category worker assignments" on public.category_worker_assignments
  for select using (public.is_category_foreman(category_id));
drop policy if exists "Foremen can create category worker assignments" on public.category_worker_assignments;
create policy "Foremen can create category worker assignments" on public.category_worker_assignments
  for insert with check (public.is_category_foreman(category_id));
drop policy if exists "Foremen can delete category worker assignments" on public.category_worker_assignments;
create policy "Foremen can delete category worker assignments" on public.category_worker_assignments
  for delete using (public.is_category_foreman(category_id));

-- ----------------------------------------------------------------------------
-- Progress Tracking Override.
-- ----------------------------------------------------------------------------

drop policy if exists "Foremen can view task progress entries" on public.task_progress_entries;
create policy "Foremen can view task progress entries" on public.task_progress_entries
  for select using (public.is_task_foreman(task_id));
drop policy if exists "Foremen can create task progress entries" on public.task_progress_entries;
create policy "Foremen can create task progress entries" on public.task_progress_entries
  for insert with check (public.is_task_foreman(task_id));
drop policy if exists "Foremen can update task progress entries" on public.task_progress_entries;
create policy "Foremen can update task progress entries" on public.task_progress_entries
  for update using (public.is_task_foreman(task_id))
  with check (public.is_task_foreman(task_id));
drop policy if exists "Foremen can delete task progress entries" on public.task_progress_entries;
create policy "Foremen can delete task progress entries" on public.task_progress_entries
  for delete using (public.is_task_foreman(task_id));

drop policy if exists "Foremen can view task progress material entries" on public.task_progress_material_entries;
create policy "Foremen can view task progress material entries" on public.task_progress_material_entries
  for select using (public.is_task_progress_entry_foreman(progress_entry_id));
drop policy if exists "Foremen can create task progress material entries" on public.task_progress_material_entries;
create policy "Foremen can create task progress material entries" on public.task_progress_material_entries
  for insert with check (public.is_task_progress_entry_foreman(progress_entry_id));
drop policy if exists "Foremen can delete task progress material entries" on public.task_progress_material_entries;
create policy "Foremen can delete task progress material entries" on public.task_progress_material_entries
  for delete using (public.is_task_progress_entry_foreman(progress_entry_id));

drop policy if exists "Foremen can view category progress entries" on public.category_progress_entries;
create policy "Foremen can view category progress entries" on public.category_progress_entries
  for select using (public.is_category_foreman(category_id));
drop policy if exists "Foremen can create category progress entries" on public.category_progress_entries;
create policy "Foremen can create category progress entries" on public.category_progress_entries
  for insert with check (public.is_category_foreman(category_id));
drop policy if exists "Foremen can update category progress entries" on public.category_progress_entries;
create policy "Foremen can update category progress entries" on public.category_progress_entries
  for update using (public.is_category_foreman(category_id))
  with check (public.is_category_foreman(category_id));
drop policy if exists "Foremen can delete category progress entries" on public.category_progress_entries;
create policy "Foremen can delete category progress entries" on public.category_progress_entries
  for delete using (public.is_category_foreman(category_id));

-- ----------------------------------------------------------------------------
-- Materials: project stock and material requests.
-- ----------------------------------------------------------------------------

drop policy if exists "Foremen can view project materials" on public.project_materials;
create policy "Foremen can view project materials" on public.project_materials
  for select using (public.is_project_foreman(project_id));
drop policy if exists "Foremen can create project materials" on public.project_materials;
create policy "Foremen can create project materials" on public.project_materials
  for insert with check (public.is_project_foreman(project_id));
drop policy if exists "Foremen can update project materials" on public.project_materials;
create policy "Foremen can update project materials" on public.project_materials
  for update using (public.is_project_foreman(project_id))
  with check (public.is_project_foreman(project_id));
drop policy if exists "Foremen can delete project materials" on public.project_materials;
create policy "Foremen can delete project materials" on public.project_materials
  for delete using (public.is_project_foreman(project_id));

drop policy if exists "Foremen can view material requests" on public.material_requests;
create policy "Foremen can view material requests" on public.material_requests
  for select using (public.is_project_foreman(project_id));
drop policy if exists "Foremen can create material requests" on public.material_requests;
create policy "Foremen can create material requests" on public.material_requests
  for insert with check (public.is_project_foreman(project_id));
drop policy if exists "Foremen can update material requests" on public.material_requests;
create policy "Foremen can update material requests" on public.material_requests
  for update using (public.is_project_foreman(project_id))
  with check (public.is_project_foreman(project_id));
drop policy if exists "Foremen can delete material requests" on public.material_requests;
create policy "Foremen can delete material requests" on public.material_requests
  for delete using (public.is_project_foreman(project_id));

drop policy if exists "Foremen can view material request items" on public.material_request_items;
create policy "Foremen can view material request items" on public.material_request_items
  for select using (public.is_material_request_foreman(material_request_id));
drop policy if exists "Foremen can create material request items" on public.material_request_items;
create policy "Foremen can create material request items" on public.material_request_items
  for insert with check (public.is_material_request_foreman(material_request_id));
drop policy if exists "Foremen can update material request items" on public.material_request_items;
create policy "Foremen can update material request items" on public.material_request_items
  for update using (public.is_material_request_foreman(material_request_id))
  with check (public.is_material_request_foreman(material_request_id));
drop policy if exists "Foremen can delete material request items" on public.material_request_items;
create policy "Foremen can delete material request items" on public.material_request_items
  for delete using (public.is_material_request_foreman(material_request_id));

-- ----------------------------------------------------------------------------
-- Equipment: inventory read-only; a project's own assignments and
-- requisitions fully manageable.
-- ----------------------------------------------------------------------------

drop policy if exists "Foremen can view equipment" on public.equipment;
create policy "Foremen can view equipment" on public.equipment
  for select using (public.get_my_role() = 'foreman');

-- No insert: checking equipment out to a project happens from Inventory,
-- which is admin-only. Return/edit/delete from the project's own
-- Equipment tab are allowed; the equipment row's own status is then
-- recomputed through sync_equipment_status below, not a direct update.
drop policy if exists "Foremen can view equipment assignments" on public.equipment_assignments;
create policy "Foremen can view equipment assignments" on public.equipment_assignments
  for select using (public.is_project_foreman(project_id));
drop policy if exists "Foremen can update equipment assignments" on public.equipment_assignments;
create policy "Foremen can update equipment assignments" on public.equipment_assignments
  for update using (public.is_project_foreman(project_id))
  with check (public.is_project_foreman(project_id));
drop policy if exists "Foremen can delete equipment assignments" on public.equipment_assignments;
create policy "Foremen can delete equipment assignments" on public.equipment_assignments
  for delete using (public.is_project_foreman(project_id));

drop policy if exists "Foremen can view equipment requisitions" on public.equipment_requisitions;
create policy "Foremen can view equipment requisitions" on public.equipment_requisitions
  for select using (public.is_project_foreman(project_id));
drop policy if exists "Foremen can create equipment requisitions" on public.equipment_requisitions;
create policy "Foremen can create equipment requisitions" on public.equipment_requisitions
  for insert with check (public.is_project_foreman(project_id));
drop policy if exists "Foremen can update equipment requisitions" on public.equipment_requisitions;
create policy "Foremen can update equipment requisitions" on public.equipment_requisitions
  for update using (public.is_project_foreman(project_id))
  with check (public.is_project_foreman(project_id));
drop policy if exists "Foremen can delete equipment requisitions" on public.equipment_requisitions;
create policy "Foremen can delete equipment requisitions" on public.equipment_requisitions
  for delete using (public.is_project_foreman(project_id));

drop policy if exists "Foremen can view equipment requisition items" on public.equipment_requisition_items;
create policy "Foremen can view equipment requisition items" on public.equipment_requisition_items
  for select using (public.is_equipment_requisition_foreman(equipment_request_id));
drop policy if exists "Foremen can create equipment requisition items" on public.equipment_requisition_items;
create policy "Foremen can create equipment requisition items" on public.equipment_requisition_items
  for insert with check (public.is_equipment_requisition_foreman(equipment_request_id));
drop policy if exists "Foremen can update equipment requisition items" on public.equipment_requisition_items;
create policy "Foremen can update equipment requisition items" on public.equipment_requisition_items
  for update using (public.is_equipment_requisition_foreman(equipment_request_id))
  with check (public.is_equipment_requisition_foreman(equipment_request_id));
drop policy if exists "Foremen can delete equipment requisition items" on public.equipment_requisition_items;
create policy "Foremen can delete equipment requisition items" on public.equipment_requisition_items
  for delete using (public.is_equipment_requisition_foreman(equipment_request_id));

-- ----------------------------------------------------------------------------
-- Narrow write paths for the two cases where a project-level action has
-- to touch a table the foreman can't write directly.
-- ----------------------------------------------------------------------------

-- The Labor Breakdown modal's default labor rate lives on projects, but a
-- foreman update policy on projects would also let them rewrite the
-- name, budget, or foreman assignment. This touches only the one column.
create or replace function public.set_project_default_labor_cost_percent(
  p_project_id bigint,
  p_percent numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.get_my_role() = 'admin' or public.is_project_foreman(p_project_id)) then
    raise exception 'Not authorized to edit this project' using errcode = '42501';
  end if;

  update public.projects
  set default_labor_cost_percent = p_percent
  where id = p_project_id;
end;
$$;

-- Recomputes an equipment row's live status from its assignment history
-- (same rules as lib/equipment/actions.ts's syncEquipmentStatus): leaves
-- maintenance/retired alone; otherwise "assigned" to the latest
-- unreturned assignment's project, or "available". Lets a foreman's
-- return/edit/delete on their own project's Equipment tab keep the
-- inventory row in sync without write access to the inventory itself.
create or replace function public.sync_equipment_status(p_equipment_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_current_project_id bigint;
  v_active_project_id bigint;
  v_active_assigned_at timestamptz;
  v_last_returned_at timestamptz;
begin
  select status, current_project_id
  into v_status, v_current_project_id
  from public.equipment
  where id = p_equipment_id;

  if not found then
    return;
  end if;

  -- current_project_id is checked too: right after a foreman deletes the
  -- last assignment on their project, no assignment row links them to
  -- this equipment anymore, but it's still (stale) marked as theirs.
  if not (
    public.get_my_role() = 'admin'
    or public.is_project_foreman(v_current_project_id)
    or exists (
      select 1 from public.equipment_assignments a
      where a.equipment_id = p_equipment_id
        and public.is_project_foreman(a.project_id)
    )
  ) then
    raise exception 'Not authorized to update this equipment' using errcode = '42501';
  end if;

  if v_status in ('maintenance', 'retired') then
    return;
  end if;

  select project_id, assigned_at
  into v_active_project_id, v_active_assigned_at
  from public.equipment_assignments
  where equipment_id = p_equipment_id and returned_at is null
  order by assigned_at desc
  limit 1;

  if found then
    update public.equipment
    set status = 'assigned',
        current_project_id = v_active_project_id,
        last_assigned_at = v_active_assigned_at
    where id = p_equipment_id;
    return;
  end if;

  select max(returned_at)
  into v_last_returned_at
  from public.equipment_assignments
  where equipment_id = p_equipment_id;

  update public.equipment
  set status = 'available',
      current_project_id = null,
      last_returned_at = v_last_returned_at
  where id = p_equipment_id;
end;
$$;

revoke execute on function public.set_project_default_labor_cost_percent(bigint, numeric) from public, anon;
grant execute on function public.set_project_default_labor_cost_percent(bigint, numeric) to authenticated;

revoke execute on function public.sync_equipment_status(bigint) from public, anon;
grant execute on function public.sync_equipment_status(bigint) to authenticated;
