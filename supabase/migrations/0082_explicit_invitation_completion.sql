-- Require successful application password setup, not email confirmation,
-- to complete onboarding. Existing completed accounts are left unchanged.
begin;
drop trigger if exists complete_invited_profile on auth.users;
drop function if exists public.complete_invited_profile();

-- Only the trusted server may change the onboarding gate. Normal profile
-- edits, including admin edits, must not accidentally clear this flag.
create or replace function public.protect_invitation_pending()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.invitation_pending is distinct from old.invitation_pending
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Invitation completion requires the trusted password setup flow.';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_invitation_pending on public.profiles;
create trigger protect_invitation_pending before update on public.profiles
  for each row execute function public.protect_invitation_pending();
commit;
