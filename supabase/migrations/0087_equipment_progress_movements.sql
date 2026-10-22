-- Intent: separate planned task resources from physical equipment movements.
-- Each inventory row is ONE asset (quantity 1), not a pooled stock quantity.
-- Movement records are append-only and linked by project/item/date so progress
-- overrides or deletion cannot replay movements or erase their audit trail.
alter table public.equipment_task_assignments add column if not exists category_id bigint
  references public.estimate_categories(id) on delete set null;

create table public.equipment_task_plans (
  project_id bigint not null references public.projects(id) on delete cascade,
  item_key text not null,
  equipment_id bigint not null references public.equipment(id) on delete restrict,
  primary key(project_id, item_key, equipment_id)
);
create table public.equipment_movement_events (
  id uuid primary key,
  project_id bigint not null references public.projects(id) on delete restrict,
  item_key text not null,
  equipment_id bigint not null references public.equipment(id) on delete restrict,
  action text not null check (action in ('deploy','transfer','return','used')),
  entry_date date not null,
  from_location text not null,
  to_location text not null,
  notes text,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  destination_key text
);
create index on public.equipment_movement_events(project_id, recorded_at desc);
create unique index equipment_used_once_per_day on public.equipment_movement_events
  (project_id,item_key,equipment_id,entry_date) where action = 'used';
alter table public.equipment_task_plans enable row level security;
alter table public.equipment_movement_events enable row level security;
create policy "Project equipment plans read" on public.equipment_task_plans for select
  using (public.get_my_role() = 'admin' or public.is_project_foreman(project_id));
create policy "Project movement events read" on public.equipment_movement_events for select
  using (public.get_my_role() = 'admin' or public.is_project_foreman(project_id));
-- Writes only through the validated RPC; no direct edits to movement history.
revoke all on public.equipment_task_plans, public.equipment_movement_events from anon, authenticated;
grant select on public.equipment_task_plans, public.equipment_movement_events to authenticated;

-- Existing Inventory checkout forms also share the asset lock. A stale form
-- cannot check out an asset that was just deployed from the progress modal.
create or replace function public.guard_equipment_checkout()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform 1 from equipment where id=new.equipment_id for update;
  if new.returned_at is null and exists(select 1 from equipment_assignments
    where equipment_id=new.equipment_id and returned_at is null and id<>new.id) then
    raise exception 'This equipment already has an active project checkout';
  end if;
  if new.returned_at is not null then
    update equipment_task_assignments set released_at=greatest(new.returned_at,assigned_at),release_reason='returned'
      where equipment_assignment_id=new.id and released_at is null;
  end if;
  return new;
end $$;
create trigger equipment_checkout_guard before insert or update on public.equipment_assignments
  for each row execute function public.guard_equipment_checkout();

-- The older task-transfer entry point locks the same checkout as this feature.
create or replace function public.guard_equipment_placement()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_project bigint; v_returned timestamptz;
begin
  if new.released_at is null then
    select project_id,returned_at into v_project,v_returned from equipment_assignments
      where id=new.equipment_assignment_id for update;
    if not found or v_returned is not null or v_project<>new.project_id then
      raise exception 'Equipment is no longer checked out to this project';
    end if;
  end if;
  return new;
end $$;
create trigger equipment_placement_guard before insert or update on public.equipment_task_assignments
  for each row execute function public.guard_equipment_placement();

create or replace function public.equipment_tracking_data(p_project_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not coalesce(public.get_my_role() = 'admin' or public.is_project_foreman(p_project_id),false) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'equipment', coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'name',e.name,'assetTag',e.asset_tag,'status',e.status,
      'currentProjectId',e.current_project_id,
      'currentItemKey',case when t.task_id is not null then 'task-'||t.task_id when t.category_id is not null then 'category-'||t.category_id end,
      'location',coalesce(t.task_name,case when a.id is not null then 'Project storage' else 'Inventory' end)
    ) order by e.name,e.asset_tag) from equipment e
      left join equipment_assignments a on a.equipment_id=e.id and a.returned_at is null
      left join equipment_task_assignments t on t.equipment_assignment_id=a.id and t.released_at is null
      where e.status='available' or e.current_project_id=p_project_id), '[]'::jsonb),
    'plans', coalesce((select jsonb_agg(jsonb_build_object('itemKey',p.item_key,'equipmentId',p.equipment_id,'name',e.name,'assetTag',e.asset_tag))
      from equipment_task_plans p join equipment e on e.id=p.equipment_id where p.project_id=p_project_id),'[]'::jsonb),
    'events', coalesce((select jsonb_agg(j order by j->>'recordedAt' desc) from (
      select jsonb_build_object('id',m.id,'itemKey',m.item_key,'equipmentId',m.equipment_id,
      'name',e.name,'assetTag',e.asset_tag,'action',m.action,'entryDate',m.entry_date,
      'from',m.from_location,'to',m.to_location,'destinationKey',m.destination_key,'notes',m.notes,'recordedAt',m.recorded_at,
      'recordedBy',trim(p.first_name||' '||p.last_name)) j
      from equipment_movement_events m join equipment e on e.id=m.equipment_id
      join profiles p on p.id=m.recorded_by where m.project_id=p_project_id
    ) q),'[]'::jsonb));
end $$;

create or replace function public.record_equipment_operation(p_project_id bigint, p_input jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_key text := p_input->>'itemKey';
  v_action text := p_input->>'action';
  v_equipment bigint := (p_input->>'equipmentId')::bigint;
  v_id uuid := (p_input->>'id')::uuid;
  v_date date := (p_input->>'entryDate')::date;
  v_destination text := p_input->>'destination';
  v_notes text := nullif(trim(p_input->>'notes'),'');
  v_name text;
  v_dest_name text;
  v_asset equipment%rowtype;
  v_checkout equipment_assignments%rowtype;
  v_placement equipment_task_assignments%rowtype;
  v_current_key text;
  v_from text;
  v_now timestamptz := now();
begin
  if auth.uid() is null or not coalesce(public.get_my_role()='admin' or public.is_project_foreman(p_project_id),false) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  if v_key ~ '^task-[1-9][0-9]*$' then
    select task_name into v_name from estimate_tasks where id=split_part(v_key,'-',2)::bigint and project_id=p_project_id;
  elsif v_key ~ '^category-[1-9][0-9]*$' then
    select category_name into v_name from estimate_categories where id=split_part(v_key,'-',2)::bigint and project_id=p_project_id
      and not exists(select 1 from estimate_tasks where category_id=estimate_categories.id);
  end if;
  if v_name is null then raise exception 'Select a task or a phase without subtasks in this project'; end if;
  select * into v_asset from equipment where id=v_equipment for update;
  if not found then raise exception 'Equipment not found'; end if;
  -- A successful supplier return retires the asset. A retry must acknowledge
  -- the original event even when the asset is no longer available afterwards.
  if exists(select 1 from equipment_movement_events where id=v_id and project_id=p_project_id and equipment_id=v_equipment and item_key=v_key and action=v_action) then return; end if;
  if v_action='unplan' then
    delete from equipment_task_plans where project_id=p_project_id and item_key=v_key and equipment_id=v_equipment;
    return;
  end if;
  if v_asset.status not in ('available','assigned') or
    (v_asset.current_project_id is not null and v_asset.current_project_id<>p_project_id) then
    raise exception 'Equipment is unavailable or checked out to another project';
  end if;
  if v_action='plan' then
    insert into equipment_task_plans values(p_project_id,v_key,v_equipment) on conflict do nothing;
    return;
  end if;
  if v_id is null or v_action not in ('deploy','transfer','return','used') or v_action is null
    or v_date is null or v_date<>(now() at time zone 'Asia/Manila')::date or length(coalesce(v_notes,''))>2000 then
    raise exception 'Movements must be recorded for today with a valid action and notes up to 2000 characters';
  end if;
  select * into v_checkout from equipment_assignments where equipment_id=v_equipment and returned_at is null for update;
  if v_checkout.id is not null and v_checkout.project_id<>p_project_id then raise exception 'Equipment is on another project'; end if;
  select * into v_placement from equipment_task_assignments where equipment_assignment_id=v_checkout.id and released_at is null for update;
  v_current_key := case when v_placement.task_id is not null then 'task-'||v_placement.task_id when v_placement.category_id is not null then 'category-'||v_placement.category_id end;
  v_from := coalesce(v_placement.task_name,case when v_checkout.id is not null then 'Project storage' else 'Inventory' end);
  if v_action='deploy' then
    if v_placement.id is not null then raise exception 'Already deployed. Transfer it from its current task instead'; end if;
    v_destination := v_key;
    v_dest_name := v_name;
  else
    if v_current_key is distinct from v_key then raise exception 'Equipment has moved. Refresh and record from its current task'; end if;
  end if;
  if v_action='used' then
    insert into equipment_movement_events values(v_id,p_project_id,v_key,v_equipment,v_action,v_date,v_from,v_from,v_notes,auth.uid(),v_now,v_key)
      on conflict (project_id,item_key,equipment_id,entry_date) where action='used' do nothing;
    return;
  elsif v_action='transfer' then
    if v_destination=v_key then raise exception 'Choose a different destination'; end if;
    if v_destination ~ '^task-[1-9][0-9]*$' then
      select task_name into v_dest_name from estimate_tasks where id=split_part(v_destination,'-',2)::bigint and project_id=p_project_id;
    elsif v_destination ~ '^category-[1-9][0-9]*$' then
      select category_name into v_dest_name from estimate_categories where id=split_part(v_destination,'-',2)::bigint and project_id=p_project_id
        and not exists(select 1 from estimate_tasks where category_id=estimate_categories.id);
    end if;
    if v_dest_name is null then raise exception 'Choose a destination task in this project'; end if;
  elsif v_action='return' then
    if v_destination not in ('storage','supplier') or v_destination is null then raise exception 'Choose Inventory or Rental supplier'; end if;
    v_dest_name := case when v_destination='supplier' then 'Rental supplier' else 'Inventory' end;
  end if;
  if v_checkout.id is null then
    insert into equipment_assignments(equipment_id,project_id,assigned_by,assigned_at)
      values(v_equipment,p_project_id,auth.uid(),v_now) returning * into v_checkout;
  end if;
  update equipment_task_assignments set released_at=greatest(v_now,assigned_at),
    release_reason=case when v_action='return' then 'returned' else 'moved' end
    where equipment_assignment_id=v_checkout.id and released_at is null;
  if v_action='return' then
    update equipment_assignments set returned_at=v_now where id=v_checkout.id;
    update equipment set status=case when v_destination='supplier' then 'retired' else 'available' end,
      current_project_id=null,last_returned_at=v_now where id=v_equipment;
  else
    insert into equipment_task_assignments(equipment_assignment_id,project_id,task_id,category_id,task_name,assigned_by,assigned_at,notes)
      values(v_checkout.id,p_project_id,
        case when v_destination like 'task-%' then split_part(v_destination,'-',2)::bigint end,
        case when v_destination like 'category-%' then split_part(v_destination,'-',2)::bigint end,
        v_dest_name,auth.uid(),v_now,v_notes);
    update equipment set status='assigned',current_project_id=p_project_id,last_assigned_at=v_now where id=v_equipment;
  end if;
  insert into equipment_movement_events values(v_id,p_project_id,v_key,v_equipment,v_action,v_date,v_from,v_dest_name,v_notes,auth.uid(),v_now,v_destination);
end $$;
revoke all on function public.equipment_tracking_data(bigint) from public, anon;
revoke all on function public.record_equipment_operation(bigint,jsonb) from public, anon;
grant execute on function public.equipment_tracking_data(bigint) to authenticated;
grant execute on function public.record_equipment_operation(bigint,jsonb) to authenticated;
