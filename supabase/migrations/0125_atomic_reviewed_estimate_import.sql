-- Intent: save a reviewed AI draft and its resource lines in one transaction.
-- No existing project rows are changed by installing this migration.
begin;

create or replace function public._estimate_import_number(p_value text)
returns numeric language plpgsql immutable set search_path=public,pg_temp as $$
declare n numeric;
begin
 n:=coalesce(nullif(replace(btrim(p_value),',',''),''),'0')::numeric;
 if not(n>=0 and n<1e12) then raise exception 'Enter valid nonnegative draft costs and quantities.' using errcode='22023';end if;
 return n;
end $$;

create or replace function public.import_reviewed_estimate(p_project_id bigint,p_categories jsonb)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 c jsonb;o jsonb;l jsonb;tasks jsonb;materials jsonb;equipment jsonb;other_costs jsonb;
 category_id bigint;owner_id bigint;standalone boolean;start_date date;position bigint;
 material_total numeric;labor_total numeric;equipment_total numeric;other_total numeric;direct_material numeric;
 q numeric;rate numeric;amount numeric;direct_amount numeric;cost_type text;items jsonb;item_no integer;
begin
 if auth.uid() is null or public.app_session_is_active() is not true or public.invitation_setup_complete() is not true
   or public.project_access_level(p_project_id) is distinct from 'edit' then
   raise exception 'Project editing is not permitted.' using errcode='42501';end if;
 if public.system_backup_maintenance() then raise exception 'Saving is temporarily paused.' using errcode='55000';end if;
 if jsonb_typeof(p_categories) is distinct from 'array' or jsonb_array_length(p_categories)=0 then
   raise exception 'Add at least one named task.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('idrmm-gantt-project:'||p_project_id::text,0));
 select p.start_date into start_date from public.projects p where p.id=p_project_id for update;
 if not found or start_date is null or extract(year from start_date) not between 1980 and 2100 then
   raise exception 'Set a valid project start date before importing.' using errcode='22023';end if;
 -- Capture the pre-import state too, so the first import can be undone.
 perform public.gantt_history(p_project_id,'checkpoint');
 select coalesce(max(sort_order),0) into position from public.estimate_categories where project_id=p_project_id;
 for c in select value from jsonb_array_elements(p_categories) loop
   if nullif(btrim(c->>'name'),'') is null or jsonb_typeof(c->'tasks') is distinct from 'array' then
     raise exception 'Name each draft task and provide its subtasks.' using errcode='22023';end if;
   tasks:=c->'tasks';standalone:=jsonb_array_length(tasks)=0;position:=position+1;
   insert into public.estimate_categories(project_id,category_name,planned_start_date,planned_end_date,sort_order)
   values(p_project_id,btrim(c->>'name'),start_date,start_date,position) returning id into category_id;
   item_no:=0;
   for o in select c where standalone union all select value from jsonb_array_elements(tasks) loop
     if nullif(btrim(o->>'name'),'') is null then raise exception 'Name each draft task.' using errcode='22023';end if;
     if standalone then owner_id:=category_id;
     else
       item_no:=item_no+1;
       insert into public.estimate_tasks(project_id,category_id,task_name,planned_start_date,planned_end_date,estimated_quantity,unit,sort_order)
       values(p_project_id,category_id,btrim(o->>'name'),start_date,start_date,public._estimate_import_number(o->>'quantity'),nullif(btrim(o->>'unit'),''),item_no)
       returning id into owner_id;
     end if;
     materials:=coalesce(o->'materials','[]');equipment:=coalesce(o->'equipment','[]');other_costs:=coalesce(o->'otherCosts','[]');
     if jsonb_typeof(materials) is distinct from 'array' or jsonb_typeof(equipment) is distinct from 'array' or jsonb_typeof(other_costs) is distinct from 'array' then
       raise exception 'Provide valid draft resource lines.' using errcode='22023';end if;
     material_total:=0;equipment_total:=0;other_total:=0;items:='[]';
     labor_total:=public._estimate_import_number(o->>'laborEstimate');
     direct_amount:=public._estimate_import_number(o->>'amount');cost_type:=coalesce(o->>'amountType','material');direct_material:=0;
     if cost_type not in ('material','labor','equipment','other') then raise exception 'Choose a valid draft cost type.' using errcode='22023';end if;
     if cost_type='material' then direct_material:=direct_amount;material_total:=direct_amount;
     elsif cost_type='labor' then labor_total:=labor_total+direct_amount;
     elsif direct_amount>0 then
       if cost_type='equipment' then equipment:=equipment||jsonb_build_array(jsonb_build_object('name','Direct planned cost','amount',direct_amount));
       else other_costs:=other_costs||jsonb_build_array(jsonb_build_object('name','Direct planned cost','amount',direct_amount));end if;
     end if;
     for l in select value from jsonb_array_elements(materials) loop
       if nullif(btrim(l->>'name'),'') is null then raise exception 'Name each draft material.' using errcode='22023';end if;
       q:=public._estimate_import_number(l->>'quantity');rate:=public._estimate_import_number(l->>'unitCost');
       amount:=case when nullif(btrim(l->>'amount'),'') is null then null else public._estimate_import_number(l->>'amount') end;
       material_total:=material_total+coalesce(amount,q*rate);
       if standalone then
         insert into public.estimate_category_material_assignments(category_id,material_name,planned_quantity,unit,unit_cost,amount)
         values(owner_id,btrim(l->>'name'),q,nullif(btrim(l->>'unit'),''),rate,amount);
       else
         insert into public.estimate_task_material_assignments(task_id,material_name,planned_quantity,unit,unit_cost,amount)
         values(owner_id,btrim(l->>'name'),q,nullif(btrim(l->>'unit'),''),rate,amount);
       end if;
     end loop;
     for l in select value from jsonb_array_elements(other_costs) loop
       if nullif(btrim(l->>'name'),'') is null or length(l->>'name')>200 then raise exception 'Name each other cost (up to 200 characters).' using errcode='22023';end if;
       amount:=public._estimate_import_number(l->>'amount');other_total:=other_total+amount;
       insert into public.estimate_task_other_costs(task_id,category_id,cost_name,amount,amount_override)
       values(case when not standalone then owner_id end,case when standalone then owner_id end,btrim(l->>'name'),amount,amount);
     end loop;
     for l in select value from jsonb_array_elements(equipment) loop
       if nullif(btrim(l->>'name'),'') is null or length(l->>'name')>200 then raise exception 'Name each equipment cost (up to 200 characters).' using errcode='22023';end if;
       amount:=round(public._estimate_import_number(l->>'amount'),2);equipment_total:=equipment_total+amount;
       items:=items||jsonb_build_array(jsonb_build_object('id',jsonb_array_length(items)+1,'costName',btrim(l->>'name'),'amount',amount));
     end loop;
     if material_total+labor_total+equipment_total+other_total>=1e15 then raise exception 'Draft cost exceeds the supported amount.' using errcode='22023';end if;
     if standalone then
       update public.estimate_categories set material_direct_amount=direct_material,category_material_estimate=material_total,
         category_labor_estimate=labor_total,category_equipment_estimate=equipment_total,category_other_estimate=other_total,equipment_cost_items=items
       where id=owner_id and project_id=p_project_id;
     else
       update public.estimate_tasks set material_direct_amount=direct_material,material_estimate=material_total,labor_estimate=labor_total,
         equipment_estimate=equipment_total,other_cost_estimate=other_total,equipment_cost_items=items,
         total_estimate_cost=material_total+labor_total+equipment_total+other_total where id=owner_id and project_id=p_project_id;
     end if;
   end loop;
 end loop;
 perform public.gantt_history(p_project_id,'checkpoint');
end $$;
revoke all on function public._estimate_import_number(text) from public,anon;
grant execute on function public._estimate_import_number(text) to authenticated;
revoke all on function public.import_reviewed_estimate(bigint,jsonb) from public,anon;
grant execute on function public.import_reviewed_estimate(bigint,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
