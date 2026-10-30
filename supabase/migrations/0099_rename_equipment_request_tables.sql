-- Intent: align the equipment request tables with the current UI terminology.
-- Rename existing relations without copying/deleting rows or resetting IDs.
-- Run with the matching application release stopped, then restart that release.
-- Do not rename unrelated tables or rewrite older migrations.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  old_names constant text[] := array['equipment_requisitions', 'equipment_requisition_items'];
  new_names constant text[] := array['equipment_requests', 'equipment_request_items'];
  source_rel regclass;
  target_rel regclass;
  relations regclass[] := array[]::regclass[];
  i integer;
  required_column text;
begin
  -- Check both names before changing either table. The earlier scaffolded
  -- equipment_requests table must not be mistaken for the current request flow.
  for i in 1..2 loop
    source_rel := to_regclass(format('public.%I', old_names[i]));
    target_rel := to_regclass(format('public.%I', new_names[i]));
    if source_rel is not null and target_rel is not null then
      raise exception 'Rename cancelled: both public.% and public.% exist.', old_names[i], new_names[i];
    end if;
    if source_rel is null and target_rel is null then
      raise exception 'Rename cancelled: neither public.% nor public.% exists.', old_names[i], new_names[i];
    end if;
    relations := array_append(relations, coalesce(source_rel, target_rel));
    if not exists (select 1 from pg_class where oid = relations[i] and relkind = 'r') then
      raise exception 'Rename cancelled: % is not an ordinary table.', relations[i];
    end if;
    execute format('lock table %s in access exclusive mode', relations[i]);
  end loop;

  foreach required_column in array array['id', 'project_id', 'er_no', 'requested_by', 'status', 'approved_by'] loop
    if not exists (select 1 from pg_attribute where attrelid = relations[1] and attname = required_column and not attisdropped) then
      raise exception 'Rename cancelled: request table is missing column %.', required_column;
    end if;
  end loop;
  foreach required_column in array array['id', 'equipment_request_id', 'equipment_name', 'quantity_needed', 'quantity_fulfilled'] loop
    if not exists (select 1 from pg_attribute where attrelid = relations[2] and attname = required_column and not attisdropped) then
      raise exception 'Rename cancelled: request items table is missing column %.', required_column;
    end if;
  end loop;

  if not exists (
    select 1 from pg_constraint c
    where c.contype = 'f' and c.conrelid = relations[2] and c.confrelid = relations[1]
      and c.conkey = array[(select attnum from pg_attribute where attrelid = relations[2] and attname = 'equipment_request_id' and not attisdropped)]::smallint[]
      and c.confkey = array[(select attnum from pg_attribute where attrelid = relations[1] and attname = 'id' and not attisdropped)]::smallint[]
      and c.confdeltype = 'c' and c.convalidated
  ) then
    raise exception 'Rename cancelled: the validated request/item foreign key is missing or differs from the audited schema.';
  end if;

  if to_regprocedure('public.is_equipment_requisition_foreman(bigint)') is null then
    raise exception 'Rename cancelled: the expected request permission helper is missing.';
  end if;

  -- Only the audited helper is rewritten below. Unexpected stored references
  -- require review rather than silently rewriting arbitrary function bodies.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema')
      and n.nspname !~ '^pg_toast' and p.prokind in ('f', 'p')
      and p.oid <> 'public.is_equipment_requisition_foreman(bigint)'::regprocedure
      and p.prosrc ~ '\m(equipment_requisitions|equipment_requisition_items)\M'
  ) then
    raise exception 'Rename cancelled: another stored function references the old table names. Review it first.';
  end if;

  for i in 1..2 loop
    if to_regclass(format('public.%I', old_names[i])) is not null then
      execute format('alter table public.%I rename to %I', old_names[i], new_names[i]);
    end if;
  end loop;
end;
$$;

-- Preserve this function's identity, existing grants and RLS dependencies.
-- Only its table reference changes; authorization remains identical.
create or replace function public.is_equipment_requisition_foreman(p_request_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.equipment_requests r
    where r.id = p_request_id and public.is_project_foreman(r.project_id)
  );
$$;

notify pgrst, 'reload schema';

commit;

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('equipment_requests', 'equipment_request_items')
order by table_name;
