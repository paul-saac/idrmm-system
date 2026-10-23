-- Intent: store incidents independently of progress, protect evidence, and
-- notify project supervisors through the existing in-app notification system.
begin;

create table public.project_safety_incidents (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects(id) on delete cascade,
  task_id bigint references public.estimate_tasks(id) on delete set null,
  category_id bigint references public.estimate_categories(id) on delete set null,
  context_name text not null default '',
  log_date date not null,
  incident_type text not null check (incident_type in ('injury','near_miss','equipment_damage','property_damage','other')),
  severity text not null check (severity in ('minor','moderate','serious')),
  occurred_on date not null,
  occurred_time time not null,
  location text not null default '' check (length(location) <= 300),
  description text not null check (length(trim(description)) between 1 and 5000),
  attachments jsonb not null default '[]' check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 5),
  reported_by uuid not null default auth.uid() references public.profiles(id),
  reporter_name text not null default '',
  created_at timestamptz not null default now(),
  check (num_nonnulls(task_id, category_id) <= 1)
);
create index project_safety_incidents_project_date on public.project_safety_incidents(project_id, occurred_on desc, id desc);

create function public.can_access_safety_incidents(target_project bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select public.invitation_setup_complete() and exists (
    select 1 from public.projects p where p.id = target_project and (
      public.get_my_role() in ('admin','super_admin')
      or p.project_manager_id = auth.uid() or public.is_project_foreman(p.id)
    )
  );
$$;
revoke all on function public.can_access_safety_incidents(bigint) from public;
grant execute on function public.can_access_safety_incidents(bigint) to authenticated;

alter table public.project_safety_incidents enable row level security;
grant select, insert on public.project_safety_incidents to authenticated;
create policy "Project members read safety incidents" on public.project_safety_incidents
  for select to authenticated using (public.can_access_safety_incidents(project_id));
create policy "Project members report safety incidents" on public.project_safety_incidents
  for insert to authenticated with check (reported_by = auth.uid() and public.can_access_safety_incidents(project_id));

create function public.prepare_safety_incident()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.task_id is not null then
    select task_name into new.context_name from public.estimate_tasks
      where id = new.task_id and project_id = new.project_id;
    if not found then raise exception 'The incident task does not belong to this project'; end if;
  elsif new.category_id is not null then
    select category_name into new.context_name from public.estimate_categories
      where id = new.category_id and project_id = new.project_id;
    if not found then raise exception 'The incident category does not belong to this project'; end if;
  else
    new.context_name := '';
  end if;
  select trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) into new.reporter_name
    from public.profiles where id = new.reported_by;
  new.created_at := now();
  return new;
end;
$$;
create trigger prepare_safety_incident before insert on public.project_safety_incidents
  for each row execute function public.prepare_safety_incident();

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('incident-evidence', 'incident-evidence', false, 10485760, array['image/jpeg','image/png','application/pdf']);
create policy "Project members read incident evidence" on storage.objects for select to authenticated using (
  bucket_id = 'incident-evidence'
  and public.can_access_safety_incidents(case when (storage.foldername(name))[1] ~ '^[0-9]{1,15}$' then (storage.foldername(name))[1]::bigint else null end)
);
create policy "Project members upload incident evidence" on storage.objects for insert to authenticated with check (
  bucket_id = 'incident-evidence' and (storage.foldername(name))[2] = auth.uid()::text
  and public.can_access_safety_incidents(case when (storage.foldername(name))[1] ~ '^[0-9]{1,15}$' then (storage.foldername(name))[1]::bigint else null end)
);
create policy "Reporters clean up unattached incident evidence" on storage.objects for delete to authenticated using (
  bucket_id = 'incident-evidence' and (storage.foldername(name))[2] = auth.uid()::text
  and public.can_access_safety_incidents(case when (storage.foldername(name))[1] ~ '^[0-9]{1,15}$' then (storage.foldername(name))[1]::bigint else null end)
  and not exists (select 1 from public.project_safety_incidents i where i.attachments @> jsonb_build_array(jsonb_build_object('path', storage.objects.name)))
);

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('progress_override','material_request','equipment_request','sheet_submitted','safety_incident'));
alter table public.notifications drop constraint if exists notifications_item_kind_check;
alter table public.notifications add constraint notifications_item_kind_check
  check (item_kind in ('task','category','material_request','equipment_request','sheet','incident'));
create function public.notify_safety_incident()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications(recipient_id,actor_id,actor_name,kind,project_id,project_name,item_kind,item_id,item_name,entry_date)
  select p.id,new.reported_by,new.reporter_name,'safety_incident',new.project_id,project.project_name,
    'incident',new.id,'INC-' || lpad(new.id::text, greatest(4,length(new.id::text)), '0') || ' - ' || replace(new.incident_type,'_',' '),new.occurred_on
  from public.profiles p cross join public.projects project
  where project.id = new.project_id and p.status = 'active' and not p.invitation_pending
    and p.id is distinct from new.reported_by
    and (p.role in ('admin','super_admin') or p.id = project.project_manager_id or p.id = project.foreman_id);
  return new;
end;
$$;
revoke all on function public.notify_safety_incident() from public;
create trigger safety_incident_notification after insert on public.project_safety_incidents
  for each row execute function public.notify_safety_incident();
commit;
