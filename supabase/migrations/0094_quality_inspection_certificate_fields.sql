-- Intent: identify the inspected system and the external authority/certificate
-- behind each quality inspection without treating project staff as technical approvers.
begin;

alter table public.project_quality_inspections
  add column if not exists inspection_scope text not null default '' check (length(inspection_scope) <= 300),
  add column if not exists authority_type text not null default 'third_party_inspector'
    check (authority_type in ('architect','engineer','testing_laboratory','local_authority','third_party_inspector')),
  add column if not exists certificate_number text not null default '' check (length(certificate_number) <= 150),
  add column if not exists issued_on date;

commit;
