-- Gives a category (phase) its own priority, same reasoning as
-- 0035_estimate_task_priority_and_assignments.sql one level up — a
-- phase-wide priority (e.g. "MOBILIZATION" as a standalone item with no
-- tasks yet) is just as meaningful as a task's own, and shouldn't be
-- unset just because there's nothing under it to roll one up from.
--
-- Deliberately not a rollup of its tasks' own priorities (unlike Start/
-- End, which genuinely IS a rollup once a category has tasks) — a
-- category's own priority is always independently, directly set, the
-- same way categoryMaterialEstimate/assigned workers already are.
--
-- Run this AFTER 0045_category_worker_assignments.sql.

alter table public.estimate_categories
  add column if not exists priority text not null default 'medium';
