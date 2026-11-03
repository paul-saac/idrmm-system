-- Intent: retain the latest successful project insights until explicitly refreshed.
-- Advisory snapshots only; never change schedules, actual work, costs or risk calculations.
begin;
create table if not exists public.project_ai_insights (
  project_id bigint primary key references public.projects(id) on delete cascade,
  analysis jsonb not null check(jsonb_typeof(analysis)='object'
    and jsonb_typeof(analysis->'summary')='string' and jsonb_typeof(analysis->'findings')='array'
    and analysis->>'projectId'=project_id::text),
  generated_by uuid references public.profiles(id) on delete set null,
  generated_at timestamptz not null default now()
);
alter table public.project_ai_insights enable row level security;
revoke all on public.project_ai_insights from anon,authenticated;
grant select,insert,update on public.project_ai_insights to authenticated;
drop policy if exists "Read project insights" on public.project_ai_insights;
create policy "Read project insights" on public.project_ai_insights for select to authenticated
using (public.app_session_is_active() and public.invitation_setup_complete() and public.project_access_level(project_id) in ('view','edit'));
drop policy if exists "Save project insights" on public.project_ai_insights;
create policy "Save project insights" on public.project_ai_insights for insert to authenticated
with check (generated_by=auth.uid() and public.app_session_is_active() and public.invitation_setup_complete() and public.project_access_level(project_id) in ('view','edit'));
drop policy if exists "Refresh project insights" on public.project_ai_insights;
create policy "Refresh project insights" on public.project_ai_insights for update to authenticated
using (public.app_session_is_active() and public.invitation_setup_complete() and public.project_access_level(project_id) in ('view','edit'))
with check (generated_by=auth.uid() and public.app_session_is_active() and public.invitation_setup_complete() and public.project_access_level(project_id) in ('view','edit'));
drop trigger if exists a_system_backup_write_guard on public.project_ai_insights;
create trigger a_system_backup_write_guard before insert or update or delete on public.project_ai_insights
for each row execute function public.system_backup_write_guard();
notify pgrst,'reload schema';
commit;
