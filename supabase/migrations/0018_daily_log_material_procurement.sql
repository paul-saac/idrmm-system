-- ============================================================================
-- Material Procurement Log: the next of Daily Logs' six log types to get
-- a real table + UI. Same header/line-items split as Material Requests
-- (0017) — daily_log_material_procurement is one row per "Add Log" entry
-- in the modal (supplier, optional linked Material Request, fees,
-- photo, remarks), daily_log_material_procurement_items is one row per
-- material line item within it.
--
-- material_request_id/material_request_item_id are both nullable and
-- independent of each other conceptually per item — a procurement entry
-- can be a plain Direct Purchase with no Material Request at all, or can
-- reference one, in which case any item picked from that request's own
-- items (via the modal's two-step picker) carries its
-- material_request_item_id along so approving this log can credit that
-- exact request item's quantity_fulfilled (see updateDailyLogStatus in
-- lib/daily-logs/actions.ts) — a manually-typed item (this modal's own
-- "+ Add Item", not through the picker) simply leaves it null.
--
-- Record-keeping only for now: approving a procurement log does NOT
-- touch project_materials stock (unlike Material Usage Log, which does)
-- — that's a deliberate scope decision, not an oversight.
--
-- Run this AFTER 0017_material_requests.sql.
-- ============================================================================

create table if not exists public.daily_log_material_procurement (
  id bigint generated always as identity primary key,
  daily_log_id bigint not null references public.daily_logs (id) on delete cascade,
  procurement_type text not null default 'direct_purchase'
    check (procurement_type in ('direct_purchase', 'supplier_delivery')),
  supplier_name text,
  material_request_id bigint references public.material_requests (id) on delete set null,
  additional_fees numeric not null default 0,
  attachment_path text,
  remarks text,
  created_at timestamptz not null default now()
);

create table if not exists public.daily_log_material_procurement_items (
  id bigint generated always as identity primary key,
  procurement_id bigint not null references public.daily_log_material_procurement (id) on delete cascade,
  material_request_item_id bigint references public.material_request_items (id) on delete set null,
  material_name text not null,
  specification text,
  quantity numeric not null default 0,
  unit text,
  cost numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_daily_log_material_procurement_daily_log_id
  on public.daily_log_material_procurement (daily_log_id);
create index if not exists idx_daily_log_material_procurement_material_request_id
  on public.daily_log_material_procurement (material_request_id);
create index if not exists idx_daily_log_material_procurement_items_procurement_id
  on public.daily_log_material_procurement_items (procurement_id);
create index if not exists idx_daily_log_material_procurement_items_request_item_id
  on public.daily_log_material_procurement_items (material_request_item_id);

alter table public.daily_log_material_procurement enable row level security;
alter table public.daily_log_material_procurement_items enable row level security;

-- Admin-only for now, same caveat as every other Daily Logs/Materials
-- table: a Foreman-scoped policy belongs here once that portal exists.
drop policy if exists "Admins can view procurement logs" on public.daily_log_material_procurement;
create policy "Admins can view procurement logs" on public.daily_log_material_procurement
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create procurement logs" on public.daily_log_material_procurement;
create policy "Admins can create procurement logs" on public.daily_log_material_procurement
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can update procurement logs" on public.daily_log_material_procurement;
create policy "Admins can update procurement logs" on public.daily_log_material_procurement
  for update using (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete procurement logs" on public.daily_log_material_procurement;
create policy "Admins can delete procurement logs" on public.daily_log_material_procurement
  for delete using (public.get_my_role() = 'admin');

drop policy if exists "Admins can view procurement log items" on public.daily_log_material_procurement_items;
create policy "Admins can view procurement log items" on public.daily_log_material_procurement_items
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create procurement log items" on public.daily_log_material_procurement_items;
create policy "Admins can create procurement log items" on public.daily_log_material_procurement_items
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can update procurement log items" on public.daily_log_material_procurement_items;
create policy "Admins can update procurement log items" on public.daily_log_material_procurement_items
  for update using (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete procurement log items" on public.daily_log_material_procurement_items;
create policy "Admins can delete procurement log items" on public.daily_log_material_procurement_items
  for delete using (public.get_my_role() = 'admin');
