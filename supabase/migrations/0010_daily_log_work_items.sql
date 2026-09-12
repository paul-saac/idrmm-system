-- ============================================================================
-- Work Log entries: the first of Daily Logs' six log types to get a real
-- table + UI (Labor Logs, Material Usage, Material Procurement Log,
-- Equipment Expense, and Other Expense are still "coming soon" in the
-- app — this only covers Work Logs).
--
-- Each row is one "I completed X quantity of this task item today"
-- entry, tied to a specific daily_logs submission and a specific
-- estimate_tasks row (the "Work Item"), with an optional photo.
-- category_id is stored alongside task_id (not just derived from the
-- task) because it's what the Phase Category dropdown actually submits,
-- and keeping both avoids an extra join to answer "which phase was this
-- logged under" later.
--
-- Run this AFTER 0009_task_other_costs_fixup.sql.
-- ============================================================================

create table if not exists public.daily_log_work_items (
  id bigint generated always as identity primary key,
  daily_log_id bigint not null references public.daily_logs (id) on delete cascade,
  category_id bigint not null references public.estimate_categories (id) on delete restrict,
  task_id bigint not null references public.estimate_tasks (id) on delete restrict,
  quantity_completed numeric not null default 0,
  unit text,
  activity text,
  attachment_path text,
  created_at timestamptz not null default now()
);

create index if not exists idx_daily_log_work_items_daily_log_id
  on public.daily_log_work_items (daily_log_id);
create index if not exists idx_daily_log_work_items_task_id
  on public.daily_log_work_items (task_id);

alter table public.daily_log_work_items enable row level security;

-- Admin-only for now, same caveat as every other Progress/Daily Logs
-- table: a Foreman submitting their own project's logs and a Project
-- Manager reviewing them is the real end state, but neither role has a
-- dashboard built yet, so there's no code to check that access pattern
-- against.
drop policy if exists "Admins can view work log items" on public.daily_log_work_items;
create policy "Admins can view work log items" on public.daily_log_work_items
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create work log items" on public.daily_log_work_items;
create policy "Admins can create work log items" on public.daily_log_work_items
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can update work log items" on public.daily_log_work_items;
create policy "Admins can update work log items" on public.daily_log_work_items
  for update using (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete work log items" on public.daily_log_work_items;
create policy "Admins can delete work log items" on public.daily_log_work_items
  for delete using (public.get_my_role() = 'admin');

-- --- Storage: where the optional attachment photos actually live -----------
-- A private bucket (not "public") — files are only ever served back
-- through a signed URL the app requests, not a bare public link.
insert into storage.buckets (id, name, public)
values ('daily-log-attachments', 'daily-log-attachments', false)
on conflict (id) do nothing;

drop policy if exists "Admins can upload work log attachments" on storage.objects;
create policy "Admins can upload work log attachments" on storage.objects
  for insert
  with check (
    bucket_id = 'daily-log-attachments'
    and public.get_my_role() = 'admin'
  );

drop policy if exists "Admins can view work log attachments" on storage.objects;
create policy "Admins can view work log attachments" on storage.objects
  for select
  using (
    bucket_id = 'daily-log-attachments'
    and public.get_my_role() = 'admin'
  );

drop policy if exists "Admins can delete work log attachments" on storage.objects;
create policy "Admins can delete work log attachments" on storage.objects
  for delete
  using (
    bucket_id = 'daily-log-attachments'
    and public.get_my_role() = 'admin'
  );
