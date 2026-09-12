-- ============================================================================
-- Labor Logs and Other Expense: the next two of Daily Logs' six log types
-- to get a real table + UI, following the exact same pattern as Work Logs
-- (0010) — one row per entry added in the Add Daily Log modal, tied to a
-- daily_logs submission, with an optional photo living in the same
-- daily-log-attachments bucket (its policies are scoped by bucket_id, not
-- by table, so no new Storage policies are needed here).
--
-- Material Usage, Material Procurement Log, and Equipment Expense are
-- still "coming soon" — this migration only covers Labor Logs and Other
-- Expense.
--
-- Run this AFTER 0012_drop_unused_daily_log_progress.sql.
-- ============================================================================

create table if not exists public.daily_log_labor_items (
  id bigint generated always as identity primary key,
  daily_log_id bigint not null references public.daily_logs (id) on delete cascade,
  worker_role text not null,
  worker_count numeric not null default 0,
  daily_rate numeric not null default 0,
  ot_hours numeric not null default 0,
  workers_rendered_overtime numeric not null default 0,
  workers_rendered_halfday numeric not null default 0,
  attachment_path text,
  remarks text,
  created_at timestamptz not null default now()
);

create index if not exists idx_daily_log_labor_items_daily_log_id
  on public.daily_log_labor_items (daily_log_id);

alter table public.daily_log_labor_items enable row level security;

drop policy if exists "Admins can view labor log items" on public.daily_log_labor_items;
create policy "Admins can view labor log items" on public.daily_log_labor_items
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create labor log items" on public.daily_log_labor_items;
create policy "Admins can create labor log items" on public.daily_log_labor_items
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can update labor log items" on public.daily_log_labor_items;
create policy "Admins can update labor log items" on public.daily_log_labor_items
  for update using (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete labor log items" on public.daily_log_labor_items;
create policy "Admins can delete labor log items" on public.daily_log_labor_items
  for delete using (public.get_my_role() = 'admin');

create table if not exists public.daily_log_expense_items (
  id bigint generated always as identity primary key,
  daily_log_id bigint not null references public.daily_logs (id) on delete cascade,
  expense_category text not null,
  amount numeric not null default 0,
  additional_fees numeric not null default 0,
  description text,
  attachment_path text,
  remarks text,
  created_at timestamptz not null default now()
);

create index if not exists idx_daily_log_expense_items_daily_log_id
  on public.daily_log_expense_items (daily_log_id);

alter table public.daily_log_expense_items enable row level security;

drop policy if exists "Admins can view expense log items" on public.daily_log_expense_items;
create policy "Admins can view expense log items" on public.daily_log_expense_items
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create expense log items" on public.daily_log_expense_items;
create policy "Admins can create expense log items" on public.daily_log_expense_items
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can update expense log items" on public.daily_log_expense_items;
create policy "Admins can update expense log items" on public.daily_log_expense_items
  for update using (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete expense log items" on public.daily_log_expense_items;
create policy "Admins can delete expense log items" on public.daily_log_expense_items
  for delete using (public.get_my_role() = 'admin');
