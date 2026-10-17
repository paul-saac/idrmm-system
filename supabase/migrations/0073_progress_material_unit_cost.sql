-- ============================================================================ dd
-- A unit cost for a material used that isn't on the task's (or task-less
-- phase's) own Material Breakdown lines — logged in the progress window's
-- Materials used today as a material "not on the list". A planned line is
-- priced from the estimate, so it keeps no unit cost here (null); an
-- unplanned one has nothing to price it from, so its unit cost is typed
-- and kept with it — its cost is quantity_used × unit_cost. It counts in
-- the day's material cost (real spend), but not toward % complete.
--
-- Run this AFTER 0072_estimate_category_milestone.sql.
-- ============================================================================

alter table public.task_progress_material_entries
  add column if not exists unit_cost numeric(14, 2)
    check (unit_cost is null or unit_cost >= 0);

alter table public.category_progress_material_entries
  add column if not exists unit_cost numeric(14, 2)
    check (unit_cost is null or unit_cost >= 0);
