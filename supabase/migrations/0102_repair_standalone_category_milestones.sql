-- Intent: ensure standalone main tasks can persist their milestone flag in
-- databases that missed migration 0072, and refresh the PostgREST schema cache.
-- Existing tasks, costs, progress and milestone values are preserved.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if exists (
    select 1 from pg_attribute
    where attrelid = 'public.estimate_categories'::regclass
      and attname = 'is_milestone' and not attisdropped
      and atttypid <> 'boolean'::regtype
  ) then
    raise exception 'estimate_categories.is_milestone has an unexpected type. No changes were made.';
  end if;
end;
$$;

alter table public.estimate_categories
  add column if not exists is_milestone boolean not null default false;

notify pgrst, 'reload schema';
commit;
