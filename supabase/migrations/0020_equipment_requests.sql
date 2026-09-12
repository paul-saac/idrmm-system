-- ============================================================================
-- equipment_requisitions / equipment_requisition_items: the Equipment
-- tab's "Requests" sub-tab — the equipment counterpart of
-- material_requests (0017). Same header/line-items split, same workflow
-- (submitted -> approved -> partially_fulfilled/fulfilled, or
-- canceled), same "item fields are denormalized, not pointed at the
-- equipment inventory (0007)" reasoning — a request is often for
-- something rented for the job, not anything the company stocks.
--
-- Named "requisitions" rather than "requests" specifically to NOT
-- collide with 0007_equipment.sql's own public.equipment_requests table
-- — that one is a simpler, single-item, task/inventory-linked table that
-- was scaffolded early on and never wired up to any UI (no partial-
-- fulfillment tracking, no request number), same "designed ahead, never
-- built" status "Equipment Expense" had on the daily log until now. It's
-- left untouched here; this is a fresh, separate table for the richer
-- request+fulfillment workflow the Equipment Requests feature actually
-- needs. FK columns below are still named equipment_request_id /
-- equipment_request_item_id (what they point at, not the table's own
-- name), which is also what lib/equipment-requests and
-- lib/daily-logs/actions.ts use throughout.
--
-- status is the overall request's workflow state:
--   submitted   -> just created, awaiting admin review
--   approved    -> admin approved, nothing acquired against it yet
--   partially_fulfilled / fulfilled -> derived from how much of each
--     item's quantity_needed has been covered by quantity_fulfilled
--     (see deriveEquipmentRequestStatus in lib/equipment-requests/
--     status.ts) — not set directly by an action
--   canceled    -> terminal, set explicitly by an admin
--
-- Run this AFTER 0019_daily_logs_one_per_day.sql.
-- ============================================================================

create table if not exists public.equipment_requisitions (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id) on delete cascade,
  er_no text not null,
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
  unique (project_id, er_no)
);

create table if not exists public.equipment_requisition_items (
  id bigint generated always as identity primary key,
  equipment_request_id bigint not null references public.equipment_requisitions (id) on delete cascade,
  equipment_name text not null,
  specification text,
  quantity_needed numeric not null default 0,
  uom text,
  purpose text,
  quantity_fulfilled numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_equipment_requisitions_project_id
  on public.equipment_requisitions (project_id);
create index if not exists idx_equipment_requisitions_status
  on public.equipment_requisitions (status);
create index if not exists idx_equipment_requisition_items_request_id
  on public.equipment_requisition_items (equipment_request_id);

alter table public.equipment_requisitions enable row level security;
alter table public.equipment_requisition_items enable row level security;

-- Admin-only for now, same caveat as material_requests.
drop policy if exists "Admins can view equipment requisitions" on public.equipment_requisitions;
create policy "Admins can view equipment requisitions" on public.equipment_requisitions
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create equipment requisitions" on public.equipment_requisitions;
create policy "Admins can create equipment requisitions" on public.equipment_requisitions
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can update equipment requisitions" on public.equipment_requisitions;
create policy "Admins can update equipment requisitions" on public.equipment_requisitions
  for update using (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete equipment requisitions" on public.equipment_requisitions;
create policy "Admins can delete equipment requisitions" on public.equipment_requisitions
  for delete using (public.get_my_role() = 'admin');

drop policy if exists "Admins can view equipment requisition items" on public.equipment_requisition_items;
create policy "Admins can view equipment requisition items" on public.equipment_requisition_items
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create equipment requisition items" on public.equipment_requisition_items;
create policy "Admins can create equipment requisition items" on public.equipment_requisition_items
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can update equipment requisition items" on public.equipment_requisition_items;
create policy "Admins can update equipment requisition items" on public.equipment_requisition_items
  for update using (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete equipment requisition items" on public.equipment_requisition_items;
create policy "Admins can delete equipment requisition items" on public.equipment_requisition_items
  for delete using (public.get_my_role() = 'admin');

drop trigger if exists set_equipment_requisitions_updated_at on public.equipment_requisitions;
create trigger set_equipment_requisitions_updated_at
  before update on public.equipment_requisitions
  for each row execute function public.set_updated_at();
