-- Intent: private project drawing revisions, external technical approval evidence,  dd
-- and audited admin document acceptance. Acceptance is not technical approval.
begin;
create or replace function public.can_read_project_sheets(p_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
 select exists(select 1 from public.profiles u where u.id = auth.uid() and u.status = 'active'
   and (u.role in ('admin','super_admin') or exists(select 1 from public.projects p
     where p.id = p_id and ((u.role = 'foreman' and p.foreman_id = u.id) or (u.role = 'project_manager' and p.project_manager_id = u.id)))));
$$;
create table if not exists public.project_sheets (
 id bigint generated always as identity primary key,
 project_id bigint not null references public.projects(id) on delete cascade,
 sheet_number text not null check(length(sheet_number) between 1 and 80),
 title text not null check(length(title) between 1 and 200),
 discipline text not null check(discipline in ('Architectural','Structural','Electrical','Plumbing','Mechanical','Civil','General')),
 revision integer not null check(revision > 0),
 stage text not null check(stage in ('original','revision','as_built')),
 file_path text not null unique, file_name text not null,
 evidence_path text unique, external_name text, external_role text, approval_date date,
 change_notes text not null default '' check(length(change_notes) <= 5000),
 status text not null default 'submitted' check(status in ('submitted','accepted','changes_requested','rejected')),
 submitted_by uuid not null references public.profiles(id), submitted_name text not null,
 created_at timestamptz not null default now(),
 reviewed_by uuid references public.profiles(id), reviewed_name text, reviewed_at timestamptz, review_notes text,
 unique(project_id,sheet_number,revision)
);
create table if not exists public.project_sheet_reviews (
 id bigint generated always as identity primary key,
 sheet_id bigint not null references public.project_sheets(id) on delete cascade,
 status text not null, notes text not null, reviewer_name text not null,
 reviewer_id uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
alter table public.project_sheets enable row level security;
alter table public.project_sheet_reviews enable row level security;
grant select,insert,update on public.project_sheets to authenticated;
grant select on public.project_sheet_reviews to authenticated;
grant usage,select on sequence public.project_sheets_id_seq to authenticated;
drop policy if exists "Project sheets read" on public.project_sheets;
create policy "Project sheets read" on public.project_sheets for select to authenticated using(public.can_read_project_sheets(project_id));
drop policy if exists "Project sheets submit" on public.project_sheets;
create policy "Project sheets submit" on public.project_sheets for insert to authenticated with check(public.can_read_project_sheets(project_id) and submitted_by = auth.uid());
drop policy if exists "Project sheets review" on public.project_sheets;
create policy "Project sheets review" on public.project_sheets for update to authenticated using(public.can_read_project_sheets(project_id) and public.get_my_role() = 'admin') with check(public.get_my_role() = 'admin');
drop policy if exists "Project sheet review history" on public.project_sheet_reviews;
create policy "Project sheet review history" on public.project_sheet_reviews for select to authenticated using(exists(select 1 from public.project_sheets s where s.id = sheet_id and public.can_read_project_sheets(s.project_id)));

create or replace function public.guard_project_sheet()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text; v_prefix text;
begin
 if not public.can_read_project_sheets(new.project_id) then raise exception 'Project access denied'; end if;
 select concat_ws(' ', first_name,last_name) into v_name from public.profiles where id = auth.uid();
 if tg_op = 'INSERT' then
   new.sheet_number := upper(btrim(new.sheet_number));
   -- Serialize revision numbers for each project and drawing; never overwrite a file.
   perform pg_advisory_xact_lock(hashtextextended(new.project_id::text || ':' || new.sheet_number,0));
   select coalesce(max(revision),0)+1 into new.revision from public.project_sheets where project_id=new.project_id and sheet_number=new.sheet_number;
   if new.revision > 1 and new.stage = 'original' then raise exception 'Choose revision or as-built for an existing sheet'; end if;
   if new.stage <> 'original' and btrim(new.change_notes) = '' then raise exception 'Field change notes are required'; end if;
   new.submitted_by := auth.uid(); new.submitted_name := v_name; new.created_at := now();
   new.status := 'submitted'; new.reviewed_by := null; new.reviewed_name := null; new.reviewed_at := null; new.review_notes := null;
   v_prefix := new.project_id::text || '/' || auth.uid()::text || '/';
   if left(new.file_path,length(v_prefix)) <> v_prefix or not exists(select 1 from storage.objects where bucket_id='project-sheets' and name=new.file_path) then raise exception 'Drawing upload not found'; end if;
   if new.evidence_path is not null and (left(new.evidence_path,length(v_prefix)) <> v_prefix or not exists(select 1 from storage.objects where bucket_id='project-sheets' and name=new.evidence_path)) then raise exception 'Evidence upload not found'; end if;
 else
   if public.get_my_role() <> 'admin' then raise exception 'Only administrators can review documents'; end if;
   if (to_jsonb(new) - array['status','reviewed_by','reviewed_name','reviewed_at','review_notes']) is distinct from (to_jsonb(old) - array['status','reviewed_by','reviewed_name','reviewed_at','review_notes']) then raise exception 'Drawing revisions are immutable'; end if;
   if new.status not in ('accepted','changes_requested','rejected') or coalesce(length(btrim(new.review_notes)),0) not between 1 and 2000 then raise exception 'A review decision and comments are required'; end if;
   if new.status = 'accepted' and (new.evidence_path is null or nullif(btrim(new.external_name),'') is null or nullif(btrim(new.external_role),'') is null or new.approval_date is null) then raise exception 'Acceptance requires external approval or verification evidence and professional details'; end if;
   new.reviewed_by := auth.uid(); new.reviewed_name := v_name; new.reviewed_at := now();
 end if;
 if new.approval_date > (now() at time zone 'Asia/Manila')::date then raise exception 'Approval cannot be future dated'; end if;
 return new;
end;
$$;
create or replace function public.log_project_sheet_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
 insert into public.project_sheet_reviews(sheet_id,status,notes,reviewer_id,reviewer_name)
 values(new.id,new.status,new.review_notes,new.reviewed_by,new.reviewed_name);
 return new;
end;
$$;
revoke all on function public.guard_project_sheet(), public.log_project_sheet_review() from public;
drop trigger if exists guard_project_sheet on public.project_sheets;
create trigger guard_project_sheet before insert or update on public.project_sheets for each row execute function public.guard_project_sheet();
drop trigger if exists log_project_sheet_review on public.project_sheets;
create trigger log_project_sheet_review after update on public.project_sheets for each row execute function public.log_project_sheet_review();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('project-sheets','project-sheets',false,8388608,array['application/pdf','image/png','image/jpeg'])
on conflict(id) do nothing;
drop policy if exists "Project drawing files read" on storage.objects;
create policy "Project drawing files read" on storage.objects for select to authenticated using(bucket_id='project-sheets' and public.can_read_project_sheets(case when split_part(name,'/',1) ~ '^[0-9]{1,15}$' then split_part(name,'/',1)::bigint else null end));
drop policy if exists "Project drawing files upload" on storage.objects;
create policy "Project drawing files upload" on storage.objects for insert to authenticated with check(bucket_id='project-sheets' and split_part(name,'/',2)=auth.uid()::text and public.can_read_project_sheets(case when split_part(name,'/',1) ~ '^[0-9]{1,15}$' then split_part(name,'/',1)::bigint else null end));
drop policy if exists "Remove unreferenced drawing uploads" on storage.objects;
create policy "Remove unreferenced drawing uploads" on storage.objects for delete to authenticated using(bucket_id='project-sheets' and split_part(name,'/',2)=auth.uid()::text and not exists(select 1 from public.project_sheets s where s.file_path=name or s.evidence_path=name));
commit;
