-- ============================================================================
-- Adds a per-task planned schedule (planned_start_date/planned_end_date)
-- to estimate_tasks — the baseline the Gantt Chart view and the
-- Automated Delay Risk Assessment / Completion Forecasting feature
-- (Earned Value Management: Planned Value needs a time-phased baseline)
-- both need.
--
-- Without this, Planned Value has no per-task schedule to compare actual
-- progress against and has to assume linear progress across the whole
-- project's start_date -> target_end_date — a coarse fallback. With a
-- planned start/end per task, Planned Value is computed properly per
-- task and rolled up, and the Gantt Chart has real bars to draw.
--
-- Both columns are nullable: an unscheduled task simply has no bar in
-- the Gantt and falls back to the project-wide linear baseline for its
-- own contribution to Planned Value — not an error state.
--
-- Run this AFTER 0026_projects_column_cleanup.sql.
-- ============================================================================

alter table public.estimate_tasks
  add column if not exists planned_start_date date,
  add column if not exists planned_end_date date;
