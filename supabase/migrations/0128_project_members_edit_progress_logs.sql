-- Intent: allow project editors (including Project Managers and Foremen) to
-- correct saved logs, while only Administrators can delete a daily log.
-- Preserve the transactional editor, original author, audit trail and RLS.
begin;

do $$
declare
  definition text;
  old_guard text := 'coalesce(public.get_my_role()::text,'''') not in (''admin'',''super_admin'')';
  new_guard text := 'coalesce(public.get_my_role()::text,'''') not in (''admin'',''super_admin'',''project_manager'',''foreman'')';
begin
  definition := pg_get_functiondef('public.edit_saved_progress_log(bigint,text,bigint,bigint,jsonb)'::regprocedure);
  if strpos(definition,old_guard)=0 and strpos(definition,new_guard)=0 then
    raise exception 'Unexpected saved-log editor definition. Review migration 0127 before proceeding.';
  end if;
  definition := replace(definition,old_guard,new_guard);
  definition := replace(definition,'Only project administrators can edit saved log history.','Project edit permission is required to correct saved logs.');
  execute definition;
end $$;

-- Child resource rows must still be replaceable during an edit. Restrict
-- deletion of the parent daily record only, in addition to project/session RLS.
drop policy if exists "Only administrators can delete daily logs" on public.task_progress_entries;
create policy "Only administrators can delete daily logs" on public.task_progress_entries
  as restrictive for delete to authenticated
  using (coalesce(public.get_my_role()::text,'') in ('admin','super_admin'));

drop policy if exists "Only administrators can delete daily logs" on public.category_progress_entries;
create policy "Only administrators can delete daily logs" on public.category_progress_entries
  as restrictive for delete to authenticated
  using (coalesce(public.get_my_role()::text,'') in ('admin','super_admin'));

notify pgrst,'reload schema';
commit;
