-- Intent: Super Administrator backup/restore queue, history, worker readiness
-- and a write-maintenance gate. No existing business records are changed.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create table public.system_backup_snapshots (
  id uuid primary key,
  created_at timestamptz not null default now(),
  created_by uuid,
  created_by_name text not null,
  purpose text not null check (purpose in ('manual','scheduled','safety')),
  size_bytes bigint not null check(size_bytes>0),
  artifact_sha256 text not null,
  key_id text not null,
  schema_fingerprint text not null,
  table_count integer not null,
  file_count integer not null,
  recovery_admin_ids uuid[] not null default '{}'
);
create table public.system_backup_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('backup','restore')),
  status text not null default 'queued' check(status in ('queued','running','completed','failed')),
  phase text not null default 'Queued',
  requested_by uuid,
  requested_by_name text not null,
  snapshot_id uuid references public.system_backup_snapshots(id),
  safety_snapshot_id uuid references public.system_backup_snapshots(id),
  schedule_key text unique,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error text
);
create unique index system_backup_one_active on public.system_backup_jobs((true))
  where status in ('queued','running');
create table public.system_backup_state (
  singleton boolean primary key default true check(singleton),
  maintenance boolean not null default false,
  recovery_required boolean not null default false,
  active_job_id uuid,
  recovery_token_hash text,
  worker_heartbeat timestamptz,
  worker_ready boolean not null default false,
  worker_message text not null default 'Start the backup worker to enable backups.',
  schedule_description text not null default 'Daily at 02:00 Asia/Manila while the worker is running.'
);
insert into public.system_backup_state(singleton) values(true);

-- Control records intentionally have no profile FK: restoring account data
-- must preserve the running recovery job, maintenance state and history.
alter table public.system_backup_snapshots enable row level security;
alter table public.system_backup_jobs enable row level security;
alter table public.system_backup_state enable row level security;
revoke all on public.system_backup_snapshots,public.system_backup_jobs,public.system_backup_state from anon,authenticated;

create function public.system_backup_maintenance()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select maintenance from public.system_backup_state where singleton;
$$;
revoke all on function public.system_backup_maintenance() from public;
grant execute on function public.system_backup_maintenance() to anon,authenticated;

create function public.system_backup_status()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='super_admin'
    and status='active' and not invitation_pending) then
    raise exception 'Only Super Administrators can access backup and restore.' using errcode='42501';
  end if;
  return jsonb_build_object(
    'state',(select to_jsonb(s)-'recovery_token_hash' from public.system_backup_state s where singleton),
    'snapshots',coalesce((select jsonb_agg(to_jsonb(s) order by created_at desc) from
      (select * from public.system_backup_snapshots order by created_at desc limit 50) s),'[]'::jsonb),
    'jobs',coalesce((select jsonb_agg(to_jsonb(j) order by requested_at desc) from
      (select * from public.system_backup_jobs order by requested_at desc limit 20) j),'[]'::jsonb)
  );
end;
$$;
revoke all on function public.system_backup_status() from public,anon;
grant execute on function public.system_backup_status() to authenticated;

create function public.system_backup_request(p_kind text,p_snapshot_id uuid default null,p_confirmation text default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor public.profiles; v_state public.system_backup_state; v_id uuid;
begin
  select * into v_actor from public.profiles where id=auth.uid()
    and role='super_admin' and status='active' and not invitation_pending;
  if not found then raise exception 'Only Super Administrators can access backup and restore.' using errcode='42501'; end if;
  if p_kind not in ('backup','restore') or p_kind is null then raise exception 'Choose a valid backup action.'; end if;
  select * into v_state from public.system_backup_state where singleton for update;
  if not v_state.worker_ready or v_state.worker_heartbeat is null or v_state.worker_heartbeat<now()-interval '60 seconds' then
    raise exception 'The backup worker is offline. Start it on the configured backup computer.';
  end if;
  if v_state.maintenance and not v_state.recovery_required then raise exception 'A backup or restore is already running.'; end if;
  if v_state.recovery_required and p_kind<>'restore' then raise exception 'Recovery is required. Restore a verified backup before creating another backup.'; end if;
  if p_kind='restore' then
    if not exists(select 1 from public.system_backup_snapshots where id=p_snapshot_id and v_actor.id=any(recovery_admin_ids)) then
      raise exception 'Choose a verified backup containing your active Super Administrator account.';
    end if;
    if p_confirmation is distinct from 'RESTORE '||left(p_snapshot_id::text,8) then
      raise exception 'Enter the restore confirmation exactly as shown.';
    end if;
  elsif p_snapshot_id is not null then raise exception 'A new backup does not take a snapshot ID.'; end if;
  insert into public.system_backup_jobs(kind,requested_by,requested_by_name,snapshot_id)
    values(p_kind,v_actor.id,coalesce(nullif(trim(coalesce(v_actor.first_name,'')||' '||coalesce(v_actor.last_name,'')),''),'Super Administrator'),p_snapshot_id) returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'A backup or restore is already queued. Wait for it to finish.';
end;
$$;
revoke all on function public.system_backup_request(text,uuid,text) from public,anon;
grant execute on function public.system_backup_request(text,uuid,text) to authenticated;

-- The worker's random token is never returned through an authenticated RPC.
-- It is passed through a private session setting or Storage request header.
create function public.system_backup_write_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_state public.system_backup_state; v_token text; v_headers jsonb;
begin
  select * into v_state from public.system_backup_state where singleton;
  if v_state.maintenance then
    begin v_headers:=nullif(current_setting('request.headers',true),'')::jsonb;
    exception when others then v_headers:='{}'::jsonb; end;
    v_token:=coalesce(nullif(current_setting('idrmm.recovery_token',true),''),v_headers->>'x-idrmm-recovery-token');
    if v_token is not null and encode(sha256(convert_to(v_token,'UTF8')),'hex')=v_state.recovery_token_hash then
      if tg_op='DELETE' then return old; elsif tg_op='TRUNCATE' then return null; else return new; end if;
    end if;
    raise exception 'Backup or restore maintenance is active. Please wait before saving changes.' using errcode='55000';
  end if;
  -- Drain in-flight writes before the worker obtains its exclusive lock.
  -- Do not wait while holding a row/table lock needed by a restore. A save
  -- racing the maintenance transition must fail promptly, not deadlock.
  if not pg_try_advisory_xact_lock_shared(18244,7291) then
    raise exception 'Backup or restore maintenance is active. Please wait before saving changes.' using errcode='55000';
  end if;
  if (select maintenance from public.system_backup_state where singleton) then
    raise exception 'Backup or restore maintenance is active. Please wait before saving changes.' using errcode='55000';
  end if;
  if tg_op='DELETE' then return old; elsif tg_op='TRUNCATE' then return null; else return new; end if;
end;
$$;
revoke all on function public.system_backup_write_guard() from public,anon,authenticated;
do $$ declare r record; begin
  for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p') and not c.relispartition
      and ((n.nspname='public' and c.relname not like 'system_backup_%') or (n.nspname='storage' and c.relname in ('objects','buckets')))
      and not exists(select 1 from pg_depend d where d.objid=c.oid and d.classid='pg_class'::regclass and d.deptype='e')
  loop
    execute format('create trigger a_system_backup_write_guard before insert or update or delete on %I.%I for each row execute function public.system_backup_write_guard()',r.nspname,r.relname);
    execute format('create trigger a_system_backup_truncate_guard before truncate on %I.%I for each statement execute function public.system_backup_write_guard()',r.nspname,r.relname);
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
