-- ============================================================================
-- Auth foundation: role enum, profiles table, RLS policies, and a trigger
-- that creates a profile row for every new auth.users record.
--
-- Run this once in the Supabase SQL Editor (or via `supabase db push` if
-- you're using the Supabase CLI and have linked this project).
-- ============================================================================

do $$ begin
  create type public.user_role as enum ('super_admin', 'admin', 'project_manager', 'foreman');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  role public.user_role not null default 'foreman',
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- security definer helper so policies can check "am I an admin" without
-- recursively re-triggering RLS on profiles.
create or replace function public.get_my_role()
returns public.user_role
language sql
security definer
stable
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile" on public.profiles
  for select
  using (auth.uid() = id);

drop policy if exists "Admins can view all profiles" on public.profiles;
create policy "Admins can view all profiles" on public.profiles
  for select
  using (public.get_my_role() in ('admin', 'super_admin'));

drop policy if exists "Admins can update profiles" on public.profiles;
create policy "Admins can update profiles" on public.profiles
  for update
  using (public.get_my_role() in ('admin', 'super_admin'));

-- Auto-create a profile row whenever a new user is added to auth.users
-- (e.g. via the Admin API when the User Account Management module is
-- built, or manually through the Supabase dashboard). Role/first/last
-- name can be seeded via the new user's raw_user_meta_data; unrecognized
-- or missing roles fall back to 'foreman' so nobody is silently granted
-- elevated access.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text := new.raw_user_meta_data ->> 'role';
  resolved_role public.user_role;
begin
  resolved_role := case
    when requested_role in ('super_admin', 'admin', 'project_manager', 'foreman')
      then requested_role::public.user_role
    else 'foreman'::public.user_role
  end;

  insert into public.profiles (id, first_name, last_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    resolved_role
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- Bootstrapping the first Super Admin / Admin account
--
-- The app has no self-registration (accounts are provisioned by Admins),
-- and .env only has the publishable key, not the service_role key needed
-- to create users from server code. So the very first account has to be
-- created by hand, once:
--
--   1. Supabase Dashboard -> Authentication -> Users -> Add user
--      - enter an email + password
--      - check "Auto Confirm User"
--   2. Copy the new user's UID, then run:
--
--        update public.profiles
--        set role = 'super_admin'
--        where id = '<paste-uid-here>';
--
-- After that, that account can sign in at "/" and (once the User
-- Account Management module is built) provision everyone else.
-- ============================================================================
