-- Daily Progress Update by cost: what a day actually spent on each of a D
-- task's four cost components (the same ones its weight comes from —
-- lib/cost-estimate/weights.ts). A task's % complete is its cost to date
-- over its planned cost — the cost-to-cost (percentage-of-completion)
-- method — see computeProgressBreakdown, lib/task-progress/calculate.ts.
--
-- Automatic progress: a past working day with no entry counts its
-- planned share (planned cost / working days) on its own; saving a day's
-- entry overrides that day with what's typed. Today's form starts from
-- that same planned share.
--
-- labor_headcount and percent_complete_override (0040/0049) are no
-- longer written or read — left in place, harmless.
--
-- Run this AFTER 0056_category_equipment_other.sql.

alter table public.task_progress_entries
  add column if not exists labor_cost numeric not null default 0 check (labor_cost >= 0),
  add column if not exists material_cost numeric not null default 0 check (material_cost >= 0),
  add column if not exists equipment_cost numeric not null default 0 check (equipment_cost >= 0),
  add column if not exists other_cost numeric not null default 0 check (other_cost >= 0);

alter table public.category_progress_entries
  add column if not exists labor_cost numeric not null default 0 check (labor_cost >= 0),
  add column if not exists material_cost numeric not null default 0 check (material_cost >= 0),
  add column if not exists equipment_cost numeric not null default 0 check (equipment_cost >= 0),
  add column if not exists other_cost numeric not null default 0 check (other_cost >= 0);
