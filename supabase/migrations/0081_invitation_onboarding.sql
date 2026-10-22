-- Invite-only onboarding: roles come from a server-issued invitation, never
-- editable user metadata. Existing accounts remain unchanged.
begin;

alter table public.profiles add column if not exists invitation_pending boolean not null default false;

create table if not exists public.account_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role public.user_role not null check (role in ('admin', 'project_manager', 'foreman')),
  invited_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.account_invitations enable row level security;
revoke all on public.account_invitations from anon, authenticated;
grant all on public.account_invitations to service_role;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare invitation public.account_invitations%rowtype;
begin
  delete from public.account_invitations
    where id::text = new.raw_user_meta_data->>'invitation_id'
      and email = lower(new.email)
      and created_at > now() - interval '1 hour'
    returning * into invitation;
  if not found then raise exception 'An administrator invitation is required.'; end if;
  if not exists (
    select 1 from public.profiles p where p.id = invitation.invited_by
      and p.status = 'active' and not p.invitation_pending
      and (p.role = 'super_admin' or (p.role = 'admin' and invitation.role in ('project_manager', 'foreman')))
  ) then raise exception 'Invitation issuer is no longer authorized.'; end if;
  insert into public.profiles(id, email, first_name, last_name, role, invitation_pending)
  values(new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'first_name',''),
    coalesce(new.raw_user_meta_data->>'last_name',''), invitation.role, true);
  return new;
end;
$$;

-- Confirmation alone does not finish setup. Password must have been set too.
create or replace function public.complete_invited_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null and coalesce(new.encrypted_password, '') <> '' then
    update public.profiles set invitation_pending = false
      where id = new.id and invitation_pending;
  end if;
  return new;
end;
$$;
drop trigger if exists complete_invited_profile on auth.users;
create trigger complete_invited_profile after update of encrypted_password, email_confirmed_at on auth.users
  for each row execute function public.complete_invited_profile();

create or replace function public.get_my_role()
returns public.user_role language sql security definer stable set search_path = public as $$
  select case when role = 'super_admin' then 'admin'::public.user_role else role end
    from public.profiles where id = auth.uid() and status = 'active' and not invitation_pending;
$$;

-- Some project/file policies use direct profile lookups instead of get_my_role.
-- Restrict incomplete invite sessions without changing existing role policies.
create or replace function public.invitation_setup_complete()
returns boolean language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and not invitation_pending);
$$;
do $$ declare t record; begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relrowsecurity
      and c.relname not in ('profiles', 'account_invitations')
  loop
    execute format('drop policy if exists "Invitation setup required" on public.%I', t.relname);
    execute format('create policy "Invitation setup required" on public.%I as restrictive for all to authenticated using (public.invitation_setup_complete()) with check (public.invitation_setup_complete())', t.relname);
  end loop;
end $$;
drop policy if exists "Invitation setup required" on storage.objects;
create policy "Invitation setup required" on storage.objects as restrictive for all to authenticated
  using(public.invitation_setup_complete()) with check(public.invitation_setup_complete());
commit;
