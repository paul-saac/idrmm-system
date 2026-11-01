-- Intent: allow read-only session checks during backup/restore maintenance.
-- Keep all session expiration rules and both session-table write guards.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create or replace function public.app_session_state(p_activity boolean default false, p_end boolean default false)
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
  -- Session polling must remain available while business writes are paused.
  if not exists (select 1 from public.system_backup_state where singleton and maintenance) then
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
  end if;
  select * into v_row from public.app_user_sessions where session_id = v_id and user_id = v_user;
  if not found then
    -- A newly authenticated login is bounded by its original Auth timestamps.
    v_row.started_at := v_auth.created_at;
    v_row.last_activity_at := v_auth.created_at;
  end if;
  v_reason := case
    when p_end then 'signed_out'
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

commit;
