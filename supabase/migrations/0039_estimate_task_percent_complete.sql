-- Done
-- Gantt Chart-only percent-complete, requested after the adviser review to
-- refocus on the Gantt Chart: estimate_tasks.percent_complete is a directly
-- user-editable 0-100 field, set per (non-milestone) task from the Gantt
-- Chart's own task list. A phase's own percent complete is never stored —
-- it's always computed client-side as a plain average of its own tasks'
-- percent_complete (see gantt-chart-view.tsx).
--
-- Deliberately separate from lib/progress/data.ts's own ProjectProgress
-- (which stays exactly as-is, still derived from approved daily_log_
-- work_items for the Progress Overview tab) — the Gantt Chart no longer
-- reads that at all, this is its own independent source of truth.
-- ============================================================================

alter table public.estimate_tasks
  add column if not exists percent_complete integer not null default 0
    check (percent_complete >= 0 and percent_complete <= 100);
