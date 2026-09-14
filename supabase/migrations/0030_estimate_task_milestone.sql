-- ============================================================================
-- Adds a manually-flagged milestone marker per task
-- (estimate_tasks.is_milestone) — the Gantt Chart (Overview > Schedule)
-- renders a flagged task as a zero-duration diamond instead of a bar
-- (gantt-task-react's `type: "milestone"`), matching how the admin
-- would mark a real point-in-time event on the schedule — "Permit
-- Approved", "Client Sign-off", "Foundation Inspection Passed" — rather
-- than a task with duration.
--
-- Deliberately just a boolean, not a new task type replacing "task": a
-- milestone is still a normal estimate_tasks row with its own cost/
-- category/predecessor/etc — only its start/end collapse to the same
-- date and it renders as a diamond. Flipping the flag off turns it back
-- into an ordinary task with whatever dates it already had.
--
-- Run this AFTER 0029_estimate_task_predecessor.sql.
-- ============================================================================

alter table public.estimate_tasks
  add column if not exists is_milestone boolean not null default false;
