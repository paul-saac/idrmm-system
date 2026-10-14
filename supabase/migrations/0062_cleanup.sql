-- Clean-up: removes what nothing in the app reads or writes any more.
--
-- Tables
--   * task_progress_material_usage (0040) and category_progress_material_usage
--     (0048) — "materials used" against the project's stock, replaced by
--     task_progress_material_entries (0050); a phase's progress form has no
--     materials-used inputs at all.
--   * estimate_task_labor_assignments (0035) — a task's planned role +
--     headcount list. The Edit Task form no longer has it; the Team (0059)
--     is who's assigned now.
--
-- Columns
--   * estimate_tasks / estimate_categories .weight (0004) and
--     .weight_override (0054) — weights are computed from cost
--     (lib/cost-estimate/weights.ts).
--   * estimate_tasks.percent_complete (0039) — % complete is computed live
--     (lib/task-progress/calculate.ts).
--   * task_progress_entries / category_progress_entries .labor_headcount
--     (0040/0048), .percent_complete_override (0049), .issue and .remarks
--     (0052) — no longer part of the Daily Progress Update.
--
-- The Gantt chart's undo history (gantt_snapshots) is cleared too: its old
-- snapshots still carry the dropped columns and couldn't be restored. It's
-- DELETEd rather than TRUNCATEd — projects.gantt_undo_cursor_id points at
-- it (on delete set null), and TRUNCATE ... CASCADE would empty projects.
--
-- Not touched: the Progress tab (old Progress Overview and Daily Logs) is
-- on hold, not gone — Daily Logs still feed Expenses, material usage and
-- procurement, request deliveries and Reports.
--
-- Run this AFTER 0061_notifications.sql.

delete from public.gantt_snapshots;

drop table if exists public.task_progress_material_usage;
drop table if exists public.category_progress_material_usage;
drop table if exists public.estimate_task_labor_assignments;

alter table public.estimate_tasks
  drop column if exists weight,
  drop column if exists weight_override,
  drop column if exists percent_complete;

alter table public.estimate_categories
  drop column if exists weight,
  drop column if exists weight_override;

alter table public.task_progress_entries
  drop column if exists labor_headcount,
  drop column if exists percent_complete_override,
  drop column if exists issue,
  drop column if exists remarks;

alter table public.category_progress_entries
  drop column if exists labor_headcount,
  drop column if exists percent_complete_override,
  drop column if exists issue,
  drop column if exists remarks;
