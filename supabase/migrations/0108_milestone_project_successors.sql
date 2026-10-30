-- Intent: let milestones choose a main task or subtask anywhere in the same
-- project, with atomic edits, existing access/session guards and cycle checks.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.estimate_categories add column if not exists predecessor_task_id bigint
  references public.estimate_tasks(id) on delete set null;
alter table public.estimate_tasks add column if not exists predecessor_category_id bigint
  references public.estimate_categories(id) on delete set null;
create index if not exists estimate_categories_predecessor_task_idx on public.estimate_categories(predecessor_task_id);
create index if not exists estimate_tasks_predecessor_category_idx on public.estimate_tasks(predecessor_category_id);

do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.estimate_categories'::regclass and conname='estimate_category_one_predecessor') then
    alter table public.estimate_categories add constraint estimate_category_one_predecessor
      check(num_nonnulls(predecessor_category_id,predecessor_task_id)<=1);
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.estimate_tasks'::regclass and conname='estimate_task_one_predecessor') then
    alter table public.estimate_tasks add constraint estimate_task_one_predecessor
      check(num_nonnulls(predecessor_category_id,predecessor_task_id)<=1);
  end if;
end $$;

create or replace function public.save_estimate_successor(
  p_project_id bigint, p_source_kind text, p_source_id bigint,
  p_successor_kind text, p_successor_id bigint,
  p_milestone boolean default null, p_name text default null
) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_milestone boolean;
  v_parent bigint;
  v_target_parent bigint;
  v_target_has_tasks boolean;
  v_source text;
  v_target text;
  v_cycle boolean;
  v_changed integer;
begin
  if public.app_session_is_active() is not true or public.project_access_level(p_project_id) is distinct from 'edit' then
    raise exception 'You do not have permission to edit this project.' using errcode='42501';
  end if;
  if public.system_backup_maintenance() then
    raise exception 'Saving is temporarily paused.' using errcode='55000';
  end if;
  if p_source_kind is null or p_source_kind not in ('category','task') or p_source_id is null or p_source_id<=0
    or num_nonnulls(p_successor_kind,p_successor_id)=1
    or (p_successor_kind is not null and (p_successor_kind not in ('category','task') or p_successor_id<=0)) then
    raise exception 'Select a valid successor task.' using errcode='22023';
  end if;
  perform 1 from public.projects where id=p_project_id for update;
  if not found then raise exception 'Project is unavailable.' using errcode='42501'; end if;
  if p_source_kind='category' then
    select is_milestone into v_milestone from public.estimate_categories where id=p_source_id and project_id=p_project_id;
    if not found then raise exception 'Main task is unavailable in this project.' using errcode='22023'; end if;
    if coalesce(p_milestone,v_milestone) and exists(select 1 from public.estimate_tasks where category_id=p_source_id and project_id=p_project_id) then
      raise exception 'A main task with subtasks cannot be a milestone.' using errcode='22023';
    end if;
    if p_name is not null and nullif(trim(p_name),'') is null then
      raise exception 'Task name is required.' using errcode='22023';
    end if;
  else
    select is_milestone,category_id into v_milestone,v_parent from public.estimate_tasks where id=p_source_id and project_id=p_project_id;
    if not found then raise exception 'Task is unavailable in this project.' using errcode='22023'; end if;
  end if;
  v_milestone:=coalesce(p_milestone,v_milestone);
  v_source:=p_source_kind||':'||p_source_id;
  if p_successor_id is not null then
    v_target:=p_successor_kind||':'||p_successor_id;
    if v_source=v_target then raise exception 'A task cannot be its own successor.' using errcode='22023'; end if;
    if p_successor_kind='category' then
      perform 1 from public.estimate_categories where id=p_successor_id and project_id=p_project_id;
      if not found then raise exception 'Successor must be in the same project.' using errcode='22023'; end if;
      v_target_has_tasks:=exists(select 1 from public.estimate_tasks where category_id=p_successor_id and project_id=p_project_id);
    else
      select category_id into v_target_parent from public.estimate_tasks where id=p_successor_id and project_id=p_project_id;
      if not found then raise exception 'Successor must be in the same project.' using errcode='22023'; end if;
    end if;
    if not v_milestone and not (
      (p_source_kind='category' and p_successor_kind='category' and not v_target_has_tasks)
      or (p_source_kind='task' and p_successor_kind='task' and v_parent=v_target_parent)
    ) then
      raise exception 'Only milestones can choose successors outside their task group.' using errcode='22023';
    end if;

    -- Remove the old outgoing/target links from this check: they will be
    -- replaced below. Parent -> child edges also prevent a child milestone
    -- making its own containing group start after itself.
    with recursive links as (
      select coalesce('category:'||predecessor_category_id,'task:'||predecessor_task_id) as source,'category:'||id as target
        from public.estimate_categories where project_id=p_project_id and num_nonnulls(predecessor_category_id,predecessor_task_id)>0
      union all
      select coalesce('task:'||predecessor_task_id,'category:'||predecessor_category_id),'task:'||id
        from public.estimate_tasks where project_id=p_project_id and num_nonnulls(predecessor_category_id,predecessor_task_id)>0
    ), edges as (
      select source,target from links where source<>v_source and target<>v_target
      union all select 'category:'||category_id,'task:'||id from public.estimate_tasks where project_id=p_project_id
    ), reachable(node) as (
      select v_target union select edges.target from edges join reachable on edges.source=reachable.node
    ) select exists(select 1 from reachable where node=v_source) into v_cycle;
    if v_cycle then raise exception 'This successor would create a circular dependency.' using errcode='22023'; end if;
  end if;

  if p_source_kind='category' then
    update public.estimate_categories set is_milestone=v_milestone,category_name=coalesce(trim(p_name),category_name)
      where id=p_source_id and project_id=p_project_id;
  else
    update public.estimate_tasks set is_milestone=v_milestone where id=p_source_id and project_id=p_project_id;
  end if;
  get diagnostics v_changed=row_count;
  if v_changed<>1 then raise exception 'Task editing was denied.' using errcode='42501'; end if;
  if p_source_kind='category' then
    update public.estimate_categories set predecessor_category_id=null where predecessor_category_id=p_source_id and project_id=p_project_id;
    update public.estimate_tasks set predecessor_category_id=null where predecessor_category_id=p_source_id and project_id=p_project_id;
  else
    update public.estimate_categories set predecessor_task_id=null where predecessor_task_id=p_source_id and project_id=p_project_id;
    update public.estimate_tasks set predecessor_task_id=null where predecessor_task_id=p_source_id and project_id=p_project_id;
  end if;
  if p_successor_id is not null then
    if p_successor_kind='category' then
      update public.estimate_categories set predecessor_task_id=case when p_source_kind='task' then p_source_id end,
        predecessor_category_id=case when p_source_kind='category' then p_source_id end
        where id=p_successor_id and project_id=p_project_id;
    else
      update public.estimate_tasks set predecessor_task_id=case when p_source_kind='task' then p_source_id end,
        predecessor_category_id=case when p_source_kind='category' then p_source_id end
        where id=p_successor_id and project_id=p_project_id;
    end if;
    get diagnostics v_changed=row_count;
    if v_changed<>1 then raise exception 'Successor editing was denied.' using errcode='42501'; end if;
  end if;
end;
$$;
revoke all on function public.save_estimate_successor(bigint,text,bigint,text,bigint,boolean,text) from public,anon;
grant execute on function public.save_estimate_successor(bigint,text,bigint,text,bigint,boolean,text) to authenticated;
notify pgrst,'reload schema';
commit;
