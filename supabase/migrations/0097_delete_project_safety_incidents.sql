-- Intent: allow authorized project members to delete an incident and its
-- unreferenced evidence while removing notifications that point to it.
begin;

grant delete on public.project_safety_incidents to authenticated;
create policy "Project members delete safety incidents" on public.project_safety_incidents
  for delete to authenticated using (public.can_access_safety_incidents(project_id));

create policy "Project members delete incident evidence" on storage.objects
  for delete to authenticated using (
    bucket_id = 'incident-evidence'
    and public.can_access_safety_incidents(
      case when (storage.foldername(name))[1] ~ '^[0-9]{1,15}$'
        then (storage.foldername(name))[1]::bigint else null end
    )
    and not exists (
      select 1 from public.project_safety_incidents incident
      where incident.attachments @> jsonb_build_array(jsonb_build_object('path', storage.objects.name))
    )
  );

create function public.delete_safety_incident_notifications()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.notifications
  where kind = 'safety_incident' and item_kind = 'incident'
    and project_id = old.project_id and item_id = old.id;
  return old;
end;
$$;
revoke all on function public.delete_safety_incident_notifications() from public;
create trigger delete_safety_incident_notifications
  after delete on public.project_safety_incidents
  for each row execute function public.delete_safety_incident_notifications();

commit;
