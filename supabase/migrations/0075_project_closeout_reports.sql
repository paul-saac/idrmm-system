-- Intent: persist closeout narratives and explicitly recorded milestone dates.
-- Project costs/progress remain live reads from the existing workspace sources.
-- These records document a review; they do not approve or close a project.
create table if not exists public.project_closeout_reports (
  project_id bigint primary key references public.projects(id) on delete cascade,
  notes jsonb not null default '{}'::jsonb check (jsonb_typeof(notes) = 'object'),
  milestone_dates jsonb not null default '{}'::jsonb check (jsonb_typeof(milestone_dates) = 'object'),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.project_closeout_reports enable row level security;
grant select, insert, update on public.project_closeout_reports to authenticated;
drop policy if exists "Admins manage project closeout reports"
  on public.project_closeout_reports;
create policy "Admins manage project closeout reports"
  on public.project_closeout_reports for all to authenticated
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');
drop policy if exists "Assigned foremen read project closeout reports"
  on public.project_closeout_reports;
create policy "Assigned foremen read project closeout reports"
  on public.project_closeout_reports for select to authenticated
  using (public.is_project_foreman(project_id));
drop policy if exists "Assigned foremen create project closeout reports"
  on public.project_closeout_reports;
create policy "Assigned foremen create project closeout reports"
  on public.project_closeout_reports for insert to authenticated
  with check (public.is_project_foreman(project_id));
drop policy if exists "Assigned foremen update project closeout reports"
  on public.project_closeout_reports;
create policy "Assigned foremen update project closeout reports"
  on public.project_closeout_reports for update to authenticated
  using (public.is_project_foreman(project_id))
  with check (public.is_project_foreman(project_id));

create or replace function public.stamp_project_closeout_report()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.project_id <> old.project_id then
      raise exception 'A closeout report cannot be moved to another project';
    end if;
    new.version := old.version + 1;
  else
    new.version := 1;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
drop trigger if exists stamp_project_closeout_report
  on public.project_closeout_reports;
create trigger stamp_project_closeout_report
  before insert or update on public.project_closeout_reports
  for each row execute function public.stamp_project_closeout_report();
