-- ============================================================================
-- Adds email to public.profiles.
--
-- auth.users isn't queryable through the client libraries (it's not exposed
-- via PostgREST), so the accounts-management screens need email denormalized
-- onto profiles to list/search accounts. Populated at creation time by the
-- handle_new_user trigger.
--
-- Run this AFTER 0001_init_auth.sql.
-- ============================================================================

alter table public.profiles
  add column if not exists email text not null default '';

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

  insert into public.profiles (id, email, first_name, last_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    resolved_role
  );

  return new;
end;
$$;

-- Backfill any profile rows created before this migration (e.g. the
-- manually bootstrapped Super Admin).
update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email = '';
