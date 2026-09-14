-- ============================================================================
-- Fixes "Could not delete project" for any project that actually has
-- Work Log or Material Usage entries against it.
--
-- Deleting a project cascades to estimate_categories, estimate_tasks,
-- and project_materials (all `on delete cascade` from projects) in the
-- same statement as it cascades to daily_logs -> daily_log_work_items /
-- daily_log_material_usage_items. Two child tables were given `on
-- delete restrict` instead of cascade against the tables they'd need to
-- outlive for that restriction to mean anything:
--   - daily_log_work_items.category_id / .task_id -> estimate_categories
--     / estimate_tasks (0010_daily_log_work_items.sql)
--   - daily_log_material_usage_items.project_material_id ->
--     project_materials (0015_daily_log_material_usage_items.sql)
--
-- A RESTRICT constraint is checked as each individual row delete
-- happens, not deferred until the whole cascading DELETE finishes. So
-- deleting an estimate_tasks/project_materials row fails with a
-- foreign-key violation as long as ANY row in these two tables still
-- references it at that point in the cascade — even though that same
-- row is also being deleted in the same statement via the daily_logs
-- cascade path. lib/projects/actions.ts's deleteProject only surfaces
-- this as the generic "Could not delete project. Please try again."
-- (the real Postgres error is logged server-side, not shown to the
-- user).
--
-- A Work Log / Material Usage entry only exists because its task/
-- category/material did; deleting the whole project makes all of them
-- meaningless together, so these should cascade like every other
-- daily_log_* child table already does, not restrict.
--
-- The old constraints are looked up and dropped by whatever name
-- Postgres actually gave them (rather than assumed by the usual
-- <table>_<column>_fkey auto-naming convention) — safer against a live
-- database than hardcoding a guessed name.
-- ============================================================================

do $$
declare
  r record;
begin
  for r in
    select con.conname, rel.relname as table_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_class frel on frel.oid = con.confrelid
    where con.contype = 'f'
      and rel.relname = 'daily_log_work_items'
      and frel.relname in ('estimate_categories', 'estimate_tasks')
  loop
    execute format('alter table public.%I drop constraint %I', r.table_name, r.conname);
  end loop;

  for r in
    select con.conname, rel.relname as table_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_class frel on frel.oid = con.confrelid
    where con.contype = 'f'
      and rel.relname = 'daily_log_material_usage_items'
      and frel.relname = 'project_materials'
  loop
    execute format('alter table public.%I drop constraint %I', r.table_name, r.conname);
  end loop;
end $$;

alter table public.daily_log_work_items
  add constraint daily_log_work_items_category_id_fkey
  foreign key (category_id) references public.estimate_categories (id) on delete cascade;

alter table public.daily_log_work_items
  add constraint daily_log_work_items_task_id_fkey
  foreign key (task_id) references public.estimate_tasks (id) on delete cascade;

alter table public.daily_log_material_usage_items
  add constraint daily_log_material_usage_items_project_material_id_fkey
  foreign key (project_material_id) references public.project_materials (id) on delete cascade;
