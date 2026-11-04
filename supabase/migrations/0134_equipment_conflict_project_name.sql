-- Intent: include the conflicting task's project name in equipment warnings.
-- Project names, task names, and dates remain masked without project access.
begin;
create or replace function public._equipment_allocation_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare own_start date;own_end date;other record; asset_name text;visible boolean;
begin
 perform id from public.equipment where id=new.equipment_id for update;
 select name into asset_name from public.equipment where id=new.equipment_id;
 if exists(select 1 from public.equipment_task_plans where project_id=new.project_id and item_key=new.item_key and equipment_id=new.equipment_id) then return new;end if;
 if exists(select 1 from public.equipment where id=new.equipment_id and status in ('maintenance','retired')) then
  raise exception 'Equipment under maintenance or retired cannot be newly allocated.' using errcode='22023';end if;
 -- Completed allocations are historical and do not reserve future use.
 if public._equipment_work_complete(new.project_id,new.item_key) then return new;end if;
 select start_date,end_date into own_start,own_end from (
  select t.planned_start_date start_date,t.planned_end_date end_date from public.estimate_tasks t where t.project_id=new.project_id and 'task-'||t.id=new.item_key
  union all select c.planned_start_date,c.planned_end_date from public.estimate_categories c where c.project_id=new.project_id and 'category-'||c.id=new.item_key
 ) ranges;
 if own_start is null or own_end is null or own_end<own_start then raise exception 'Set valid task start and end dates before assigning equipment.' using errcode='22023';end if;
 for other in
  select ep.project_id,p.project_name,ep.item_key,w.name,w.start_date,w.end_date from public.equipment_task_plans ep join public.projects p on p.id=ep.project_id and p.archived_at is null
  cross join lateral (
   select t.task_name name,t.planned_start_date start_date,t.planned_end_date end_date from public.estimate_tasks t where t.project_id=ep.project_id and 'task-'||t.id=ep.item_key
   union all select c.category_name,c.planned_start_date,c.planned_end_date from public.estimate_categories c where c.project_id=ep.project_id and 'category-'||c.id=ep.item_key
  ) w
  where ep.equipment_id=new.equipment_id and (ep.project_id,ep.item_key)<>(new.project_id,new.item_key)
   and not public._equipment_work_complete(ep.project_id,ep.item_key)
   and (w.start_date is null or w.end_date is null or (w.start_date<=own_end and w.end_date>=own_start))
  order by ep.project_id,ep.item_key
 loop
  visible:=coalesce(public.project_access_level(other.project_id) in ('view','edit'),false);
  raise exception '% is already assigned to overlapping unfinished work.',asset_name using errcode='P0001',
   detail=jsonb_build_object('equipmentConflict',true,'equipment',asset_name,
    'projectName',case when visible then other.project_name end,
    'task',case when visible then other.name else 'A task in another project' end,
    'startDate',case when visible then other.start_date end,'endDate',case when visible then other.end_date end)::text;
 end loop;
 return new;
end $$;
revoke all on function public._equipment_allocation_guard() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
