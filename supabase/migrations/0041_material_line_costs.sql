-- Per-line material costing for the Cost Estimate Breakdown's own
-- Material Breakdown modal (components/projects/cost-estimate/
-- material-breakdown-modal-content.tsx) — per an explicit request to
-- match a real Bill of Materials document, where every line (a task's
-- own direct quantity, and each material underneath it) carries its own
-- Quantity/Unit/Unit Cost/Amount, not just a lump-sum total.
--
-- Two additions:
--
-- 1. estimate_tasks gets its own "direct" quantity/unit/unit cost — for
--    a simple task with no material breakdown at all (e.g. "Mobilization"
--    in a real BOM: a lump-sum line with its own qty/unit/cost, nothing
--    underneath it). Deliberately NOT reusing the existing
--    estimated_quantity/unit columns on this same table — those already
--    have a real, separate job (Automatic Progress Completion's own
--    percent-complete denominator, see lib/task-progress/calculate.ts)
--    entered from a different screen; editing a task's *material*
--    quantity from this modal must never silently change what its
--    progress percentage is computed against.
--
-- 2. estimate_task_material_assignments gets its own unit_cost — each
--    material line's Amount is quantity * unit_cost, computed in the
--    application layer (not a generated column here, to keep this in
--    step with how every other derived total in this app already works
--    — see estimate_tasks.total_estimate_cost's own convention).
--
-- estimate_tasks.material_estimate (and total_estimate_cost) stay
-- stored columns, not computed at read time — updateTaskMaterialAssignments
-- (lib/cost-estimate/actions.ts) now recomputes and writes both in the
-- same round trip a material list is saved, exactly the way every other
-- cost column on this table has always been kept in sync.
alter table public.estimate_tasks
  add column if not exists material_direct_quantity numeric not null default 0,
  add column if not exists material_direct_unit text,
  add column if not exists material_unit_cost numeric not null default 0;

alter table public.estimate_task_material_assignments
  add column if not exists unit_cost numeric not null default 0;
