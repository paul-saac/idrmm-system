-- ============================================================================
-- Undoes 0031_estimate_sort_order.sql — the drag-to-reorder feature it
-- supported was built, then decided against and removed from the app
-- (no code reads or writes sort_order anymore). Rather than editing
-- 0031 itself (already applied to the live database by the time this
-- was written), this drops what it added, keeping migrations
-- append-only/forward-only like every other one in this folder.
--
-- Safe to run even if 0031 was never applied: `drop column if exists`.
-- ============================================================================

alter table public.estimate_categories drop column if exists sort_order;
alter table public.estimate_tasks drop column if exists sort_order;
