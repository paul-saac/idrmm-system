-- Intent: restore the missing material-request item/header foreign key from
-- migration 0017. Preserve all records, existing indexes, and access policies.
-- Audit/history and backup-control tables intentionally remain independent.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
-- Fail instead of overlooking records through row-level security.
set local row_security = off;

do $$
declare
  item_key smallint;
  request_key smallint;
  existing_fk text;
begin
  -- Use the same maintenance lock as the backup worker. Do not race recovery.
  if not pg_try_advisory_xact_lock_shared(18244, 7291) then
    raise exception 'Relationship repair cancelled: backup or restore is running.';
  end if;
  if exists (select 1 from public.system_backup_state
             where singleton and (maintenance or recovery_required)) then
    raise exception 'Relationship repair cancelled: backup recovery needs attention.';
  end if;

  -- Prevent concurrent changes between checking the records and adding the FK.
  lock table public.material_requests, public.material_request_items
    in share row exclusive mode;

  select attnum into item_key from pg_attribute
    where attrelid = 'public.material_request_items'::regclass
      and attname = 'material_request_id' and not attisdropped
      and atttypid = 'bigint'::regtype and attnotnull;
  select attnum into request_key from pg_attribute
    where attrelid = 'public.material_requests'::regclass
      and attname = 'id' and not attisdropped
      and atttypid = 'bigint'::regtype and attnotnull;
  if item_key is null or request_key is null then
    raise exception 'Relationship repair cancelled: unexpected request ID column types or nullability.';
  end if;

  if exists (
    select 1 from public.material_request_items i
    where not exists (
      select 1 from public.material_requests r where r.id = i.material_request_id
    )
  ) then
    raise exception 'Relationship repair cancelled: orphaned items need review. No records were deleted.';
  end if;

  -- Accept an equivalent existing FK regardless of its name; never replace an
  -- unexpected relationship or create a redundant second constraint.
  if exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.material_request_items'::regclass
      and c.contype = 'f' and item_key = any(c.conkey)
      and not (c.conkey = array[item_key]
        and c.confrelid = 'public.material_requests'::regclass
        and c.confkey = array[request_key] and c.confdeltype = 'c'
        and c.confupdtype = 'a' and not c.condeferrable)
  ) then
    raise exception 'Relationship repair cancelled: a conflicting request-item foreign key already exists.';
  end if;

  select c.conname into existing_fk from pg_constraint c
    where c.conrelid = 'public.material_request_items'::regclass
      and c.contype = 'f' and c.conkey = array[item_key]
      and c.confrelid = 'public.material_requests'::regclass
      and c.confkey = array[request_key];
  if existing_fk is null then
    alter table public.material_request_items
      add constraint material_request_items_material_request_id_fkey
      foreign key (material_request_id) references public.material_requests(id)
      on delete cascade not valid;
    existing_fk := 'material_request_items_material_request_id_fkey';
  end if;
  execute format('alter table public.material_request_items validate constraint %I', existing_fk);
end;
$$;

notify pgrst, 'reload schema';
commit;
