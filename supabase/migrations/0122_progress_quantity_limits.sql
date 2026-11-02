-- Intent: enforce the planned completion quantity across all saved daily entries.
-- Today is replaced, not added twice. Serialize competing writes for the same item.
-- Existing records are not rewritten or deleted.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $$ begin
 if not pg_try_advisory_xact_lock_shared(18244,7291) or public.system_backup_maintenance() then
   raise exception 'Quantity limit setup cancelled: backup or recovery is running.';
 end if;
end $$;
create or replace function public.check_progress_quantity_limit()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 v_id bigint;
 v_planned numeric;
 v_previous numeric;
begin
 if tg_table_name='task_progress_entries' then v_id:=new.task_id; else v_id:=new.category_id; end if;
 perform pg_advisory_xact_lock(hashtextextended('idrmm-progress-quantity:'||tg_table_name||':'||v_id::text,0));
 if tg_table_name='task_progress_entries' then
   select coalesce(estimated_quantity,0) into v_planned from public.estimate_tasks where id=v_id;
   select coalesce(sum(quantity_completed),0) into v_previous from public.task_progress_entries
     where task_id=v_id and entry_date<>new.entry_date;
 else
   select coalesce(estimated_quantity,0) into v_planned from public.estimate_categories where id=v_id;
   select coalesce(sum(quantity_completed),0) into v_previous from public.category_progress_entries
     where category_id=v_id and entry_date<>new.entry_date;
 end if;
 if v_planned is null then raise exception 'Work item is unavailable.' using errcode='42501'; end if;
 if new.quantity_completed is null or new.quantity_completed::text in ('NaN','Infinity','-Infinity') or new.quantity_completed<0 then
   raise exception 'Quantity completed must be a finite number of 0 or more.' using errcode='22023'; end if;
 if new.quantity_completed>greatest(0,v_planned-v_previous) then
   raise exception 'Quantity completed cannot exceed the remaining planned quantity (%).',greatest(0,v_planned-v_previous) using errcode='22023'; end if;
 return new;
end $$;
revoke all on function public.check_progress_quantity_limit() from public,anon;
create trigger task_progress_quantity_limit before insert or update of quantity_completed,task_id,entry_date on public.task_progress_entries
 for each row execute function public.check_progress_quantity_limit();
create trigger category_progress_quantity_limit before insert or update of quantity_completed,category_id,entry_date on public.category_progress_entries
 for each row execute function public.check_progress_quantity_limit();
commit;
