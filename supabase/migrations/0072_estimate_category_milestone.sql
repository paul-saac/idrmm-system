-- ============================================================================ DD
-- Lets a task-less ("standalone") category be a milestone too 
-- (estimate_categories.is_milestone) — the same flag a task already has
-- (0030_estimate_task_milestone.sql): the Gantt Chart draws it as a
-- single-date diamond instead of a bar, its start/end collapsing to one
-- date. Set from the Edit Phase form's Milestone checkbox, which only
-- shows while the category has no tasks; once it has some, it's a phase
-- again and the flag is ignored.
--
-- Run this AFTER 0071_progress_override_logs.sql.
-- ============================================================================

alter table public.estimate_categories
  add column if not exists is_milestone boolean not null default false;
