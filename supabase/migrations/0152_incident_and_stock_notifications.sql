-- Intent: notify project supervisors about incident closeouts and exhausted stock.
-- Stock is evaluated after all writes in a transaction, never on temporary
-- delete/reinsert states while editing a daily log. Existing records are not changed.
begin;
set local lock_timeout = '5s';

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('progress_override','material_request','equipment_request','sheet_submitted','safety_incident','incident_closed','material_out_of_stock'));
alter table public.notifications drop constraint notifications_item_kind_check;
alter table public.notifications add constraint notifications_item_kind_check
  check (item_kind in ('task','category','material_request','equipment_request','sheet','incident','material_stock'));

create function public.notify_incident_closed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.closeout is not null or new.closeout is null then return new; end if;
  insert into public.notifications(recipient_id,actor_id,actor_name,kind,project_id,project_name,item_kind,item_id,item_name,entry_date)
  select p.id,(new.closeout->>'closedBy')::uuid,new.closeout->>'closedByName',
    'incident_closed',new.project_id,project.project_name,'incident',new.id,
    replace(new.incident_type,'_',' '),new.occurred_on
  from public.profiles p cross join public.projects project
  where project.id=new.project_id and p.status='active' and not p.invitation_pending
    and p.id is distinct from (new.closeout->>'closedBy')::uuid
    and (p.role in ('admin','super_admin') or p.id=project.project_manager_id or p.id=project.foreman_id);
  return new;
end;
$$;
revoke all on function public.notify_incident_closed() from public,anon,authenticated;
create trigger incident_closed_notification after update of closeout on public.project_safety_incidents
  for each row execute function public.notify_incident_closed();

create or replace function public.delete_safety_incident_notifications()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.notifications where kind in ('safety_incident','incident_closed')
    and item_kind='incident' and project_id=old.project_id and item_id=old.id;
  return old;
end;
$$;

-- Private transition state, not a second stock ledger. Quantities continue to
-- come exclusively from receipts and the current task/category material entries.
create table public.material_stock_notification_state (
  project_id bigint not null references public.projects(id) on delete cascade,
  material_name text not null,
  unit text not null,
  exhausted boolean not null,
  primary key(project_id,material_name,unit)
);
alter table public.material_stock_notification_state enable row level security;
revoke all on public.material_stock_notification_state from public,anon,authenticated;

create function public.check_project_stock_notifications(p_project_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row record;
  v_previous boolean;
  v_exhausted boolean;
  v_actor uuid := auth.uid();
  v_actor_name text;
begin
  if p_project_id is null or not exists(select 1 from public.projects where id=p_project_id) then return; end if;
  -- Serialize concurrent stock changes, then evaluate this project's final
  -- transaction state only once, even when many item triggers were queued.
  perform pg_advisory_xact_lock(hashtextextended('material-stock:'||p_project_id,0));
  if current_setting('idrmm.stock_checked_'||p_project_id,true)=txid_current()::text then return; end if;
  perform set_config('idrmm.stock_checked_'||p_project_id,txid_current()::text,true);
  select trim(concat_ws(' ',first_name,last_name)) into v_actor_name from public.profiles where id=v_actor;
  for v_row in
    with movements as (
      select lower(trim(material_name)) name,lower(coalesce(unit,'')) unit,
        received_quantity received,0::numeric used
      from public.material_purchases where project_id=p_project_id
      union all
      select lower(trim(m.material_name)),lower(coalesce(m.unit,'')),0,m.quantity_used
      from public.task_progress_material_entries m
      join public.task_progress_entries e on e.id=m.progress_entry_id
      join public.estimate_tasks t on t.id=e.task_id where t.project_id=p_project_id
      union all
      select lower(trim(m.material_name)),lower(coalesce(m.unit,'')),0,m.quantity_used
      from public.category_progress_material_entries m
      join public.category_progress_entries e on e.id=m.progress_entry_id
      join public.estimate_categories c on c.id=e.category_id where c.project_id=p_project_id
      union all
      select material_name,unit,0,0 from public.material_stock_notification_state where project_id=p_project_id
    )
    select name,unit,sum(received) received,sum(used) used from movements
    where name<>'' group by name,unit
  loop
    -- Same three-decimal balance as the stock table; negative is also exhausted.
    v_exhausted := (v_row.received>0 or v_row.used>0) and round(v_row.received-v_row.used,3)<=0;
    select exhausted into v_previous from public.material_stock_notification_state
      where project_id=p_project_id and material_name=v_row.name and unit=v_row.unit;
    insert into public.material_stock_notification_state values(p_project_id,v_row.name,v_row.unit,v_exhausted)
      on conflict(project_id,material_name,unit) do update set exhausted=excluded.exhausted;
    if v_exhausted and not coalesce(v_previous,false) then
      insert into public.notifications(recipient_id,actor_id,actor_name,kind,project_id,project_name,item_kind,item_id,item_name,entry_date)
      select p.id,v_actor,v_actor_name,'material_out_of_stock',project.id,project.project_name,
        'material_stock',project.id,v_row.name||case when v_row.unit<>'' then ' ('||v_row.unit||')' else '' end,
        (now() at time zone 'Asia/Manila')::date
      from public.profiles p cross join public.projects project
      where project.id=p_project_id and project.archived_at is null
        and p.status='active' and not p.invitation_pending
        and (p.role in ('admin','super_admin') or p.id=project.project_manager_id or p.id=project.foreman_id);
    end if;
  end loop;
end;
$$;
revoke all on function public.check_project_stock_notifications(bigint) from public,anon,authenticated;

create function public.queue_project_stock_notifications()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_data jsonb; v_project bigint; v_pass integer;
begin
  -- Both keys matter when a material is renamed or moved between entries.
  for v_pass in 1..2 loop
    if v_pass=1 then
      if tg_op='INSERT' then continue; end if;
      v_data:=to_jsonb(old);
    else
      if tg_op='DELETE' then continue; end if;
      v_data:=to_jsonb(new);
    end if;
    v_project:=null;
    if tg_table_name in ('material_purchases','estimate_tasks','estimate_categories') then
      v_project:=(v_data->>'project_id')::bigint;
    elsif tg_table_name='task_progress_entries' then
      select project_id into v_project from public.estimate_tasks where id=(v_data->>'task_id')::bigint;
    elsif tg_table_name='category_progress_entries' then
      select project_id into v_project from public.estimate_categories where id=(v_data->>'category_id')::bigint;
    elsif tg_table_name='task_progress_material_entries' then
      select t.project_id into v_project from public.task_progress_entries e join public.estimate_tasks t on t.id=e.task_id
        where e.id=(v_data->>'progress_entry_id')::bigint;
    else
      select c.project_id into v_project from public.category_progress_entries e join public.estimate_categories c on c.id=e.category_id
        where e.id=(v_data->>'progress_entry_id')::bigint;
    end if;
    perform public.check_project_stock_notifications(v_project);
  end loop;
  return null;
end;
$$;
revoke all on function public.queue_project_stock_notifications() from public,anon,authenticated;

do $$ declare v_table text; begin
  foreach v_table in array array['material_purchases','task_progress_entries','category_progress_entries','task_progress_material_entries','category_progress_material_entries'] loop
    execute format('create constraint trigger stock_notification_check after insert or update or delete on public.%I deferrable initially deferred for each row execute function public.queue_project_stock_notifications()',v_table);
  end loop;
  foreach v_table in array array['estimate_tasks','estimate_categories'] loop
    execute format('create constraint trigger stock_notification_check after delete on public.%I deferrable initially deferred for each row execute function public.queue_project_stock_notifications()',v_table);
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
