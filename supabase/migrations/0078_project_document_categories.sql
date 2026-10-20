-- Intent: categorize existing sheets as construction drawings and support signed  DD
-- BOMs, estimates, specifications, and supporting project documents in the same register.
begin;
alter table public.project_sheets add column if not exists document_type text not null default 'drawing';
alter table public.project_sheets drop constraint if exists project_sheets_document_type_check;
alter table public.project_sheets add constraint project_sheets_document_type_check
  check(document_type in ('drawing','bom','cost_estimate','specifications','other'));
alter table public.project_sheets drop constraint if exists project_sheets_as_built_type_check;
alter table public.project_sheets add constraint project_sheets_as_built_type_check
  check(stage <> 'as_built' or document_type = 'drawing');
create or replace function public.guard_document_category()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Runs after guard_project_sheet, which serializes the document's revision series.
  if exists(select 1 from public.project_sheets s where s.project_id=new.project_id
    and s.sheet_number=new.sheet_number and s.document_type<>new.document_type) then
    raise exception 'Use the same document category for every revision of this reference number';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_document_category() from public;
drop trigger if exists z_guard_document_category on public.project_sheets;
create trigger z_guard_document_category before insert on public.project_sheets
  for each row execute function public.guard_document_category();
commit;
