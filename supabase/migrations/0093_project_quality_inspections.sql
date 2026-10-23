-- Intent: record project quality inspections, test results, external sign-offs, DD
-- and linked evidence so QA reports contain only supplied inspection records.
begin;

create table if not exists public.project_quality_inspections (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects(id) on delete cascade,
  inspection_type text not null check (inspection_type in ('architectural','structural','electrical','plumbing','mechanical','fire_safety','materials','other')),
  related_work_key text not null default '' check (length(related_work_key) <= 80),
  related_work_name text not null default '' check (length(related_work_name) <= 200),
  area text not null check (length(trim(area)) between 1 and 200),
  inspected_on date not null,
  inspector_name text not null check (length(trim(inspector_name)) between 1 and 200),
  inspector_role text not null default '' check (length(inspector_role) <= 200),
  inspector_organization text not null default '' check (length(inspector_organization) <= 200),
  license_number text not null default '' check (length(license_number) <= 120),
  result text not null check (result in ('pending','passed','failed','conditional','reinspection_required')),
  remarks text not null default '' check (length(remarks) <= 5000),
  test_name text not null default '' check (length(test_name) <= 200),
  acceptance_criteria text not null default '' check (length(acceptance_criteria) <= 500),
  actual_result text not null default '' check (length(actual_result) <= 500),
  result_unit text not null default '' check (length(result_unit) <= 50),
  related_sheet_id bigint references public.project_sheets(id) on delete set null,
  recorded_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_quality_inspections_project_date
  on public.project_quality_inspections(project_id, inspected_on desc, id desc);

create or replace function public.stamp_project_quality_inspection()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.project_id <> old.project_id then
    raise exception 'An inspection cannot be moved to another project';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists stamp_project_quality_inspection on public.project_quality_inspections;
create trigger stamp_project_quality_inspection
  before update on public.project_quality_inspections
  for each row execute function public.stamp_project_quality_inspection();

alter table public.project_quality_inspections enable row level security;
grant select, insert, update on public.project_quality_inspections to authenticated;

drop policy if exists "Project members read quality inspections" on public.project_quality_inspections;
create policy "Project members read quality inspections" on public.project_quality_inspections
  for select to authenticated using (
    public.invitation_setup_complete() and (
      public.get_my_role() in ('admin','super_admin')
      or public.is_project_foreman(project_id)
      or exists (select 1 from public.projects p where p.id = project_id and p.project_manager_id = auth.uid())
    )
  );

drop policy if exists "Project members create quality inspections" on public.project_quality_inspections;
create policy "Project members create quality inspections" on public.project_quality_inspections
  for insert to authenticated with check (
    recorded_by = auth.uid() and public.invitation_setup_complete() and (
      public.get_my_role() in ('admin','super_admin')
      or public.is_project_foreman(project_id)
      or exists (select 1 from public.projects p where p.id = project_id and p.project_manager_id = auth.uid())
    )
  );

drop policy if exists "Project members update quality inspections" on public.project_quality_inspections;
create policy "Project members update quality inspections" on public.project_quality_inspections
  for update to authenticated using (
    public.invitation_setup_complete() and (
      public.get_my_role() in ('admin','super_admin')
      or public.is_project_foreman(project_id)
      or exists (select 1 from public.projects p where p.id = project_id and p.project_manager_id = auth.uid())
    )
  ) with check (
    public.invitation_setup_complete() and (
      public.get_my_role() in ('admin','super_admin')
      or public.is_project_foreman(project_id)
      or exists (select 1 from public.projects p where p.id = project_id and p.project_manager_id = auth.uid())
    )
  );

commit;
