-- Intent: synchronize dated offline daily accomplishments atomically, preserving
-- server authorization, audit history, resource validation and duplicate safety.
-- No existing accomplishment values or baseline schedules are changed.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$begin
 if not pg_try_advisory_xact_lock(18244,7291) or public.system_backup_maintenance() then
  raise exception 'Finish backup/recovery before installing offline logging.';
 end if;
end$$;

create table public.offline_progress_submissions(
 id uuid primary key,
 actor_id uuid references public.profiles(id) on delete set null,
 project_id bigint not null references public.projects(id) on delete cascade,
 item_kind text not null check(item_kind in ('task','category')),
 item_id bigint not null,
 work_date date not null,
 captured_at timestamptz not null,
 input_hash text not null,
 result jsonb not null,
 synchronized_at timestamptz not null default now()
);
create index offline_progress_submissions_project on public.offline_progress_submissions(project_id,work_date);
alter table public.offline_progress_submissions enable row level security;
revoke all on public.offline_progress_submissions from anon,authenticated;
grant select on public.offline_progress_submissions to authenticated;
create policy "Read own synchronized submissions" on public.offline_progress_submissions for select to authenticated
 using(actor_id=auth.uid() and public.app_session_is_active() and public.invitation_setup_complete()
  and public.project_access_level(project_id) in ('view','edit'));
create trigger a_system_backup_write_guard before insert or update or delete on public.offline_progress_submissions
 for each row execute function public.system_backup_write_guard();
create trigger a_system_backup_truncate_guard before truncate on public.offline_progress_submissions
 for each statement execute function public.system_backup_write_guard();

-- Online and offline attendance share the same per-worker/day lock. A race
-- between two tasks must not silently exceed the existing 24-hour daily limit.
create function public.check_synchronized_worker_hours()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare work_date date;other_hours numeric;
begin
 if new.worker_id is null or new.fixed_amount is not null then return new;end if;
 if tg_table_name='task_progress_attendance' then
  select entry_date into work_date from public.task_progress_entries where id=new.progress_entry_id;
 else
  select entry_date into work_date from public.category_progress_entries where id=new.progress_entry_id;
 end if;
 if work_date is null then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended('idrmm-offline-worker:'||new.worker_id::text||':'||work_date::text,0));
 select coalesce(sum(hours),0) into other_hours from (
  select a.hours from public.task_progress_attendance a join public.task_progress_entries e on e.id=a.progress_entry_id
   where a.worker_id=new.worker_id and e.entry_date=work_date and a.fixed_amount is null
    and (tg_table_name<>'task_progress_attendance' or a.id<>new.id)
  union all
  select a.hours from public.category_progress_attendance a join public.category_progress_entries e on e.id=a.progress_entry_id
   where a.worker_id=new.worker_id and e.entry_date=work_date and a.fixed_amount is null
    and (tg_table_name<>'category_progress_attendance' or a.id<>new.id)
 ) daily;
 if other_hours+new.hours>24 then raise exception 'Total worker hours exceed 24 for the selected work date.' using errcode='22023';end if;
 return new;
end$$;
revoke all on function public.check_synchronized_worker_hours() from public,anon,authenticated;
create trigger synchronized_worker_hours before insert or update on public.task_progress_attendance
 for each row execute function public.check_synchronized_worker_hours();
create trigger synchronized_worker_hours before insert or update on public.category_progress_attendance
 for each row execute function public.check_synchronized_worker_hours();

-- Private helper: fingerprint both the entry and its resource rows/audit version.
-- The public RPCs verify project access before calling this helper.
create function public._offline_progress_state(p_kind text,p_id bigint,p_date date)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare prefix text;owner_col text;e jsonb;a jsonb;m jsonb;eq jsonb;oc jsonb;history_id bigint;total numeric;input jsonb;
begin
 if p_kind not in ('task','category') then raise exception 'Invalid item.' using errcode='22023';end if;
 prefix:=p_kind||'_progress_';owner_col:=p_kind||'_id';
 execute format('select to_jsonb(e) from public.%I e where %I=$1 and entry_date=$2',prefix||'entries',owner_col) into e using p_id,p_date;
 execute format('select coalesce(sum(quantity_completed),0) from public.%I where %I=$1',prefix||'entries',owner_col) into total using p_id;
 select id into history_id from public.progress_override_logs where entry_date=p_date
  and ((p_kind='task' and task_id=p_id) or (p_kind='category' and category_id=p_id)) order by created_at desc,id desc limit 1;
 if e is not null then
  execute format('select coalesce(jsonb_agg(to_jsonb(r) order by id),''[]'') from public.%I r where progress_entry_id=$1',prefix||'attendance') into a using (e->>'id')::bigint;
  execute format('select coalesce(jsonb_agg(to_jsonb(r) order by id),''[]'') from public.%I r where progress_entry_id=$1',prefix||'material_entries') into m using (e->>'id')::bigint;
  execute format('select coalesce(jsonb_agg(to_jsonb(r) order by id),''[]'') from public.%I r where progress_entry_id=$1',prefix||'equipment_cost_entries') into eq using (e->>'id')::bigint;
  execute format('select coalesce(jsonb_agg(to_jsonb(r) order by id),''[]'') from public.%I r where progress_entry_id=$1',prefix||'other_cost_entries') into oc using (e->>'id')::bigint;
 end if;
 input:=jsonb_build_object('quantityCompletedToday',coalesce((e->>'quantity_completed')::numeric,0),
  'costs',jsonb_build_object('labor',case when jsonb_array_length(coalesce(a,'[]'))>0 then 0 else coalesce((e->>'labor_cost')::numeric,0) end,'material',0,
   'equipment',greatest(0,coalesce((e->>'equipment_cost')::numeric,0)-(select coalesce(sum((value->>'amount')::numeric),0) from jsonb_array_elements(coalesce(eq,'[]')))),
   'other',greatest(0,coalesce((e->>'other_cost')::numeric,0)-(select coalesce(sum((value->>'amount')::numeric),0) from jsonb_array_elements(coalesce(oc,'[]'))))),
  'attendance',(select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('workerId',value->'worker_id','hours',value->'hours','amount',value->'fixed_amount'))),'[]') from jsonb_array_elements(coalesce(a,'[]'))),
  'materialsUsed',(select coalesce(jsonb_agg(jsonb_build_object('name',value->'material_name','unit',value->'unit','quantity',value->'quantity_used')),'[]') from jsonb_array_elements(coalesce(m,'[]')) where value->>'unit_cost' is null),
  'unplannedMaterials',(select coalesce(jsonb_agg(jsonb_build_object('name',value->'material_name','unit',value->'unit','quantity',value->'quantity_used','unitCost',value->'unit_cost')),'[]') from jsonb_array_elements(coalesce(m,'[]')) where value->>'unit_cost' is not null),
  'equipmentCostsUsed',(select coalesce(jsonb_agg(jsonb_build_object('name',value->'cost_name','amount',value->'amount')),'[]') from jsonb_array_elements(coalesce(eq,'[]')) where not (value->>'unplanned')::boolean),
  'unplannedEquipmentCosts',(select coalesce(jsonb_agg(jsonb_build_object('name',value->'cost_name','amount',value->'amount')),'[]') from jsonb_array_elements(coalesce(eq,'[]')) where (value->>'unplanned')::boolean),
  'otherCostsUsed',(select coalesce(jsonb_agg(jsonb_build_object('name',value->'cost_name','amount',value->'amount')),'[]') from jsonb_array_elements(coalesce(oc,'[]')) where not (value->>'unplanned')::boolean),
  'unplannedOtherCosts',(select coalesce(jsonb_agg(jsonb_build_object('name',value->'cost_name','amount',value->'amount')),'[]') from jsonb_array_elements(coalesce(oc,'[]')) where (value->>'unplanned')::boolean));
 return jsonb_build_object('version',case when e is null and history_id is null then null else md5(jsonb_build_array(e,a,m,eq,oc,history_id)::text) end,
  'input',input,'totalQuantity',coalesce(total,0));
end$$;
revoke all on function public._offline_progress_state(text,bigint,date) from public,anon,authenticated;

create function public.offline_project_progress(p_project_id bigint,p_date date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb:='{}';r record;
begin
 if auth.uid() is null or public.app_session_is_active() is not true or public.invitation_setup_complete() is not true
  or public.project_access_level(p_project_id) is distinct from 'edit' then
  raise exception 'Project edit access is required.' using errcode='42501';end if;
 if p_date is null or p_date>(now() at time zone 'Asia/Manila')::date then
  raise exception 'Choose a valid work date, no later than today.' using errcode='22023';end if;
 for r in select 'task' kind,id from public.estimate_tasks where project_id=p_project_id and not is_milestone
  union all select 'category',c.id from public.estimate_categories c where c.project_id=p_project_id and not c.is_milestone
   and not exists(select 1 from public.estimate_tasks t where t.category_id=c.id) loop
  result:=result||jsonb_build_object(r.kind||'-'||r.id::text,public._offline_progress_state(r.kind,r.id,p_date));
 end loop;
 return result;
end$$;
revoke all on function public.offline_project_progress(bigint,date) from public,anon;
grant execute on function public.offline_project_progress(bigint,date) to authenticated;

create function public.synchronize_offline_progress(p_id uuid,p_owner uuid,p_project_id bigint,p_kind text,p_item_id bigint,
 p_work_date date,p_captured_at timestamptz,p_expected_version text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare existing public.offline_progress_submissions%rowtype;state jsonb;result jsonb;item jsonb;
 prefix text;owner_col text;entry_id bigint;log_id bigint;seed_id bigint;latest_id bigint;v_hash text;v_name text;worker_id bigint;
begin
 if auth.uid() is null or p_owner is distinct from auth.uid() or public.app_session_is_active() is not true
  or public.invitation_setup_complete() is not true or coalesce(public.get_my_role()::text,'') not in ('admin','super_admin','project_manager','foreman')
  or public.project_access_level(p_project_id) is distinct from 'edit' then
  raise exception 'Sign in with the original account and check project access before synchronizing.' using errcode='42501';end if;
 if public.system_backup_maintenance() then raise exception 'Saving is temporarily paused.' using errcode='55000';end if;
 if p_id is null or p_kind is null or p_kind not in ('task','category') or p_item_id is null or p_item_id<=0
  or p_work_date is null or p_work_date>(now() at time zone 'Asia/Manila')::date
  or p_captured_at is null or p_captured_at>now()+interval '5 minutes'
  or (p_captured_at at time zone 'Asia/Manila')::date<p_work_date
  or jsonb_typeof(p_input) is distinct from 'object' then
  raise exception 'Check the work date, device clock and daily log details.' using errcode='22023';end if;
 v_hash:=md5(jsonb_build_array(p_owner,p_project_id,p_kind,p_item_id,p_work_date,p_captured_at,p_expected_version,p_input)::text);
 perform pg_advisory_xact_lock(hashtextextended('idrmm-offline:'||p_id::text,0));
 select * into existing from public.offline_progress_submissions where id=p_id;
 if found then
  if existing.actor_id is distinct from auth.uid() or existing.input_hash is distinct from v_hash then
   raise exception 'This submission identifier was already used for different data.' using errcode='40001';end if;
  return existing.result||jsonb_build_object('replayed',true);
 end if;
 prefix:=p_kind||'_progress_';owner_col:=p_kind||'_id';
 execute format('select to_jsonb(r) from public.%I r where id=$1 and project_id=$2 for update',case when p_kind='task' then 'estimate_tasks' else 'estimate_categories' end)
  into item using p_item_id,p_project_id;
 if item is null or coalesce((item->>'is_milestone')::boolean,false) or
  (p_kind='category' and exists(select 1 from public.estimate_tasks where category_id=p_item_id)) then
  raise exception 'This work item is no longer available for daily logging.' using errcode='22023';end if;
 execute format('select id from public.%I where %I=$1 and entry_date=$2 for update',prefix||'entries',owner_col) into entry_id using p_item_id,p_work_date;
 -- Match online history edits: lock the dated entry before the quantity lock,
 -- so an online correction and offline synchronization cannot deadlock here.
 perform pg_advisory_xact_lock(hashtextextended('idrmm-progress-quantity:'||prefix||'entries:'||p_item_id::text,0));
 -- Serialize attendance checks across simultaneous offline task submissions.
 for worker_id in select distinct (value->>'workerId')::bigint from jsonb_array_elements(coalesce(p_input->'attendance','[]')) order by 1 loop
  perform pg_advisory_xact_lock(hashtextextended('idrmm-offline-worker:'||worker_id::text||':'||p_work_date::text,0));
 end loop;
 state:=public._offline_progress_state(p_kind,p_item_id,p_work_date);
 if state->>'version' is distinct from p_expected_version then
  raise exception 'This daily log changed after the project was downloaded. Review the latest record before synchronizing.' using errcode='40001';end if;
 if entry_id is null then
  execute format('insert into public.%I(%I,entry_date,quantity_completed,labor_cost,material_cost,equipment_cost,other_cost,recorded_by) values($1,$2,0,0,0,0,0,$3) returning id',prefix||'entries',owner_col)
   into entry_id using p_item_id,p_work_date,auth.uid();
 end if;
 select id into log_id from public.progress_override_logs where entry_date=p_work_date
  and ((p_kind='task' and task_id=p_item_id) or (p_kind='category' and category_id=p_item_id)) order by created_at desc,id desc limit 1;
 -- A temporary audit anchor lets the established, validated edit RPC perform
 -- both first saves and replacements. It is removed in this same transaction.
 if log_id is null or not exists(select 1 from public.progress_override_logs where id=log_id and action='saved'
  and quantity_completed=(state->'input'->>'quantityCompletedToday')::numeric) then
  select nullif(btrim(concat_ws(' ',first_name,last_name)),'') into v_name from public.profiles where id=auth.uid();
  insert into public.progress_override_logs(project_id,task_id,category_id,entry_date,action,quantity_completed,labor_cost,material_cost,equipment_cost,other_cost,saved_by,saved_by_name)
   values(p_project_id,case when p_kind='task' then p_item_id end,case when p_kind='category' then p_item_id end,p_work_date,'saved',
    (state->'input'->>'quantityCompletedToday')::numeric,0,0,0,0,auth.uid(),v_name) returning id into seed_id;
  log_id:=seed_id;
 end if;
 perform public.edit_saved_progress_log(p_project_id,p_kind,p_item_id,log_id,p_input);
 if seed_id is not null then delete from public.progress_override_logs where id=seed_id;end if;
 result:=jsonb_build_object('id',p_id,'workDate',p_work_date,'state',public._offline_progress_state(p_kind,p_item_id,p_work_date));
 insert into public.offline_progress_submissions(id,actor_id,project_id,item_kind,item_id,work_date,captured_at,input_hash,result)
  values(p_id,auth.uid(),p_project_id,p_kind,p_item_id,p_work_date,p_captured_at,v_hash,result);
 return result;
end$$;
revoke all on function public.synchronize_offline_progress(uuid,uuid,bigint,text,bigint,date,timestamptz,text,jsonb) from public,anon;
grant execute on function public.synchronize_offline_progress(uuid,uuid,bigint,text,bigint,date,timestamptz,text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
