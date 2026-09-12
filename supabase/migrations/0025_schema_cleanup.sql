-- ============================================================================
-- Schema cleanup: drops six tables that were built ahead of their UI as
-- early scaffolding, then abandoned once the real feature was actually
-- designed and built differently — nothing in the app has ever read or
-- written to any of them:
--
--   materials, material_usage (0006)   -> superseded by project_materials
--     (0014) + daily_log_material_usage_items (0015); no catalog needed,
--     everything is denormalized per-project instead.
--   equipment_requests, equipment_usage (0007) -> superseded by
--     equipment_requisitions/equipment_requisition_items (0020) +
--     daily_log_equipment_acquisition (0021).
--   project_expenses (0008)            -> superseded by the Expenses
--     feature, which reads live from the daily_log_* entry tables
--     instead of a separate ledger.
--   daily_log_progress (0005)          -> already dead per
--     0012_drop_unused_daily_log_progress.sql; repeated here with
--     if-exists so this cleanup is complete even if 0012 was never run.
-- These six are dropped unconditionally — there is no ambiguity about
-- them, nothing reads or writes them regardless of this database's
-- migration history.
--
-- material_requests is different, and handled carefully: 0017_material_
-- requests.sql used `create table if not exists public.material_
-- requests`, which silently no-ops if 0006's own (older, incompatible)
-- material_requests table already existed. Whether THIS database was
-- actually hit by that depends on exact run order/history that isn't
-- fully known from here, so instead of assuming, the block below checks
-- the live table for a `mr_no` column (a 0017-only field) and only
-- drops+rebuilds material_requests/material_request_items if it's
-- missing — i.e. if the table is already on the correct 0017 shape,
-- this leaves it (and any real rows in it) completely untouched.
--
-- If a rebuild does happen, any daily_log_material_procurement(_items)
-- rows pointing at the now-gone old rows are nulled out before the two
-- FKs are re-created, so this can't fail partway through on orphaned
-- data — and if no rebuild happens, that null-out step matches zero
-- rows and is a no-op.
--
-- Run this AFTER 0024_daily_log_entry_flag_updates.sql.
-- ============================================================================

drop table if exists public.equipment_requests;
drop table if exists public.equipment_usage;

drop table if exists public.project_expenses;

drop table if exists public.daily_log_progress;

-- Must run before the materials/material_usage drops below: the old
-- 0006-shape material_requests table (if that's what's live) holds a
-- foreign key to materials, so materials can't be dropped while that
-- old table might still exist.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'material_requests'
      and column_name = 'mr_no'
  ) then
    raise notice 'material_requests is missing or on the old 0006 shape — rebuilding it.';
    execute 'drop table if exists public.material_request_items cascade';
    execute 'drop table if exists public.material_requests cascade';
  else
    raise notice 'material_requests already has the correct 0017 shape — leaving it untouched.';
  end if;
end $$;

drop table if exists public.material_usage;
alter table public.project_materials drop column if exists material_id;
drop table if exists public.materials;

create table if not exists public.material_requests (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id) on delete cascade,
  mr_no text not null,
  requested_by uuid not null references public.profiles (id) on delete restrict,
  request_date timestamptz not null default now(),
  date_required date,
  priority text not null default 'routine'
    check (priority in ('routine', 'urgent', 'emergency')),
  remarks text,
  status text not null default 'submitted'
    check (status in ('submitted', 'approved', 'partially_fulfilled', 'fulfilled', 'canceled')),
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, mr_no)
);

create table if not exists public.material_request_items (
  id bigint generated always as identity primary key,
  material_request_id bigint not null references public.material_requests (id) on delete cascade,
  material_name text not null,
  specification text,
  quantity_needed numeric not null default 0,
  uom text,
  purpose text,
  quantity_fulfilled numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_material_requests_project_id
  on public.material_requests (project_id);
create index if not exists idx_material_requests_status
  on public.material_requests (status);
create index if not exists idx_material_request_items_request_id
  on public.material_request_items (material_request_id);

alter table public.material_requests enable row level security;
alter table public.material_request_items enable row level security;

drop policy if exists "Admins can view material requests" on public.material_requests;
create policy "Admins can view material requests" on public.material_requests
  for select using (public.get_my_role() = 'admin');
drop policy if exists "Admins can create material requests" on public.material_requests;
create policy "Admins can create material requests" on public.material_requests
  for insert with check (public.get_my_role() = 'admin');
drop policy if exists "Admins can update material requests" on public.material_requests;
create policy "Admins can update material requests" on public.material_requests
  for update using (public.get_my_role() = 'admin');
drop policy if exists "Admins can delete material requests" on public.material_requests;
create policy "Admins can delete material requests" on public.material_requests
  for delete using (public.get_my_role() = 'admin');

drop policy if exists "Admins can view material request items" on public.material_request_items;
create policy "Admins can view material request items" on public.material_request_items
  for select using (public.get_my_role() = 'admin');
drop policy if exists "Admins can create material request items" on public.material_request_items;
create policy "Admins can create material request items" on public.material_request_items
  for insert with check (public.get_my_role() = 'admin');
drop policy if exists "Admins can update material request items" on public.material_request_items;
create policy "Admins can update material request items" on public.material_request_items
  for update using (public.get_my_role() = 'admin');
drop policy if exists "Admins can delete material request items" on public.material_request_items;
create policy "Admins can delete material request items" on public.material_request_items
  for delete using (public.get_my_role() = 'admin');

drop trigger if exists set_material_requests_updated_at on public.material_requests;
create trigger set_material_requests_updated_at
  before update on public.material_requests
  for each row execute function public.set_updated_at();

-- Clear any now-orphaned links before (re-)establishing the FKs below —
-- a no-op if material_requests/material_request_items weren't touched
-- above, since every existing link is still valid in that case.
update public.daily_log_material_procurement p
set material_request_id = null
where material_request_id is not null
  and not exists (
    select 1 from public.material_requests r where r.id = p.material_request_id
  );

update public.daily_log_material_procurement_items i
set material_request_item_id = null
where material_request_item_id is not null
  and not exists (
    select 1 from public.material_request_items r where r.id = i.material_request_item_id
  );

-- Checked by column rather than by a guessed constraint name: the
-- items-table FK's natural name exceeds Postgres's 63-char identifier
-- limit and would get silently truncated, which makes a name-based
-- drop/re-add unreliable. Checking for "does a FK on this column
-- already exist" instead means this only adds one when it's actually
-- missing (the rebuild-happened case) and never stacks a redundant
-- second FK on top of one that's already there (the untouched case).
do $$
begin
  if not exists (
    select 1
    from information_schema.key_column_usage kcu
    join information_schema.table_constraints tc
      on tc.constraint_name = kcu.constraint_name
     and tc.table_schema = kcu.table_schema
    where kcu.table_schema = 'public'
      and kcu.table_name = 'daily_log_material_procurement'
      and kcu.column_name = 'material_request_id'
      and tc.constraint_type = 'FOREIGN KEY'
  ) then
    alter table public.daily_log_material_procurement
      add constraint daily_log_material_procurement_material_request_id_fkey
      foreign key (material_request_id) references public.material_requests (id) on delete set null;
  end if;

  if not exists (
    select 1
    from information_schema.key_column_usage kcu
    join information_schema.table_constraints tc
      on tc.constraint_name = kcu.constraint_name
     and tc.table_schema = kcu.table_schema
    where kcu.table_schema = 'public'
      and kcu.table_name = 'daily_log_material_procurement_items'
      and kcu.column_name = 'material_request_item_id'
      and tc.constraint_type = 'FOREIGN KEY'
  ) then
    alter table public.daily_log_material_procurement_items
      add constraint daily_log_material_procurement_items_mr_item_id_fkey
      foreign key (material_request_item_id) references public.material_request_items (id) on delete set null;
  end if;
end $$;
