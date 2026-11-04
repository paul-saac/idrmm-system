-- Intent: save subcontractors' entered daily labor amounts independently of
-- hourly attendance, including historical edits. Preserve existing logs and RLS.
begin;
alter table public.task_progress_attendance add column if not exists fixed_amount numeric;
alter table public.task_progress_attendance drop constraint if exists task_progress_attendance_hours_check;
alter table public.task_progress_attendance add constraint task_progress_attendance_hours_check check (
 (fixed_amount is null and hours>0 and hours<=24)
 or (fixed_amount is not null and fixed_amount>0 and fixed_amount<1e12 and hours=0 and hourly_rate=0)
);
comment on column public.task_progress_attendance.fixed_amount is 'Daily subcontractor labor amount. NULL for hourly workers; fixed rows have zero hours and hourly rate.';
alter table public.category_progress_attendance add column if not exists fixed_amount numeric;
alter table public.category_progress_attendance drop constraint if exists category_progress_attendance_hours_check;
alter table public.category_progress_attendance add constraint category_progress_attendance_hours_check check (
 (fixed_amount is null and hours>0 and hours<=24)
 or (fixed_amount is not null and fixed_amount>0 and fixed_amount<1e12 and hours=0 and hourly_rate=0)
);
comment on column public.category_progress_attendance.fixed_amount is 'Daily subcontractor labor amount. NULL for hourly workers; fixed rows have zero hours and hourly rate.';

create or replace function public.edit_saved_progress_log(p_project_id bigint,p_kind text,p_item_id bigint,p_log_id bigint,p_input jsonb)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 l public.progress_override_logs%rowtype; entry jsonb; old_attendance jsonb; old_worker jsonb; worker jsonb; row jsonb; payload jsonb;
 prefix text;owner_column text;entry_id bigint;latest_id bigint;owner_project bigint;worker_id bigint;input_id bigint;
 fixed numeric;is_fixed boolean;q numeric;hours numeric;rate numeric;labor numeric;equipment numeric;other_cost numeric;amount numeric;others numeric;
 name text;unit text;seen text[]:='{}';worker_key text;materials jsonb:='[]';equipment_rows jsonb:='[]';other_rows jsonb:='[]';attendance_rows jsonb:='[]';unplanned boolean;
begin
 if auth.uid() is null or public.app_session_is_active() is not true or public.invitation_setup_complete() is not true
   or coalesce(public.get_my_role()::text,'') not in ('admin','super_admin','project_manager','foreman') or public.project_access_level(p_project_id) is distinct from 'edit' then
   raise exception 'Project edit permission is required to correct saved logs.' using errcode='42501';end if;
 if public.system_backup_maintenance() then raise exception 'Saving is temporarily paused.' using errcode='55000';end if;
 if p_kind is null or p_kind not in ('task','category') or p_item_id is null or p_item_id<=0 or p_log_id is null or p_log_id<=0 then
   raise exception 'Choose a valid saved log.' using errcode='22023';end if;
 prefix:=p_kind||'_progress_';owner_column:=p_kind||'_id';
 execute format('select project_id from public.%I where id=$1',case when p_kind='task' then 'estimate_tasks' else 'estimate_categories' end) into owner_project using p_item_id;
 if owner_project is distinct from p_project_id then raise exception 'This item is not part of the selected project.' using errcode='42501';end if;
 select * into l from public.progress_override_logs where id=p_log_id and project_id=p_project_id
   and ((p_kind='task' and task_id=p_item_id) or (p_kind='category' and category_id=p_item_id));
 if not found or l.action<>'saved' or l.entry_date>(now() at time zone 'Asia/Manila')::date then
   raise exception 'That saved log is unavailable.' using errcode='22023';end if;
 execute format('select to_jsonb(e) from public.%I e where %I=$1 and entry_date=$2 for update',prefix||'entries',owner_column) into entry using p_item_id,l.entry_date;
 if entry is null then raise exception 'That daily log was deleted. Reopen the task.' using errcode='40001';end if;
 entry_id:=(entry->>'id')::bigint;
 select id into latest_id from public.progress_override_logs where project_id=p_project_id and entry_date=l.entry_date
   and ((p_kind='task' and task_id=p_item_id) or (p_kind='category' and category_id=p_item_id)) order by created_at desc,id desc limit 1;
 if latest_id is distinct from p_log_id then raise exception 'This log has changed. Reopen its latest version before editing.' using errcode='40001';end if;
 if (entry->>'quantity_completed')::numeric is distinct from l.quantity_completed then
   raise exception 'This log has changed. Reopen its latest version before editing.' using errcode='40001';end if;
 if jsonb_typeof(p_input) is distinct from 'object' or jsonb_typeof(p_input->'costs') is distinct from 'object' then
   raise exception 'Invalid log details.' using errcode='22023';end if;
 foreach name in array array['materialsUsed','unplannedMaterials','equipmentCostsUsed','unplannedEquipmentCosts','otherCostsUsed','unplannedOtherCosts','attendance','retainedMaterials'] loop
   payload:=coalesce(p_input->name,'[]'::jsonb);
   if jsonb_typeof(payload) is distinct from 'array' then raise exception 'Invalid log rows.' using errcode='22023';end if;
   if jsonb_array_length(payload)>1000 then raise exception 'Too many log rows.' using errcode='22023';end if;
 end loop;
 q:=public._progress_edit_number(p_input->>'quantityCompletedToday');
 labor:=public._progress_edit_number(p_input->'costs'->>'labor');
 equipment:=public._progress_edit_number(p_input->'costs'->>'equipment');
 other_cost:=public._progress_edit_number(p_input->'costs'->>'other');
 execute format('select coalesce(jsonb_agg(to_jsonb(a)),''[]''::jsonb) from public.%I a where progress_entry_id=$1',prefix||'attendance') into old_attendance using entry_id;
 if jsonb_array_length(coalesce(p_input->'attendance','[]'))>0 then labor:=0;end if;
 for row in select value from jsonb_array_elements(coalesce(p_input->'attendance','[]')) loop
   input_id:=(row->>'workerId')::bigint; hours:=public._progress_edit_number(row->>'hours');
   if input_id is null or input_id=0 then raise exception 'Choose a valid worker.' using errcode='22023';end if;
   if input_id<0 then
     name:=l.attendance->((-input_id-1)::integer)->>'name';
     select value into old_worker from jsonb_array_elements(old_attendance) where value->>'worker_name'=name;
     if old_worker is null or (select count(*) from jsonb_array_elements(old_attendance) where value->>'worker_name'=name)<>1 then
       raise exception 'A historical worker could not be identified safely. Contact your administrator.' using errcode='22023';end if;
   else
     select value into old_worker from jsonb_array_elements(old_attendance) where (value->>'worker_id')::bigint=input_id;
   end if;
   if old_worker is not null then
     worker_id:=(old_worker->>'worker_id')::bigint;name:=old_worker->>'worker_name';rate:=(old_worker->>'hourly_rate')::numeric;
     is_fixed:=old_worker->>'fixed_amount' is not null;
   else
     select to_jsonb(w) into worker from public.workers w where id=input_id and (category='skilled' or employment_type='subcontractor');
     if worker is null then raise exception 'Choose an available skilled worker or subcontractor.' using errcode='22023';end if;
     worker_id:=input_id;name:=worker->>'full_name';rate:=coalesce((worker->>'hourly_rate')::numeric,0);
     is_fixed:=worker->>'employment_type'='subcontractor';
   end if;
   fixed:=null;
   if is_fixed then
     fixed:=public._progress_edit_number(row->>'amount');
     if hours<>0 or fixed<=0 then raise exception 'Enter a daily subcontractor amount instead of hours.' using errcode='22023';end if;
     rate:=0;
   elsif hours<=0 or hours>24 or row->>'amount' is not null then
     raise exception 'Enter valid worker hours, up to 24 per day.' using errcode='22023';
   end if;
   worker_key:=coalesce(worker_id::text,'name:'||name);
   if worker_key=any(seen) then raise exception 'A worker appears more than once in this log.' using errcode='22023';end if;
   seen:=array_append(seen,worker_key);
   if worker_id is not null and not is_fixed then
     select coalesce(sum(a.hours),0) into others from public.attendance_elsewhere(l.entry_date,array[worker_id],case when p_kind='task' then p_item_id else null end,case when p_kind='category' then p_item_id else null end) a;
     if others+hours>24 then raise exception 'Total worker hours exceed 24 for the selected work date.' using errcode='22023';end if;
   end if;
   labor:=labor+round(coalesce(fixed,hours*rate),2);
   attendance_rows:=attendance_rows||jsonb_build_array(jsonb_build_object('workerId',worker_id,'name',name,'hours',hours,'rate',rate)||case when is_fixed then jsonb_build_object('amount',round(fixed,2)) else '{}'::jsonb end);
 end loop;
 for unplanned in select false union all select true loop
   for row in select value from jsonb_array_elements(coalesce(p_input->case when unplanned then 'unplannedMaterials' else 'materialsUsed' end,'[]')) loop
     name:=btrim(row->>'name');unit:=nullif(btrim(row->>'unit'),'');amount:=public._progress_edit_number(row->>'quantity');
     if amount=0 then continue;end if;
     if coalesce(name,'')='' then raise exception 'Name every material used.' using errcode='22023';end if;
     rate:=case when unplanned then public._progress_edit_number(row->>'unitCost') else null end;
     materials:=materials||jsonb_build_array(jsonb_build_object('name',name,'unit',unit,'quantity',amount,'unitCost',rate));
   end loop;
   for row in select value from jsonb_array_elements(coalesce(p_input->case when unplanned then 'unplannedEquipmentCosts' else 'equipmentCostsUsed' end,'[]')) loop
     name:=btrim(row->>'name');amount:=public._progress_edit_number(row->>'amount');if amount=0 then continue;end if;
     if coalesce(name,'')='' then raise exception 'Describe every equipment cost.' using errcode='22023';end if;
     equipment:=equipment+amount;equipment_rows:=equipment_rows||jsonb_build_array(jsonb_build_object('name',name,'amount',amount,'unplanned',unplanned));
   end loop;
   for row in select value from jsonb_array_elements(coalesce(p_input->case when unplanned then 'unplannedOtherCosts' else 'otherCostsUsed' end,'[]')) loop
     name:=btrim(row->>'name');amount:=public._progress_edit_number(row->>'amount');if amount=0 then continue;end if;
     if coalesce(name,'')='' then raise exception 'Describe every other cost.' using errcode='22023';end if;
     other_cost:=other_cost+amount;other_rows:=other_rows||jsonb_build_array(jsonb_build_object('name',name,'amount',amount,'unplanned',unplanned));
   end loop;
 end loop;
 -- Keep a historical planned material whose estimate line was removed. Its
 -- original quantity comes from the stored entry, never from client claims.
 for row in select value from jsonb_array_elements(coalesce(p_input->'retainedMaterials','[]')) loop
   execute format('select jsonb_build_object(''name'',material_name,''unit'',unit,''quantity'',quantity_used,''unitCost'',unit_cost) from public.%I where progress_entry_id=$1 and material_name=$2 and unit is not distinct from $3 and unit_cost is null',prefix||'material_entries') into payload using entry_id,row->>'name',row->>'unit';
   if payload is null then raise exception 'A retained material has changed. Reopen the log.' using errcode='40001';end if;
   materials:=materials||jsonb_build_array(payload);
 end loop;
 -- Update the existing entry, retaining entry_date, recorded_by, and created_at.
 -- The existing quantity-limit trigger checks all other days of this item.
 execute format('update public.%I set quantity_completed=$1,labor_cost=$2,equipment_cost=$3,other_cost=$4 where id=$5',prefix||'entries') using q,round(labor,2),round(equipment,2),round(other_cost,2),entry_id;
 execute format('delete from public.%I where progress_entry_id=$1',prefix||'attendance') using entry_id;
 execute format('delete from public.%I where progress_entry_id=$1',prefix||'material_entries') using entry_id;
 execute format('delete from public.%I where progress_entry_id=$1',prefix||'equipment_cost_entries') using entry_id;
 execute format('delete from public.%I where progress_entry_id=$1',prefix||'other_cost_entries') using entry_id;
 for row in select value from jsonb_array_elements(attendance_rows) loop
   execute format('insert into public.%I(progress_entry_id,worker_id,worker_name,hours,hourly_rate,fixed_amount) values($1,$2,$3,$4,$5,$6)',prefix||'attendance') using entry_id,(row->>'workerId')::bigint,row->>'name',(row->>'hours')::numeric,(row->>'rate')::numeric,(row->>'amount')::numeric;
 end loop;
 for row in select value from jsonb_array_elements(materials) loop
   execute format('insert into public.%I(progress_entry_id,material_name,unit,quantity_used,unit_cost) values($1,$2,$3,$4,$5)',prefix||'material_entries') using entry_id,row->>'name',row->>'unit',(row->>'quantity')::numeric,(row->>'unitCost')::numeric;
 end loop;
 for row in select value from jsonb_array_elements(equipment_rows) loop
   execute format('insert into public.%I(progress_entry_id,cost_name,amount,unplanned) values($1,$2,$3,$4)',prefix||'equipment_cost_entries') using entry_id,row->>'name',(row->>'amount')::numeric,(row->>'unplanned')::boolean;
 end loop;
 for row in select value from jsonb_array_elements(other_rows) loop
   execute format('insert into public.%I(progress_entry_id,cost_name,amount,unplanned) values($1,$2,$3,$4)',prefix||'other_cost_entries') using entry_id,row->>'name',(row->>'amount')::numeric,(row->>'unplanned')::boolean;
 end loop;
 select nullif(btrim(concat_ws(' ',first_name,last_name)),'') into name from public.profiles where id=auth.uid();
 insert into public.progress_override_logs(project_id,task_id,category_id,entry_date,action,quantity_completed,labor_cost,material_cost,equipment_cost,other_cost,materials_used,attendance,equipment_costs,other_costs,saved_by,saved_by_name)
 values(p_project_id,case when p_kind='task' then p_item_id else null end,case when p_kind='category' then p_item_id else null end,l.entry_date,'saved',q,round(labor,2),(entry->>'material_cost')::numeric,round(equipment,2),round(other_cost,2),materials,attendance_rows,equipment_rows,other_rows,auth.uid(),name);
end $$;
notify pgrst,'reload schema';
commit;
