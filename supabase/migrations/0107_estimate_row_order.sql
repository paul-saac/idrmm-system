-- Intent: persist Gantt row ordering without changing task IDs, parents,
-- schedules, dependencies, saved progress, resources or cost calculations.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Null keeps existing ID order and appends newly created/imported rows.
alter table public.estimate_categories add column if not exists sort_order bigint;
alter table public.estimate_tasks add column if not exists sort_order bigint;
create index if not exists estimate_categories_order_idx
  on public.estimate_categories(project_id, sort_order, id);
create index if not exists estimate_tasks_order_idx
  on public.estimate_tasks(project_id, category_id, sort_order, id);

create or replace function public.move_estimate_row(
  p_project_id bigint, p_kind text, p_row_id bigint, p_target_id bigint, p_after boolean
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_ids bigint[];
  v_category_id bigint;
  v_position integer;
  v_updated integer;
begin
  if public.app_session_is_active() is not true or public.project_access_level(p_project_id) is distinct from 'edit' then
    raise exception 'Project editing is not permitted.' using errcode = '42501';
  end if;
  if public.system_backup_maintenance() then
    raise exception 'Saving is temporarily paused.' using errcode = '55000';
  end if;
  if p_kind is null or p_kind not in ('category', 'task') or p_row_id is null
    or p_target_id is null or p_row_id <= 0 or p_target_id <= 0
    or p_row_id = p_target_id or p_after is null then
    raise exception 'Invalid row move.' using errcode = '22023';
  end if;

  -- Serialize concurrent drops against the current saved project order.
  perform 1 from public.projects where id = p_project_id for update;
  if not found then raise exception 'Project is unavailable.' using errcode = '42501'; end if;
  if p_kind = 'category' then
    select array_agg(id order by sort_order nulls last, id) into v_ids
      from public.estimate_categories where project_id = p_project_id;
  else
    select category_id into v_category_id from public.estimate_tasks
      where id = p_row_id and project_id = p_project_id;
    select array_agg(id order by sort_order nulls last, id) into v_ids
      from public.estimate_tasks where project_id = p_project_id and category_id = v_category_id;
  end if;
  if array_position(v_ids, p_row_id) is null or array_position(v_ids, p_target_id) is null then
    raise exception 'Both rows must belong to the same project and sibling group.' using errcode = '22023';
  end if;
  v_ids := array_remove(v_ids, p_row_id);
  v_position := array_position(v_ids, p_target_id) + case when p_after then 1 else 0 end;
  v_ids := coalesce(v_ids[1:v_position-1], '{}'::bigint[]) || array[p_row_id]
    || coalesce(v_ids[v_position:cardinality(v_ids)], '{}'::bigint[]);

  if p_kind = 'category' then
    update public.estimate_categories c set sort_order = r.position
      from unnest(v_ids) with ordinality r(id, position)
      where c.id = r.id and c.project_id = p_project_id;
  else
    update public.estimate_tasks t set sort_order = r.position
      from unnest(v_ids) with ordinality r(id, position)
      where t.id = r.id and t.project_id = p_project_id and t.category_id = v_category_id;
  end if;
  get diagnostics v_updated = row_count;
  if v_updated <> cardinality(v_ids) then
    raise exception 'Not all rows could be reordered.' using errcode = '42501';
  end if;
  return jsonb_build_object('category_id', v_category_id, 'ids', v_ids);
end;
$$;
revoke all on function public.move_estimate_row(bigint,text,bigint,bigint,boolean) from public, anon;
grant execute on function public.move_estimate_row(bigint,text,bigint,bigint,boolean) to authenticated;
notify pgrst, 'reload schema';
commit;
