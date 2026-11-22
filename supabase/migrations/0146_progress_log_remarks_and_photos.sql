-- Intent: retain daily-log remarks and private photo evidence on current entries
-- and immutable edit snapshots, without changing quantities, costs, or work dates.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
alter table public.task_progress_entries add column if not exists remarks text not null default '', add column if not exists photos jsonb not null default '[]';
alter table public.category_progress_entries add column if not exists remarks text not null default '', add column if not exists photos jsonb not null default '[]';
alter table public.progress_override_logs add column if not exists remarks text not null default '', add column if not exists photos jsonb not null default '[]';

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('progress-photos','progress-photos',false,5242880,array['image/jpeg','image/png','image/webp']);
create policy "Project viewers read daily log photos" on storage.objects for select to authenticated using (
 bucket_id='progress-photos' and public.app_session_is_active() and public.invitation_setup_complete()
 and public.project_access_level(case when split_part(name,'/',1) ~ '^[0-9]{1,15}$' then split_part(name,'/',1)::bigint end) in ('view','edit'));
create policy "Project editors upload daily log photos" on storage.objects for insert to authenticated with check (
 bucket_id='progress-photos' and public.app_session_is_active() and public.invitation_setup_complete()
 and split_part(name,'/',2)=auth.uid()::text and not public.system_backup_maintenance()
 and public.project_access_level(case when split_part(name,'/',1) ~ '^[0-9]{1,15}$' then split_part(name,'/',1)::bigint end)='edit');
create policy "Uploaders clean unattached daily log photos" on storage.objects for delete to authenticated using (
 bucket_id='progress-photos' and split_part(name,'/',2)=auth.uid()::text
 and public.app_session_is_active() and not public.system_backup_maintenance()
 and public.project_access_level(case when split_part(name,'/',1) ~ '^[0-9]{1,15}$' then split_part(name,'/',1)::bigint end)='edit'
 and not exists(select 1 from public.progress_override_logs l where l.photos @> jsonb_build_array(jsonb_build_object('path',storage.objects.name)))
 and not exists(select 1 from public.task_progress_entries e where e.photos @> jsonb_build_array(jsonb_build_object('path',storage.objects.name)))
 and not exists(select 1 from public.category_progress_entries e where e.photos @> jsonb_build_array(jsonb_build_object('path',storage.objects.name))));

create function public.validate_progress_log_evidence() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare project bigint; photo jsonb; seen text[]:='{}';
begin
 if tg_table_name='task_progress_entries' then select project_id into project from public.estimate_tasks where id=new.task_id;
 else select project_id into project from public.estimate_categories where id=new.category_id;end if;
 if length(new.remarks)>2000 or jsonb_typeof(new.photos) is distinct from 'array' then
  raise exception 'Invalid daily-log remarks or photos.' using errcode='22023';end if;
 if jsonb_array_length(new.photos)>6 then raise exception 'Attach up to 6 photos per log.' using errcode='22023';end if;
 for photo in select value from jsonb_array_elements(new.photos) loop
  if jsonb_typeof(photo) is distinct from 'object' or coalesce(photo->>'path','')=any(seen)
   or split_part(photo->>'path','/',1) is distinct from project::text or photo->>'path' like '%..%'
   or coalesce(photo->>'type','') not in ('image/jpeg','image/png','image/webp')
   or coalesce(length(photo->>'name'),0) not between 1 and 200
   or not exists(select 1 from storage.objects o where o.bucket_id='progress-photos' and o.name=photo->>'path'
    and o.metadata->>'mimetype'=photo->>'type' and (o.metadata->>'size')::bigint between 1 and 5242880)
  then raise exception 'A photo is unavailable or does not belong to this project.' using errcode='22023';end if;
  seen:=array_append(seen,photo->>'path');
 end loop;
 return new;
end$$;
revoke all on function public.validate_progress_log_evidence() from public,anon,authenticated;
create trigger validate_daily_log_evidence before insert or update of remarks,photos on public.task_progress_entries for each row execute function public.validate_progress_log_evidence();
create trigger validate_daily_log_evidence before insert or update of remarks,photos on public.category_progress_entries for each row execute function public.validate_progress_log_evidence();

-- Existing online/offline saves and legacy corrections copy current evidence
-- into the new snapshot. Old snapshots remain untouched.
create function public.snapshot_progress_log_evidence() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.action='saved' then
  if new.task_id is not null then select remarks,photos into new.remarks,new.photos from public.task_progress_entries where task_id=new.task_id and entry_date=new.entry_date;
  else select remarks,photos into new.remarks,new.photos from public.category_progress_entries where category_id=new.category_id and entry_date=new.entry_date;end if;
  new.remarks:=coalesce(new.remarks,'');new.photos:=coalesce(new.photos,'[]');
 end if;
 return new;
end$$;
revoke all on function public.snapshot_progress_log_evidence() from public,anon,authenticated;
create trigger snapshot_daily_log_evidence before insert on public.progress_override_logs for each row execute function public.snapshot_progress_log_evidence();

-- The core retains all existing authorization, optimistic-concurrency checks,
-- pricing, quantity limits, and resource writes. Evidence joins that transaction.
create function public.edit_progress_log_with_evidence(p_project_id bigint,p_kind text,p_item_id bigint,p_log_id bigint,p_input jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare work_date date; latest_id bigint;
begin
 if auth.uid() is null or not public.app_session_is_active() or not public.invitation_setup_complete()
  or public.project_access_level(p_project_id) is distinct from 'edit'
  or coalesce(public.get_my_role()::text,'') not in ('admin','super_admin','project_manager','foreman') then
  raise exception 'Project edit permission is required.' using errcode='42501';end if;
 if public.system_backup_maintenance() then raise exception 'Saving is temporarily paused.' using errcode='55000';end if;
 perform public.edit_saved_progress_log(p_project_id,p_kind,p_item_id,p_log_id,p_input);
 select entry_date into work_date from public.progress_override_logs where id=p_log_id;
 if p_kind='task' then
  update public.task_progress_entries set remarks=coalesce(p_input->>'remarks',remarks),photos=coalesce(p_input->'photos',photos) where task_id=p_item_id and entry_date=work_date;
 else
  update public.category_progress_entries set remarks=coalesce(p_input->>'remarks',remarks),photos=coalesce(p_input->'photos',photos) where category_id=p_item_id and entry_date=work_date;
 end if;
 select id into latest_id from public.progress_override_logs where project_id=p_project_id and entry_date=work_date
  and ((p_kind='task' and task_id=p_item_id) or (p_kind='category' and category_id=p_item_id)) order by created_at desc,id desc limit 1;
 update public.progress_override_logs set remarks=coalesce(p_input->>'remarks',remarks),photos=coalesce(p_input->'photos',photos) where id=latest_id;
end$$;
revoke all on function public.edit_progress_log_with_evidence(bigint,text,bigint,bigint,jsonb) from public,anon;
grant execute on function public.edit_progress_log_with_evidence(bigint,text,bigint,bigint,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
