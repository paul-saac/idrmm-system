-- ============================================================================
-- Material Usage Log entries: the Daily Log type that reports a material's
-- current field status (Available / Low Stock / Fully Consumed) against a
-- specific project_materials (0014) record — same daily-log-item pattern
-- as daily_log_work_items/labor_items/expense_items, tied to a
-- project_materials row via FK rather than a free-typed name (the
-- "Select Material" screen in the Add Daily Log modal picks an existing
-- Materials Monitoring record, it doesn't create a new one).
--
-- Approving the daily log (see updateDailyLogStatus in
-- lib/daily-logs/actions.ts) copies each item's reported status onto its
-- project_materials row — this is what actually keeps Materials
-- Monitoring's stock status current, the same way approving a Work Log
-- is what makes its quantities count toward Progress.
--
-- Run this AFTER 0014_project_materials.sql.
-- ============================================================================

create table if not exists public.daily_log_material_usage_items (
  id bigint generated always as identity primary key,
  daily_log_id bigint not null references public.daily_logs (id) on delete cascade,
  project_material_id bigint not null references public.project_materials (id) on delete restrict,
  status text not null default 'available'
    check (status in ('available', 'low_stock', 'fully_consumed')),
  activity text,
  remarks text,
  created_at timestamptz not null default now()
);

create index if not exists idx_daily_log_material_usage_items_daily_log_id
  on public.daily_log_material_usage_items (daily_log_id);
create index if not exists idx_daily_log_material_usage_items_material_id
  on public.daily_log_material_usage_items (project_material_id);

alter table public.daily_log_material_usage_items enable row level security;

drop policy if exists "Admins can view material usage log items" on public.daily_log_material_usage_items;
create policy "Admins can view material usage log items" on public.daily_log_material_usage_items
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create material usage log items" on public.daily_log_material_usage_items;
create policy "Admins can create material usage log items" on public.daily_log_material_usage_items
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can update material usage log items" on public.daily_log_material_usage_items;
create policy "Admins can update material usage log items" on public.daily_log_material_usage_items
  for update using (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete material usage log items" on public.daily_log_material_usage_items;
create policy "Admins can delete material usage log items" on public.daily_log_material_usage_items
  for delete using (public.get_my_role() = 'admin');
