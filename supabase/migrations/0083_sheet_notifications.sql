-- Notify active, onboarded admins when drawings/documents or new revisions
-- are submitted for records review. Keep existing notification RLS unchanged.
begin;
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('progress_override','material_request','equipment_request','sheet_submitted'));
alter table public.notifications drop constraint if exists notifications_item_kind_check;
alter table public.notifications add constraint notifications_item_kind_check
  check (item_kind in ('task','category','material_request','equipment_request','sheet'));
create or replace function public.notify_sheet_submission()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications(recipient_id,actor_id,actor_name,kind,
    project_id,project_name,item_kind,item_id,item_name,entry_date)
  select p.id,new.submitted_by,new.submitted_name,'sheet_submitted',
    new.project_id,project.project_name,'sheet',new.id,
    new.sheet_number || ' — ' || new.title || ' (version ' || new.revision || ')',
    (new.created_at at time zone 'Asia/Manila')::date
  from public.profiles p cross join public.projects project
  where project.id=new.project_id and p.role in ('admin','super_admin')
    and p.status='active' and not p.invitation_pending
    and p.id is distinct from new.submitted_by;
  return new;
end;
$$;
revoke all on function public.notify_sheet_submission() from public;
drop trigger if exists sheet_submission_notification on public.project_sheets;
create trigger sheet_submission_notification after insert on public.project_sheets
  for each row when (new.status='submitted') execute function public.notify_sheet_submission();
commit;
