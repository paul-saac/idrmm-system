-- Intent: remove only empty tables from the retired Daily Logs workflow and
-- three superseded planning/material-usage structures. Preserve all active
-- workflows, including equipment/material requests, progress entries and Auth.
-- Run against the database used by the cleaned application version only.
-- No rows are deleted; any non-empty target aborts the entire transaction.
-- RESTRICT prevents dropping an unexpected dependent object automatically.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- Fail rather than let an RLS-filtered count mistake a populated table for empty.
set local row_security = off;

do $$
declare
  retired_tables constant text[] := array[
    'category_progress_material_usage',
    'daily_log_entry_flags',
    'daily_log_equipment_acquisition',
    'daily_log_expense_items',
    'daily_log_labor_items',
    'daily_log_material_procurement',
    'daily_log_material_procurement_items',
    'daily_log_material_usage_items',
    'daily_log_survey_answers',
    'daily_log_survey_questions',
    'daily_log_work_items',
    'daily_logs',
    'estimate_task_labor_assignments',
    'task_progress_material_usage'
  ];
  target_name text;
  target_oid regclass;
  target_kind "char";
  row_count bigint;
  populated_tables text[] := array[]::text[];
  referencing_functions text[];
begin
  -- Lock every existing target before checking contents. A concurrent writer
  -- cannot add data between the empty-table check and the DROP statements.
  foreach target_name in array retired_tables loop
    target_oid := to_regclass(format('public.%I', target_name));
    if target_oid is null then
      continue;
    end if;

    select relkind into target_kind from pg_class where oid = target_oid;
    if target_kind not in ('r', 'p') then
      raise exception 'Cleanup cancelled: public.% is not an ordinary or partitioned table.', target_name;
    end if;

    execute format('lock table %s in access exclusive mode', target_oid);
  end loop;

  foreach target_name in array retired_tables loop
    target_oid := to_regclass(format('public.%I', target_name));
    if target_oid is null then
      continue;
    end if;

    execute format('select count(*) from %s', target_oid) into row_count;
    if row_count > 0 then
      populated_tables := array_append(
        populated_tables, format('%I (%s rows)', target_name, row_count)
      );
    end if;
  end loop;

  if cardinality(populated_tables) > 0 then
    raise exception 'Cleanup cancelled. These tables still contain records: %. No tables were removed.',
      array_to_string(populated_tables, ', ');
  end if;

  -- PostgreSQL does not track every dependency expressed as function-body
  -- text. Conservatively stop on literal references as well as RESTRICT's
  -- normal dependency checks. Dynamic SQL/external clients still need review.
  select array_agg(distinct p.oid::regprocedure::text)
    into referencing_functions
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('pg_catalog', 'information_schema')
    and n.nspname !~ '^pg_toast'
    and p.prokind in ('f', 'p')
    and exists (
      select 1 from unnest(retired_tables) as t(table_name)
      where p.prosrc ~ ('\m' || t.table_name || '\M')
    );

  if referencing_functions is not null then
    raise exception 'Cleanup cancelled. Stored functions mention retired tables: %.',
      array_to_string(referencing_functions, ', ');
  end if;
end;
$$;

-- One statement allows dependencies BETWEEN these retired tables to be
-- removed together. Dependencies from retained objects still block the drop.
drop table if exists
  public.category_progress_material_usage,
  public.daily_log_entry_flags,
  public.daily_log_equipment_acquisition,
  public.daily_log_expense_items,
  public.daily_log_labor_items,
  public.daily_log_material_procurement,
  public.daily_log_material_procurement_items,
  public.daily_log_material_usage_items,
  public.daily_log_survey_answers,
  public.daily_log_survey_questions,
  public.daily_log_work_items,
  public.daily_logs,
  public.estimate_task_labor_assignments,
  public.task_progress_material_usage
restrict;

notify pgrst, 'reload schema';

commit;

-- Expected from the supplied 59-table inventory: 45 public tables remain
-- and remaining_retired_tables = 0. A changed inventory can change the total.
select
  count(*) as public_table_count,
  count(*) filter (
    where table_name like 'daily_log%'
       or table_name in (
         'category_progress_material_usage',
         'estimate_task_labor_assignments',
         'task_progress_material_usage'
       )
  ) as remaining_retired_tables
from information_schema.tables
where table_schema = 'public'
  and table_type = 'BASE TABLE';
