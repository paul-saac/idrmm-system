-- ============================================================================
-- Adds a single predecessor per task (estimate_tasks.predecessor_task_id)
-- — the "this task starts after that one finishes" relationship the
-- Gantt Chart (Progress > Schedule) draws as a dependency arrow between
-- two bars, the same free "Task and dependency visualization" feature
-- @svar-ui/react-gantt already ships in its MIT-licensed core (verified
-- directly: a task/link pair rendered a real connector line with an
-- arrowhead even with the chart in readonly mode).
--
-- Deliberately a single FK column, not a join table for many-to-many
-- predecessors, and no separate dependency-type column (every link is
-- treated as Finish-to-Start — "starts after its predecessor finishes",
-- the relationship construction schedules actually use almost
-- exclusively) — matches the "recommended first step" scoping this
-- schedule feature has followed throughout (task table + phase grouping
-- first, then read-only visualization, now the first real relationship
-- between tasks). A multi-predecessor join table is a bigger, separate
-- change to make later if it's actually needed.
--
-- `on delete set null` rather than restrict: deleting a task shouldn't
-- be blocked just because something else pointed to it as a
-- predecessor — the dependent task's own row is untouched, it just
-- stops showing that arrow.
--
-- Run this AFTER 0028_project_delete_cascade_fixup.sql.
-- ============================================================================

alter table public.estimate_tasks
  add column if not exists predecessor_task_id bigint
  references public.estimate_tasks (id) on delete set null;

create index if not exists idx_estimate_tasks_predecessor_task_id
  on public.estimate_tasks (predecessor_task_id);
