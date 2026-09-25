-- DONE
-- mirroring estimate_tasks' own material_direct_quantity/
-- material_direct_unit/material_unit_cost (0041_material_line_costs.sql)
-- one level up — for a category with no tasks yet (or a category-level
-- lump sum), same reasoning a standalone task (e.g. "Mobilization") uses
-- its own direct line instead of a material breakdown underneath it. See
-- MaterialBreakdownModalContent's own doc comment.
--
-- category_material_estimate is this line's own (quantity * unit cost)
-- only — stored, not computed at read time, kept in sync by
-- updateCategoryMaterialDirect (lib/cost-estimate/actions.ts) — and
-- folds into getCostEstimate's totalsByColumn.material/
-- totalEstimatedCost the same way a task's own materialEstimate does,
-- so a category's own line isn't invisible to the rest of the Cost
-- Estimate Breakdown. Unlike a task, a category has no material
-- assignment rows of its own to roll up here — the Material Breakdown
-- modal's own category-row Amount cell adds this to the live sum of the
-- category's tasks for display, but that combined figure is never
-- itself stored.
--
-- Run this AFTER 0041_material_line_costs.sql.

alter table public.estimate_categories
  add column if not exists material_direct_quantity numeric not null default 0,
  add column if not exists material_direct_unit text,
  add column if not exists material_unit_cost numeric not null default 0,
  add column if not exists category_material_estimate numeric not null default 0;
