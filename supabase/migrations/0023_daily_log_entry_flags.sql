-- ============================================================================
-- Per-entry review flags: an admin reviewing a pending daily log can flag
-- an individual entry (a work item, a labor line, an other-expense line,
-- a material usage line, a whole material procurement log, or a whole
-- equipment acquisition log) as wrong, with a reason, *without* having
-- to reject the entire day's log to keep it out of the project's real
-- data. The log can then still be approved as a whole — flagged entries
-- just don't count: they're excluded from Progress (work items),
-- Expenses (labor/material/equipment/other), the Material Usage
-- History list, and the project_materials/material-request/equipment-
-- request sync updateDailyLogStatus otherwise runs on approval. See
-- lib/daily-logs/actions.ts.
--
-- One table rather than a flagged/reason/resolved column pair repeated
-- across all six entry tables — the same "this entry, wrong, here's why"
-- shape applies identically to every entry type, so a single polymorphic
-- table (entry_type + entry_id, no FK — the referenced table varies) is
-- simpler than duplicating flag columns six times over. daily_log_id is
-- denormalized on here too purely so "every flag on this log" is a
-- single indexed lookup rather than a fan-out per entry type.
--
-- A flag is never removed once the log it belongs to is approved (the
-- log itself is locked at that point, same as its entries) — it's
-- either still open (resolved_at is null: the foreman still owes a
-- fix) or resolved (an admin closed it out once the correction showed
-- up in a later log). While the log is still pending, an admin can
-- delete a flag outright (see unflagDailyLogEntry) if they change their
-- mind before approving.
--
-- Run this AFTER 0022_daily_log_multiple_attachments.sql.
-- ============================================================================

create table if not exists public.daily_log_entry_flags (
  id bigint generated always as identity primary key,
  daily_log_id bigint not null references public.daily_logs (id) on delete cascade,
  entry_type text not null
    check (entry_type in (
      'work_item',
      'labor_item',
      'expense_item',
      'material_usage_item',
      'material_procurement',
      'equipment_acquisition'
    )),
  entry_id bigint not null,
  reason text not null,
  flagged_by uuid not null references public.profiles (id) on delete restrict,
  flagged_at timestamptz not null default now(),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  unique (entry_type, entry_id)
);

create index if not exists idx_daily_log_entry_flags_daily_log_id
  on public.daily_log_entry_flags (daily_log_id);

alter table public.daily_log_entry_flags enable row level security;

-- Admin-only for now, same caveat as every other daily-log table.
drop policy if exists "Admins can view daily log entry flags" on public.daily_log_entry_flags;
create policy "Admins can view daily log entry flags" on public.daily_log_entry_flags
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create daily log entry flags" on public.daily_log_entry_flags;
create policy "Admins can create daily log entry flags" on public.daily_log_entry_flags
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can update daily log entry flags" on public.daily_log_entry_flags;
create policy "Admins can update daily log entry flags" on public.daily_log_entry_flags
  for update using (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete daily log entry flags" on public.daily_log_entry_flags;
create policy "Admins can delete daily log entry flags" on public.daily_log_entry_flags
  for delete using (public.get_my_role() = 'admin');
