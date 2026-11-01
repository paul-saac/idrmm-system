-- Intent: enforce task/category project consistency and valid equipment-cost
-- array containers. Preserve all rows, cached totals, history and access rules.
-- Abort transactionally if existing records violate these invariants.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local row_security = off;

do $$
begin
  if not pg_try_advisory_xact_lock_shared(18244, 7291) then
    raise exception 'Estimate integrity update cancelled: backup or restore is running.';
  end if;
  if exists (select 1 from public.system_backup_state
             where singleton and (maintenance or recovery_required)) then
    raise exception 'Estimate integrity update cancelled: backup recovery needs attention.';
  end if;
end;
$$;

lock table public.estimate_categories, public.estimate_tasks
  in share row exclusive mode;

do $$
begin
  -- The referenced pair lets PostgreSQL enforce both owner and project in one FK.
  if not exists (select 1 from pg_constraint
    where conrelid = 'public.estimate_categories'::regclass
      and contype in ('p', 'u') and conkey = array[
        (select attnum from pg_attribute where attrelid = 'public.estimate_categories'::regclass and attname = 'id'),
        (select attnum from pg_attribute where attrelid = 'public.estimate_categories'::regclass and attname = 'project_id')
      ]::smallint[]) then
    alter table public.estimate_categories
      add constraint estimate_categories_id_project_key unique (id, project_id);
  end if;

  if not exists (select 1 from pg_constraint
    where conrelid = 'public.estimate_tasks'::regclass
      and conname = 'estimate_tasks_category_project_fkey') then
    alter table public.estimate_tasks
      add constraint estimate_tasks_category_project_fkey
      foreign key (category_id, project_id)
      references public.estimate_categories(id, project_id)
      on delete cascade not valid;
  elsif not exists (select 1 from pg_constraint
    where conrelid = 'public.estimate_tasks'::regclass
      and conname = 'estimate_tasks_category_project_fkey' and contype = 'f'
      and confrelid = 'public.estimate_categories'::regclass and confdeltype = 'c'
      and conkey = array[
        (select attnum from pg_attribute where attrelid = 'public.estimate_tasks'::regclass and attname = 'category_id'),
        (select attnum from pg_attribute where attrelid = 'public.estimate_tasks'::regclass and attname = 'project_id')
      ]::smallint[]
      and confkey = array[
        (select attnum from pg_attribute where attrelid = 'public.estimate_categories'::regclass and attname = 'id'),
        (select attnum from pg_attribute where attrelid = 'public.estimate_categories'::regclass and attname = 'project_id')
      ]::smallint[]) then
    raise exception 'Estimate integrity update cancelled: conflicting category/project constraint.';
  end if;

  if not exists (select 1 from pg_constraint
    where conrelid = 'public.estimate_categories'::regclass
      and conname = 'estimate_categories_equipment_cost_items_array') then
    alter table public.estimate_categories
      add constraint estimate_categories_equipment_cost_items_array
      check (jsonb_typeof(equipment_cost_items) = 'array') not valid;
  end if;
  if not exists (select 1 from pg_constraint
    where conrelid = 'public.estimate_tasks'::regclass
      and conname = 'estimate_tasks_equipment_cost_items_array') then
    alter table public.estimate_tasks
      add constraint estimate_tasks_equipment_cost_items_array
      check (jsonb_typeof(equipment_cost_items) = 'array') not valid;
  end if;
end;
$$;

alter table public.estimate_tasks validate constraint estimate_tasks_category_project_fkey;
alter table public.estimate_categories validate constraint estimate_categories_equipment_cost_items_array;
alter table public.estimate_tasks validate constraint estimate_tasks_equipment_cost_items_array;

-- The composite FK replaces the old single-column FK, preserving cascade
-- deletion without retaining a duplicate relationship for PostgREST to infer.
do $$
declare old_fk record;
begin
  for old_fk in select conname from pg_constraint
    where conrelid = 'public.estimate_tasks'::regclass and contype = 'f'
      and confrelid = 'public.estimate_categories'::regclass
      and conkey = array[(select attnum from pg_attribute
        where attrelid = 'public.estimate_tasks'::regclass and attname = 'category_id')]::smallint[]
      and confkey = array[(select attnum from pg_attribute
        where attrelid = 'public.estimate_categories'::regclass and attname = 'id')]::smallint[]
      and confdeltype = 'c'
  loop
    execute format('alter table public.estimate_tasks drop constraint %I', old_fk.conname);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
