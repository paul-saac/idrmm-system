-- Intent: protect newer dependency and AI insight tables during system backup/restore.
-- Install missing row/truncate guards without changing application records.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$
begin
 if not pg_try_advisory_xact_lock(18244,7291) then
  raise exception 'A backup operation is active. Retry after it finishes.';
 end if;
 if exists(select 1 from public.system_backup_state where maintenance or recovery_required) then
  raise exception 'Backup maintenance or recovery must finish before this repair.';
 end if;
end $$;
lock table public.estimate_dependencies,public.project_ai_insights in share row exclusive mode;
create or replace trigger a_system_backup_write_guard
 before insert or update or delete on public.estimate_dependencies
 for each row execute function public.system_backup_write_guard();
create or replace trigger a_system_backup_truncate_guard
 before truncate on public.estimate_dependencies
 for each statement execute function public.system_backup_write_guard();
create or replace trigger a_system_backup_write_guard
 before insert or update or delete on public.project_ai_insights
 for each row execute function public.system_backup_write_guard();
create or replace trigger a_system_backup_truncate_guard
 before truncate on public.project_ai_insights
 for each statement execute function public.system_backup_write_guard();
commit;
