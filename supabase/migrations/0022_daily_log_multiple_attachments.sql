-- ============================================================================
-- Every daily-log entry form (Work Log, Labor Log, Other Expense,
-- Material Procurement, Equipment Acquisition) could only carry a single
-- attachment_path. Replaced with attachment_paths text[] on all five
-- tables so a user can attach more than one photo per entry.
--
-- A plain text[] column rather than a new per-table attachments join
-- table — the ordering/grouping a join table buys isn't needed here
-- (Storage cleanup and signed-URL fan-out just need "the list of paths
-- for this row"), and it keeps five tables from turning into ten.
--
-- Existing single-path rows are carried over into a one-element array
-- rather than dropped, in case this runs against a database that
-- already has real attachment data.
--
-- Run this AFTER 0021_daily_log_equipment_acquisition.sql.
-- ============================================================================

alter table public.daily_log_work_items
  add column if not exists attachment_paths text[] not null default '{}';
update public.daily_log_work_items
  set attachment_paths = array[attachment_path]
  where attachment_path is not null and cardinality(attachment_paths) = 0;
alter table public.daily_log_work_items drop column if exists attachment_path;

alter table public.daily_log_labor_items
  add column if not exists attachment_paths text[] not null default '{}';
update public.daily_log_labor_items
  set attachment_paths = array[attachment_path]
  where attachment_path is not null and cardinality(attachment_paths) = 0;
alter table public.daily_log_labor_items drop column if exists attachment_path;

alter table public.daily_log_expense_items
  add column if not exists attachment_paths text[] not null default '{}';
update public.daily_log_expense_items
  set attachment_paths = array[attachment_path]
  where attachment_path is not null and cardinality(attachment_paths) = 0;
alter table public.daily_log_expense_items drop column if exists attachment_path;

alter table public.daily_log_material_procurement
  add column if not exists attachment_paths text[] not null default '{}';
update public.daily_log_material_procurement
  set attachment_paths = array[attachment_path]
  where attachment_path is not null and cardinality(attachment_paths) = 0;
alter table public.daily_log_material_procurement drop column if exists attachment_path;

alter table public.daily_log_equipment_acquisition
  add column if not exists attachment_paths text[] not null default '{}';
update public.daily_log_equipment_acquisition
  set attachment_paths = array[attachment_path]
  where attachment_path is not null and cardinality(attachment_paths) = 0;
alter table public.daily_log_equipment_acquisition drop column if exists attachment_path;
