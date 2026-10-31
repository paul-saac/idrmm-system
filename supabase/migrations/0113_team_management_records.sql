-- Intent: keep linked management details synchronized with Accounts and repair
-- known trade/category mismatches without changing worker IDs or assignments.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create or replace function public.normalize_team_member()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_name text;
begin
  if new.profile_id is not null then
    select role::text,btrim(concat_ws(' ',first_name,last_name)) into v_role,v_name from public.profiles where id=new.profile_id;
    if v_role in ('project_manager','foreman') then
      new.trade:=case when v_role='project_manager' then 'Project Manager' else 'Foreman' end;
      new.category:='management';new.employment_type:='employee';
      if nullif(v_name,'') is not null then new.full_name:=v_name;end if;
    end if;
  else
    case lower(btrim(coalesce(new.trade,'')))
      when 'project manager','foreman' then new.category:='management';
      when 'architect','civil engineer','structural engineer','project engineer','site engineer' then new.category:='professional';
      when 'mason','carpenter','steelman','electrician','plumber','welder','painter','tile setter','equipment operator','driver' then new.category:='skilled';
      else null;
    end case;
  end if;
  return new;
end;
$$;
revoke all on function public.normalize_team_member() from public,anon;
drop trigger if exists normalize_team_member on public.workers;
create trigger normalize_team_member before insert or update of trade,category,profile_id,full_name on public.workers
  for each row execute function public.normalize_team_member();

-- Fire the normalizer only for records whose known title/category or linked
-- account role disagrees. No row is deleted and no account credentials change.
update public.workers w set trade=w.trade
where (w.profile_id is not null and exists(select 1 from public.profiles p where p.id=w.profile_id and p.role in ('project_manager','foreman') and
  (w.trade is distinct from case when p.role='project_manager' then 'Project Manager' else 'Foreman' end or w.category is distinct from 'management')))
 or (w.profile_id is null and (
  (lower(btrim(w.trade)) in ('project manager','foreman') and w.category is distinct from 'management') or
  (lower(btrim(w.trade)) in ('architect','civil engineer','structural engineer','project engineer','site engineer') and w.category is distinct from 'professional') or
  (lower(btrim(w.trade)) in ('mason','carpenter','steelman','electrician','plumber','welder','painter','tile setter','equipment operator','driver') and w.category is distinct from 'skilled')));

create or replace function public.ensure_team_member(p_profile_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_profile public.profiles;v_name text;v_title text;v_worker_id bigint;
begin
  select * into v_profile from public.profiles where id=p_profile_id;
  if not found or v_profile.role::text not in ('project_manager','foreman') or v_profile.status::text<>'active' then return;end if;
  v_name:=btrim(concat_ws(' ',btrim(v_profile.first_name),btrim(v_profile.last_name)));
  if v_name='' then return;end if;
  v_title:=case when v_profile.role::text='project_manager' then 'Project Manager' else 'Foreman' end;
  update public.workers set full_name=v_name,trade=v_title,category='management',employment_type='employee'
    where profile_id=p_profile_id and (full_name is distinct from v_name or trade is distinct from v_title or category is distinct from 'management' or employment_type is distinct from 'employee');
  if exists(select 1 from public.workers where profile_id=p_profile_id) then return;end if;
  -- Equal names alone do not make a skilled worker the same management account.
  select id into v_worker_id from public.workers where profile_id is null and lower(btrim(full_name))=lower(v_name)
    and category='management' and lower(btrim(coalesce(trade,''))) in ('','foreman','project manager') order by id limit 1;
  if v_worker_id is not null then
    update public.workers set profile_id=p_profile_id,trade=v_title,category='management',employment_type='employee' where id=v_worker_id;
  else
    insert into public.workers(full_name,trade,category,employment_type,profile_id) values(v_name,v_title,'management','employee',p_profile_id);
  end if;
end;
$$;
revoke all on function public.ensure_team_member(uuid) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
