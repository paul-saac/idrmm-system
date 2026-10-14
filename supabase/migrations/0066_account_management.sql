-- Managing one account (Accounts > a row's detail window): a change log, DD
-- whether an account has any history (only one without can be deleted
-- for good), signing someone out of every device, and when each account
-- last signed in.
--
-- Run this AFTER 0065_super_admin_access.sql.

-- ----------------------------------------------------------------------------
-- account_events — who created, edited, changed the role of, (de)activated,
-- reset, signed out, handed over or deleted whose account, and when. Names
-- are snapshots and neither id is a foreign key, so the log outlives a
-- deleted account. Only a super admin reads it; any account manager
-- writes their own.
-- ----------------------------------------------------------------------------
create table if not exists public.account_events (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  actor_name text not null,
  target_id uuid not null,
  target_name text not null,
  action text not null check (action in (
    'created', 'edited', 'role_changed', 'activated', 'deactivated',
    'password_reset_sent', 'password_set', 'signed_out', 'handed_over', 'deleted'
  )),
  details text,
  created_at timestamptz not null default now()
);

create index if not exists idx_account_events_target on public.account_events (target_id, created_at desc);
create index if not exists idx_account_events_created on public.account_events (created_at desc);

alter table public.account_events enable row level security;

drop policy if exists "Super admins can view the account log" on public.account_events;
create policy "Super admins can view the account log" on public.account_events
  for select using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );

drop policy if exists "Account managers can log their own changes" on public.account_events;
create policy "Account managers can log their own changes" on public.account_events
  for insert with check (public.get_my_role() = 'admin' and actor_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Whether anything in the app points at this account — a project, a log, a
-- request, a progress entry... — found through every foreign key to
-- profiles (so a table added later is covered too). Notifications and the
-- Team's own link don't count.
-- ----------------------------------------------------------------------------
create or replace function public.account_has_history(p_profile_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  v_found boolean;
begin
  if public.get_my_role() is distinct from 'admin' then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  for r in
    select c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confrelid = 'public.profiles'::regclass
      and c.conrelid not in ('public.notifications'::regclass, 'public.workers'::regclass)
  loop
    execute format('select exists (select 1 from %s where %I = $1)', r.tbl, r.col)
      into v_found
      using p_profile_id;
    if v_found then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

revoke execute on function public.account_has_history(uuid) from public, anon;
grant execute on function public.account_has_history(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Signs an account out of every device: its sessions go, so the next
-- request from any of them is signed out. Only for an account the caller
-- may manage (a super admin: admins, PMs, foremen; an admin: PMs, foremen).
-- ----------------------------------------------------------------------------
create or replace function public.sign_out_everywhere(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me public.user_role;
  v_target public.user_role;
begin
  select role into v_me from public.profiles where id = auth.uid();
  select role into v_target from public.profiles where id = p_user_id;

  if v_target is null or not (
    (v_me = 'super_admin' and v_target in ('admin', 'project_manager', 'foreman'))
    or (v_me = 'admin' and v_target in ('project_manager', 'foreman'))
  ) then
    raise exception 'Not authorized to sign this account out.' using errcode = '42501';
  end if;

  delete from auth.sessions where user_id = p_user_id;
end;
$$;

revoke execute on function public.sign_out_everywhere(uuid) from public, anon;
grant execute on function public.sign_out_everywhere(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- When each account last signed in (auth.users is out of the app's reach
-- otherwise). Admins and super admins only.
-- ----------------------------------------------------------------------------
create or replace function public.account_last_sign_ins()
returns table (profile_id uuid, last_sign_in_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.last_sign_in_at
  from auth.users u
  where public.get_my_role() = 'admin'
$$;

revoke execute on function public.account_last_sign_ins() from public, anon;
grant execute on function public.account_last_sign_ins() to authenticated;
