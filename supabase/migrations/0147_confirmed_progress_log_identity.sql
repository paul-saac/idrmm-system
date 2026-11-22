-- Intent: return the exact saved audit identity with a corrected daily log,
-- so editing and deletion do not depend on a later workspace refresh.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create function public.edit_progress_log_with_evidence_result(p_project_id bigint,p_kind text,p_item_id bigint,p_log_id bigint,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare work_date date; result jsonb;
begin
 perform public.edit_progress_log_with_evidence(p_project_id,p_kind,p_item_id,p_log_id,p_input);
 select entry_date into work_date from public.progress_override_logs where id=p_log_id;
 select jsonb_build_object('id',id,'createdAt',created_at) into result
 from public.progress_override_logs
 where project_id=p_project_id and entry_date=work_date and action='saved'
 and ((p_kind='task' and task_id=p_item_id) or (p_kind='category' and category_id=p_item_id))
 order by created_at desc,id desc limit 1;
 return result;
end$$;
revoke all on function public.edit_progress_log_with_evidence_result(bigint,text,bigint,bigint,jsonb) from public,anon;
grant execute on function public.edit_progress_log_with_evidence_result(bigint,text,bigint,bigint,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
