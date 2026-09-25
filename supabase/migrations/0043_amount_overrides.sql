-- Lets a BOM line's Amount be typed directly with no quantity/unit cost
-- breakdown at all (a lump-sum permit fee, a negotiated flat price —
-- nothing to multiply out) without silently forcing quantity to 1 the
-- way the Material Breakdown modal's own first pass at this did. That
-- approach reused the existing quantity * unit cost storage by writing
-- quantity = 1 behind the scenes, which technically round-tripped
-- through the existing material_estimate/category_material_estimate
-- computation, but visibly (and confusingly) filled in a "1" the user
-- never typed. This migration adds real, separate storage instead:
-- nullable — null means "no override, compute quantity * unit cost as
-- normal"; a non-null value means "use this instead," with quantity and
-- unit cost left exactly as the user typed them (usually still blank).
--
-- Run this AFTER 0042_category_direct_cost.sql.

alter table public.estimate_categories
  add column if not exists material_direct_amount numeric;

alter table public.estimate_tasks
  add column if not exists material_direct_amount numeric;

alter table public.estimate_task_material_assignments
  add column if not exists amount numeric;
