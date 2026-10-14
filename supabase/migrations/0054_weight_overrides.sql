-- Weight is automatic again: a task's (or task-less category's) share of DONEEEEEEEEEEE
-- the project's total estimated cost — the DPWH S-curve method. Computed
-- live when the cost estimate is read (lib/cost-estimate/weights.ts),
-- never stored, so it follows every cost change on its own.
--
-- weight_override is the PM's manual weight for one task (or task-less
-- category) when cost doesn't reflect its effort. Null means automatic.
-- The automatic ones share whatever the manual ones leave of 100%, by
-- cost.
--
-- The old weight columns are left in place but no longer read or
-- written — every existing weight becomes automatic again.
--
-- Run this AFTER 0053_project_holidays.sql.

alter table public.estimate_tasks
  add column if not exists weight_override numeric
    check (weight_override is null or (weight_override >= 0 and weight_override <= 100));

alter table public.estimate_categories
  add column if not exists weight_override numeric
    check (weight_override is null or (weight_override >= 0 and weight_override <= 100));
