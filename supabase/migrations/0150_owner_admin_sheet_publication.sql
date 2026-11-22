-- Intent: Owner/Admin publishes official project documents directly. Preserve historical reviews and files.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.project_sheets DROP CONSTRAINT IF EXISTS project_sheets_status_check;
ALTER TABLE public.project_sheets ADD CONSTRAINT project_sheets_status_check CHECK(status IN ('published','submitted','accepted','changes_requested','rejected'));
ALTER TABLE public.project_sheets ALTER COLUMN status SET DEFAULT 'published';
DROP POLICY IF EXISTS "Project sheets review" ON public.project_sheets;
REVOKE UPDATE ON public.project_sheets FROM authenticated;
DROP POLICY IF EXISTS "Owner admin publication only" ON public.project_sheets;
CREATE POLICY "Owner admin publication only" ON public.project_sheets AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK(public.get_my_role() IN ('admin','super_admin'));
DROP POLICY IF EXISTS "Owner admin document files only" ON storage.objects;
CREATE POLICY "Owner admin document files only" ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK(bucket_id <> 'project-sheets' OR public.get_my_role() IN ('admin','super_admin'));
DROP TRIGGER IF EXISTS log_project_sheet_review ON public.project_sheets;
DROP TRIGGER IF EXISTS sheet_submission_notification ON public.project_sheets;
create or replace function public.guard_project_sheet()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text; v_prefix text;
begin
 if coalesce(public.get_my_role()::text,'') not in ('admin','super_admin') then raise exception 'Only the Owner/Administrator can publish project documents'; end if;
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
   new.status := 'published'; new.reviewed_by := null; new.reviewed_name := null; new.reviewed_at := null; new.review_notes := null;
   v_prefix := new.project_id::text || '/' || auth.uid()::text || '/';
   if left(new.file_path,length(v_prefix)) <> v_prefix or not exists(select 1 from storage.objects where bucket_id='project-sheets' and name=new.file_path) then raise exception 'Drawing upload not found'; end if;
   if new.evidence_path is not null and (left(new.evidence_path,length(v_prefix)) <> v_prefix or not exists(select 1 from storage.objects where bucket_id='project-sheets' and name=new.evidence_path)) then raise exception 'Evidence upload not found'; end if;
 else
   raise exception 'Published document revisions are immutable. Upload a new revision instead.';
 end if;
 if new.approval_date > (now() at time zone 'Asia/Manila')::date then raise exception 'Approval cannot be future dated'; end if;
 return new;
end;
$$;
COMMIT;
