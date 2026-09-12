-- ============================================================================
-- Brings an existing database's `equipment` table up to the shape
-- 0007_equipment.sql now creates on a fresh install: a real asset
-- register (asset_tag, category, description, serial_number, status,
-- current_project_id, last_assigned_at/last_returned_at) instead of a
-- bare name list, plus the equipment_assignments checkout/checkin
-- history table.
--
-- The original `name text not null unique` constraint is dropped —
-- asset_tag is the real unique identifier now, and a shop can own
-- several identical-name tools ("Claw Hammer" x3) as separate rows.
-- Every existing row gets a generated asset_tag so the new not-null
-- unique constraint doesn't fail on data that predates this migration.
--
-- Run this AFTER 0015_daily_log_material_usage_items.sql.
-- ============================================================================

alter table public.equipment add column if not exists asset_tag text;
alter table public.equipment add column if not exists category text;
alter table public.equipment add column if not exists description text;
alter table public.equipment add column if not exists serial_number text;
alter table public.equipment add column if not exists status text;
alter table public.equipment add column if not exists current_project_id bigint
  references public.projects (id) on delete set null;
alter table public.equipment add column if not exists last_assigned_at timestamptz;
alter table public.equipment add column if not exists last_returned_at timestamptz;
alter table public.equipment add column if not exists created_by uuid
  references public.profiles (id) on delete set null;
alter table public.equipment add column if not exists updated_at timestamptz
  not null default now();

update public.equipment
set asset_tag = 'EQ-' || lpad(id::text, 3, '0')
where asset_tag is null;

update public.equipment
set status = 'available'
where status is null;

alter table public.equipment alter column asset_tag set not null;
alter table public.equipment alter column status set not null;
alter table public.equipment alter column status set default 'available';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'equipment_asset_tag_key'
  ) then
    alter table public.equipment add constraint equipment_asset_tag_key unique (asset_tag);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'equipment_status_check'
  ) then
    alter table public.equipment add constraint equipment_status_check
      check (status in ('available', 'assigned', 'maintenance', 'retired'));
  end if;
end $$;

alter table public.equipment drop constraint if exists equipment_name_key;

create table if not exists public.equipment_assignments (
  id bigint generated always as identity primary key,
  equipment_id bigint not null references public.equipment (id) on delete cascade,
  project_id bigint not null references public.projects (id) on delete cascade,
  assigned_by uuid not null references public.profiles (id) on delete restrict,
  assigned_at timestamptz not null default now(),
  returned_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_equipment_current_project_id on public.equipment (current_project_id);
create index if not exists idx_equipment_status on public.equipment (status);
create index if not exists idx_equipment_assignments_equipment_id on public.equipment_assignments (equipment_id);
create index if not exists idx_equipment_assignments_project_id on public.equipment_assignments (project_id);

alter table public.equipment_assignments enable row level security;

drop policy if exists "Admins can view equipment assignments" on public.equipment_assignments;
create policy "Admins can view equipment assignments" on public.equipment_assignments
  for select using (public.get_my_role() = 'admin');
drop policy if exists "Admins can create equipment assignments" on public.equipment_assignments;
create policy "Admins can create equipment assignments" on public.equipment_assignments
  for insert with check (public.get_my_role() = 'admin');
drop policy if exists "Admins can update equipment assignments" on public.equipment_assignments;
create policy "Admins can update equipment assignments" on public.equipment_assignments
  for update using (public.get_my_role() = 'admin');
drop policy if exists "Admins can delete equipment assignments" on public.equipment_assignments;
create policy "Admins can delete equipment assignments" on public.equipment_assignments
  for delete using (public.get_my_role() = 'admin');

drop trigger if exists set_equipment_updated_at on public.equipment;
create trigger set_equipment_updated_at
  before update on public.equipment
  for each row execute function public.set_updated_at();
