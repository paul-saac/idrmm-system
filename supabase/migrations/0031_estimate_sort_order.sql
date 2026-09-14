-- ============================================================================
-- Manual drag-to-reorder for the Gantt Chart Schedule's task list: a
-- category's own position among other categories, and a task's position
-- among its own category's other tasks. Neither table had any ordering
-- concept before this — every list was just implicit creation order (the
-- query's `order by id`), which is why there was nothing to drag.
--
-- sort_order is a plain 0-based position within its scope (project for
-- categories, category for tasks) — not a global row id, not a gap-based
-- scheme. A reorder rewrites every affected row's sort_order in one go
-- (see reorderCategories/reorderTasks in lib/cost-estimate/actions.ts),
-- so there's no need for fractional/gap values to "insert between".
--
-- Backfilled from existing `id` order so current lists don't visibly
-- reshuffle the moment this ships.
-- ============================================================================

alter table public.estimate_categories add column if not exists sort_order integer not null default 0;
alter table public.estimate_tasks add column if not exists sort_order integer not null default 0;

with ordered as (
  select id, row_number() over (partition by project_id order by id) - 1 as rn
  from public.estimate_categories
)
update public.estimate_categories c
set sort_order = ordered.rn
from ordered
where c.id = ordered.id;

with ordered as (
  select id, row_number() over (partition by category_id order by id) - 1 as rn
  from public.estimate_tasks
)
update public.estimate_tasks t
set sort_order = ordered.rn
from ordered
where t.id = ordered.id;
