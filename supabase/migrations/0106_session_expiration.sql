-- Intent: enforce 30-minute inactivity and 12-hour absolute login limits,
-- including direct Data API/RPC and authenticated Storage/Realtime access.
-- Existing role/project policies remain in place. No business records change.
begin;

create table public.app_user_sessions (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null,
  last_activity_at timestamptz not null,
  revoked_at timestamptz,
  check (last_activity_at >= started_at)
);
alter table public.app_user_sessions enable row level security;
revoke all on public.app_user_sessions from public, anon, authenticated;

-- The ID comes from the verified JWT. Neither the browser nor an RPC argument
-- can choose an account/session or supply a later login/activity timestamp.
create function public.app_session_is_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.app_user_sessions a
    join auth.sessions s on s.id = a.session_id and s.user_id = a.user_id
    where a.session_id = nullif(auth.jwt()->>'session_id', '')::uuid
      and a.user_id = auth.uid() and a.revoked_at is null
      and a.started_at > statement_timestamp() - interval '12 hours'
      and a.last_activity_at > statement_timestamp() - interval '30 minutes'
      and (s.not_after is null or s.not_after > statement_timestamp())
  );
$$;
revoke all on function public.app_session_is_active() from public, anon;
grant execute on function public.app_session_is_active() to authenticated;

-- Reading state never extends a session. Only an explicit activity request
-- can advance last_activity_at, and only while the session is still valid.
-- Missing rows start at Auth's original login time, never at registration time:
-- deleting a cookie/refreshing/re-registering cannot resurrect an expired login.
create function public.app_session_state(p_activity boolean default false, p_end boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := nullif(auth.jwt()->>'session_id', '')::uuid;
  v_user uuid := auth.uid();
  v_now timestamptz := statement_timestamp();
  v_auth auth.sessions;
  v_row public.app_user_sessions;
  v_reason text;
begin
  select * into v_auth from auth.sessions where id = v_id and user_id = v_user;
  if not found or v_auth.created_at is null then
    return jsonb_build_object('active', false, 'reason', 'signed_out', 'serverNow', v_now);
  end if;
  insert into public.app_user_sessions(session_id, user_id, started_at, last_activity_at)
    values(v_id, v_user, v_auth.created_at, v_auth.created_at)
    on conflict (session_id) do nothing;

  if p_end then
    update public.app_user_sessions set revoked_at = coalesce(revoked_at, v_now)
      where session_id = v_id and user_id = v_user;
  elsif p_activity then
    update public.app_user_sessions set last_activity_at = greatest(last_activity_at, v_now)
      where session_id = v_id and user_id = v_user and revoked_at is null
        and started_at > v_now - interval '12 hours'
        and last_activity_at > v_now - interval '30 minutes'
        and (v_auth.not_after is null or v_auth.not_after > v_now);
  end if;
  select * into v_row from public.app_user_sessions where session_id = v_id and user_id = v_user;
  v_reason := case
    when v_row.revoked_at is not null then 'signed_out'
    when v_row.started_at <= v_now - interval '12 hours' then 'maximum'
    when v_auth.not_after is not null and v_auth.not_after <= v_now then 'signed_out'
    when v_row.last_activity_at <= v_now - interval '30 minutes' then 'idle'
    else null end;
  return jsonb_build_object(
    'active', v_reason is null, 'reason', v_reason, 'serverNow', v_now,
    'sessionId', v_id, 'idleExpiresAt', v_row.last_activity_at + interval '30 minutes',
    'absoluteExpiresAt', v_row.started_at + interval '12 hours',
    'expiresAt', least(v_row.last_activity_at + interval '30 minutes',
      v_row.started_at + interval '12 hours', coalesce(v_auth.not_after, 'infinity'::timestamptz))
  );
end;
$$;
revoke all on function public.app_session_state(boolean, boolean) from public, anon;
grant execute on function public.app_session_state(boolean, boolean) to authenticated;

-- SECURITY DEFINER RPCs bypass table RLS. Protect them too, at the Data API
-- boundary. Session state is the only exception; it returns no project data
-- and cannot extend an already expired session. Service-role recovery is intact.
create function public.enforce_app_session()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() = 'authenticated'
    and coalesce(current_setting('request.path', true), '') <> '/rpc/app_session_state'
    and not public.app_session_is_active() then
    raise sqlstate 'PT401' using message = 'Your session has expired. Please sign in again.';
  end if;
end;
$$;
revoke all on function public.enforce_app_session() from public;
grant execute on function public.enforce_app_session() to anon, authenticated, service_role;

-- Restrictive policies add a condition to existing policies; they never grant
-- access on their own. This also covers products that do not run pre-request.
do $$ declare r record; begin
  for r in select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r','p') and not c.relispartition
      and ((n.nspname = 'public' and c.relname <> 'app_user_sessions')
        or (n.nspname = 'storage' and c.relname in ('objects','buckets')))
      and not exists (select 1 from pg_depend d where d.objid = c.oid
        and d.classid = 'pg_class'::regclass and d.deptype = 'e')
  loop
    -- Storage already has RLS; do not alter a Supabase-managed table's flags.
    if r.nspname = 'public' then
      execute format('alter table %I.%I enable row level security', r.nspname, r.relname);
    end if;
    execute format('create policy app_session_required on %I.%I as restrictive for all to authenticated using ((select public.app_session_is_active())) with check ((select public.app_session_is_active()))', r.nspname, r.relname);
  end loop;
end $$;

-- Do not overwrite a hook introduced independently of this application.
do $$ declare v_setting text; begin
  select setting into v_setting from pg_db_role_setting s
    cross join lateral unnest(s.setconfig) setting
    where s.setrole = (select oid from pg_roles where rolname = 'authenticator')
      and setting like 'pgrst.db_pre_request=%' limit 1;
  if v_setting is not null and v_setting not in ('pgrst.db_pre_request=', 'pgrst.db_pre_request=public.enforce_app_session') then
    raise exception 'An existing Data API pre-request hook must be integrated before applying session expiration.';
  end if;
end $$;
alter role authenticator set pgrst.db_pre_request = 'public.enforce_app_session';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
commit;
