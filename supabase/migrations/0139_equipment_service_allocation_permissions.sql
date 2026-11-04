-- Intent: allow the administrator-only service-status RPC to clear task plans.
-- Keep direct task-plan writes restricted; retain the RPC role/session/setup,
-- backup and stale-status checks and its fixed public,pg_temp search path.
begin;
alter function public.set_equipment_service_status(bigint,text,text) security definer;
revoke all on function public.set_equipment_service_status(bigint,text,text) from public,anon;
grant execute on function public.set_equipment_service_status(bigint,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
