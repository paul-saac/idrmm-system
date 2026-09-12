-- ============================================================================
-- daily_log_equipment_acquisition: the Add Daily Log modal's "Equipment
-- Acquisition Log" entry type — the equipment counterpart of
-- daily_log_material_procurement (0018), but flat rather than a
-- header/items split: the reference form (Equipment Name, Quantity,
-- Specification, Type, Amount, an optional Equipment Request Number)
-- always describes exactly one piece of equipment, so one row is one
-- acquisition, same shape as daily_log_expense_items rather than
-- daily_log_material_procurement's multi-item header.
--
-- equipment_request_id / equipment_request_item_id are both optional and
-- both nullable-on-delete — set only when this entry was picked through
-- the modal's "Select Equipment Request" -> "Select Item" picker rather
-- than typed in free-hand. Approving the daily log this row belongs to
-- is what credits equipment_request_items.quantity_fulfilled (see
-- updateDailyLogStatus in lib/daily-logs/actions.ts), same "approval is
-- what makes it real" convention as material procurement fulfillment.
--
-- Run this AFTER 0020_equipment_requests.sql.
-- ============================================================================

create table if not exists public.daily_log_equipment_acquisition (
  id bigint generated always as identity primary key,
  daily_log_id bigint not null references public.daily_logs (id) on delete cascade,
  equipment_request_id bigint references public.equipment_requisitions (id) on delete set null,
  equipment_request_item_id bigint references public.equipment_requisition_items (id) on delete set null,
  equipment_name text not null,
  specification text,
  quantity numeric not null default 0,
  acquisition_type text not null default 'rental'
    check (acquisition_type in ('rental', 'purchase')),
  amount numeric not null default 0,
  attachment_path text,
  remarks text,
  created_at timestamptz not null default now()
);

create index if not exists idx_daily_log_equipment_acquisition_daily_log_id
  on public.daily_log_equipment_acquisition (daily_log_id);
create index if not exists idx_daily_log_equipment_acquisition_request_id
  on public.daily_log_equipment_acquisition (equipment_request_id);
create index if not exists idx_daily_log_equipment_acquisition_request_item_id
  on public.daily_log_equipment_acquisition (equipment_request_item_id);

alter table public.daily_log_equipment_acquisition enable row level security;

-- Admin-only for now, same caveat as every other daily-log entry table.
drop policy if exists "Admins can view equipment acquisition logs" on public.daily_log_equipment_acquisition;
create policy "Admins can view equipment acquisition logs" on public.daily_log_equipment_acquisition
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create equipment acquisition logs" on public.daily_log_equipment_acquisition;
create policy "Admins can create equipment acquisition logs" on public.daily_log_equipment_acquisition
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can update equipment acquisition logs" on public.daily_log_equipment_acquisition;
create policy "Admins can update equipment acquisition logs" on public.daily_log_equipment_acquisition
  for update using (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete equipment acquisition logs" on public.daily_log_equipment_acquisition;
create policy "Admins can delete equipment acquisition logs" on public.daily_log_equipment_acquisition
  for delete using (public.get_my_role() = 'admin');
