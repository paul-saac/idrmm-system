-- Intent: notify admins and assigned foremen when a material/equipment request
-- is created. Preserve recipient-only notification RLS and existing progress alerts.
begin;
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('progress_override', 'material_request', 'equipment_request'));
alter table public.notifications drop constraint if exists notifications_item_kind_check;
alter table public.notifications add constraint notifications_item_kind_check
  check (item_kind in ('task', 'category', 'material_request', 'equipment_request'));

create or replace function public.notify_project_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_kind text := tg_argv[0];
  v_project_name text;
  v_foreman uuid;
  v_actor_name text;
  v_number text;
begin
  if tg_op = 'DELETE' then
    -- Also removes notices when a failed item save cleans up its request header.
    delete from public.notifications where kind = v_kind and item_id = old.id;
    return old;
  end if;
  select project_name, foreman_id into v_project_name, v_foreman
    from public.projects where id = new.project_id;
  select nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
    into v_actor_name from public.profiles where id = new.requested_by;
  v_number := case when v_kind = 'material_request' then to_jsonb(new)->>'mr_no' else to_jsonb(new)->>'er_no' end;
  insert into public.notifications (recipient_id, actor_id, actor_name, kind,
    project_id, project_name, item_kind, item_id, item_name, entry_date)
  select p.id, new.requested_by, v_actor_name, v_kind, new.project_id,
    v_project_name, v_kind, new.id, v_number, new.request_date
  from public.profiles p
  where p.status = 'active'
    and (p.role in ('admin', 'super_admin') or (p.role = 'foreman' and p.id = v_foreman))
    and p.id is distinct from new.requested_by;
  return new;
end;
$$;
revoke all on function public.notify_project_request() from public;
drop trigger if exists material_request_notification on public.material_requests;
create trigger material_request_notification after insert or delete on public.material_requests
  for each row execute function public.notify_project_request('material_request');
drop trigger if exists equipment_request_notification on public.equipment_requisitions;
create trigger equipment_request_notification after insert or delete on public.equipment_requisitions
  for each row execute function public.notify_project_request('equipment_request');
commit;
