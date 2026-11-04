-- Intent: derive equipment availability from unfinished task allocations only.
-- Close obsolete project-only checkouts while preserving their history.
begin;
create or replace function public._equipment_sync_allocations(p_equipment bigint)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare next_project bigint;
begin
 perform id from public.equipment where id=p_equipment and status not in ('maintenance','retired') for update;
 if not found then return;end if;
 -- Automatically close a project assignment only when it has allocations and
 -- every one is complete. Run deferred so an edit's intermediate rows never
 -- accidentally release equipment. Historical records are retained.
 update public.equipment_task_assignments t set released_at=greatest(now(),t.assigned_at),release_reason='returned'
 where t.released_at is null and (auth.uid() is null or public.project_access_level(t.project_id)='edit')
 and exists(select 1 from public.equipment_assignments a where a.id=t.equipment_assignment_id and a.equipment_id=p_equipment)
 and public._equipment_work_complete(t.project_id,case when t.task_id is not null then 'task-'||t.task_id else 'category-'||t.category_id end);
 update public.equipment_assignments a set returned_at=greatest(now(),a.assigned_at)
 where a.equipment_id=p_equipment and a.returned_at is null
 and (auth.uid() is null or public.project_access_level(a.project_id)='edit')
 and not exists(select 1 from public.equipment_task_plans ep where ep.equipment_id=p_equipment and ep.project_id=a.project_id
   and not public._equipment_work_complete(ep.project_id,ep.item_key));
 select ep.project_id into next_project from public.equipment_task_plans ep join public.projects p on p.id=ep.project_id
 where ep.equipment_id=p_equipment and p.archived_at is null and not public._equipment_work_complete(ep.project_id,ep.item_key)
 order by ep.project_id,ep.item_key limit 1;
 update public.equipment set status=case when next_project is null then 'available' else 'assigned' end,current_project_id=next_project,
  last_returned_at=case when next_project is null then coalesce((select max(returned_at) from public.equipment_assignments where equipment_id=p_equipment),last_returned_at) else last_returned_at end
 where id=p_equipment and (status,current_project_id) is distinct from (case when next_project is null then 'available' else 'assigned' end,next_project);
end $$;


notify pgrst,'reload schema';
commit;
