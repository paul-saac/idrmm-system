-- Intent: share only company equipment assignment metadata with active portal users.
-- Project/task records, costs, logs, documents and edit permissions remain project-scoped.
begin;
create or replace function public._equipment_work_started(p_project bigint,p_key text)
returns boolean language plpgsql stable set search_path=public,pg_temp as $$
declare
 r jsonb; prefix text; owner_column text; owner_id bigint;
 planned numeric; qty numeric; spent numeric; unplanned numeric; materials_complete boolean;
begin
 if p_key ~ '^task-[1-9][0-9]*$' then
  owner_id:=substring(p_key from 6)::bigint;
  select to_jsonb(t) into r from public.estimate_tasks t where t.id=owner_id and t.project_id=p_project;
  prefix:='task';owner_column:='task_id';
 elsif p_key ~ '^category-[1-9][0-9]*$' then
  owner_id:=substring(p_key from 10)::bigint;
  select to_jsonb(c) into r from public.estimate_categories c where c.id=owner_id and c.project_id=p_project;
  if exists(select 1 from public.estimate_tasks where category_id=owner_id and project_id=p_project) then
   return (select bool_or(public._equipment_work_started(p_project,'task-'||t.id)) from public.estimate_tasks t where t.category_id=owner_id and t.project_id=p_project);
  end if;
  prefix:='category';owner_column:='category_id';
 else return false;end if;
 if r is null then return false;end if;
 execute format('select coalesce(sum(quantity_completed),0),coalesce(sum(coalesce(labor_cost,0)+coalesce(material_cost,0)+coalesce(equipment_cost,0)+coalesce(other_cost,0)),0) from public.%I where %I=$1',prefix||'_progress_entries',owner_column)
  into qty,spent using owner_id;
 if coalesce((r->>'estimated_quantity')::numeric,0)>0 then return qty > 0;end if;
 planned:=case when prefix='task' then coalesce((r->>'labor_estimate')::numeric,0)+coalesce((r->>'material_estimate')::numeric,0)+coalesce((r->>'equipment_estimate')::numeric,0)+coalesce((r->>'other_cost_estimate')::numeric,0)
  else coalesce((r->>'category_labor_estimate')::numeric,0)+coalesce((r->>'category_material_estimate')::numeric,0)+coalesce((r->>'category_equipment_estimate')::numeric,0)+coalesce((r->>'category_other_estimate')::numeric,0) end;
 if planned>0 then
  execute format('select coalesce(sum(m.quantity_used*m.unit_cost),0) from public.%I m join public.%I e on e.id=m.progress_entry_id where e.%I=$1 and m.unit_cost is not null',prefix||'_progress_material_entries',prefix||'_progress_entries',owner_column)
   into unplanned using owner_id;
  return spent-unplanned>0;
 end if;
 execute format($q$
  with planned as (
   select lower(btrim(material_name)) name,lower(btrim(coalesce(unit,''))) unit,
    sum(planned_quantity) quantity,greatest(0,sum(coalesce(amount,planned_quantity*unit_cost))) value
   from public.%I where %I=$1 and btrim(material_name)<>'' group by 1,2 having sum(planned_quantity)>0
  ), used as (
   select lower(btrim(m.material_name)) name,lower(btrim(coalesce(m.unit,''))) unit,sum(m.quantity_used) quantity
   from public.%I m join public.%I e on e.id=m.progress_entry_id
   where e.%I=$1 and m.unit_cost is null group by 1,2
  ) select case when sum(p.value)>0 then sum(least(1,coalesce(u.quantity,0)/p.quantity)*p.value)>0
    else bool_or(coalesce(u.quantity,0)>0) end
    from planned p left join used u using(name,unit)
 $q$,'estimate_'||prefix||'_material_assignments',owner_column,prefix||'_progress_material_entries',prefix||'_progress_entries',owner_column)
 into materials_complete using owner_id;
 return coalesce(materials_complete,false);
end $$;

revoke all on function public._equipment_work_started(bigint,text) from public,anon,authenticated;
create or replace function public.equipment_catalog_assignment_summary()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or public.app_session_is_active() is not true
  or public.invitation_setup_complete() is not true
  or coalesce(public.get_my_role()::text,'') not in ('admin','super_admin','project_manager','foreman') then
  raise exception 'Not authorized to view equipment assignments.' using errcode='42501';
 end if;
 return coalesce((
 with work as (
  select t.project_id,'task-'||t.id item_key,t.task_name name,t.planned_start_date start_date,t.planned_end_date end_date,
   public._equipment_work_started(t.project_id,'task-'||t.id) started
  from public.estimate_tasks t
 ), categories as (
  select c.project_id,'category-'||c.id item_key,c.category_name name,
   case when exists(select 1 from work w where w.project_id=c.project_id and w.item_key in (select 'task-'||t.id from public.estimate_tasks t where t.category_id=c.id))
    then (select min(t.planned_start_date) from public.estimate_tasks t where t.category_id=c.id and t.project_id=c.project_id) else c.planned_start_date end start_date,
   case when exists(select 1 from public.estimate_tasks t where t.category_id=c.id and t.project_id=c.project_id)
    then (select max(t.planned_end_date) from public.estimate_tasks t where t.category_id=c.id and t.project_id=c.project_id) else c.planned_end_date end end_date,
   public._equipment_work_started(c.project_id,'category-'||c.id) started
  from public.estimate_categories c
 ), all_work as (select * from work union all select * from categories)
 select jsonb_agg(jsonb_build_object('equipmentId',ep.equipment_id,'projectId',p.id,'projectName',p.project_name,
  'itemKey',ep.item_key,'taskName',w.name,'kind','planned',
  'startDate',to_char(w.start_date::timestamptz at time zone 'Asia/Manila','YYYY-MM-DD'),
  'endDate',to_char(w.end_date::timestamptz at time zone 'Asia/Manila','YYYY-MM-DD'),
  'canViewProject',coalesce(public.project_access_level(p.id) in ('view','edit'),false),
  'useStatus',case when public._equipment_work_complete(p.id,ep.item_key) then 'completed'
    when w.started then 'ongoing'
    when w.start_date is not null and w.end_date>=w.start_date and (now() at time zone 'Asia/Manila')::date<w.start_date::date then 'upcoming'
    else 'planned' end) order by ep.equipment_id,p.id,ep.item_key)
 from public.equipment_task_plans ep join public.equipment asset on asset.id=ep.equipment_id and asset.status not in ('maintenance','retired')
 join public.projects p on p.id=ep.project_id and p.archived_at is null
 join all_work w on w.project_id=ep.project_id and w.item_key=ep.item_key
 ),'[]'::jsonb);
end $$;
revoke all on function public.equipment_catalog_assignment_summary() from public,anon;
grant execute on function public.equipment_catalog_assignment_summary() to authenticated;
notify pgrst,'reload schema';
commit;
