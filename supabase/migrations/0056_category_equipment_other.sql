-- Equipment and Other cost for a category's own direct line — the same D
-- two cost components every task already has (equipment_estimate /
-- other_cost_estimate), one level up, so a standalone category like
-- MOBILIZATION can carry all four (labor, material, equipment, other).
-- Edited from the Weight Breakdown panel. Counted into the category's
-- Total Estimated Cost, the project total, and so its weight
-- (lib/cost-estimate/weights.ts) — same as category_material_estimate
-- (0042) and category_labor_estimate (0047).
--
-- Run this AFTER 0055_project_events.sql.

alter table public.estimate_categories
  add column if not exists category_equipment_estimate numeric not null default 0
    check (category_equipment_estimate >= 0),
  add column if not exists category_other_estimate numeric not null default 0
    check (category_other_estimate >= 0);
