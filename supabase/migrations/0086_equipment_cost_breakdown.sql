-- Itemized, directly entered planned equipment amounts. No depreciation,
-- rental billing or actual expense creation. Legacy totals remain intact.
begin;
alter table public.estimate_tasks add column if not exists equipment_cost_items jsonb not null default '[]';
alter table public.estimate_categories add column if not exists equipment_cost_items jsonb not null default '[]';
create or replace function public.save_equipment_cost_breakdown(p_project_id bigint,p_changes jsonb)
returns void language plpgsql security invoker set search_path=public as $$
declare owner jsonb; line jsonb; owner_id bigint; total numeric; amount numeric; items jsonb; n integer;
begin
  if auth.uid() is null or not coalesce(public.get_my_role()='admin' or public.is_project_foreman(p_project_id),false) then
    raise exception 'Not authorized to manage these estimates.';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'array' then raise exception 'Invalid equipment changes.'; end if;
  perform id from public.projects where id=p_project_id for update;
  if not found then raise exception 'Project not found.'; end if;
  for owner in select value from jsonb_array_elements(p_changes) loop
    owner_id:=(owner->>'id')::bigint;
    if owner->>'kind'='task' then
      perform id from public.estimate_tasks where id=owner_id and project_id=p_project_id for update;
      if not found then raise exception 'Task does not belong to project.'; end if;
    elsif owner->>'kind'='category' then
      perform id from public.estimate_categories where id=owner_id and project_id=p_project_id for update;
      if not found then raise exception 'Category does not belong to project.'; end if;
      if exists(select 1 from public.estimate_tasks where category_id=owner_id) then raise exception 'Enter equipment under subtasks.'; end if;
    else raise exception 'Invalid owner.'; end if;
    if jsonb_typeof(owner->'lines') is distinct from 'array' then raise exception 'Invalid equipment lines.'; end if;
    total:=0; items:='[]'; n:=0;
    for line in select value from jsonb_array_elements(owner->'lines') loop
      amount:=(line->>'amountOverride')::numeric;
      if nullif(trim(line->>'costName'),'') is null or length(line->>'costName')>200
        or amount is null or not(amount>=0 and amount<1e15) then raise exception 'Enter an equipment description and nonnegative planned amount.'; end if;
      amount:=round(amount,2); total:=total+amount; n:=n+1;
      items:=items || jsonb_build_array(jsonb_build_object('id',n,'costName',trim(line->>'costName'),'amount',amount));
    end loop;
    if owner->>'kind'='task' then
      update public.estimate_tasks set equipment_cost_items=items,equipment_estimate=total,
        total_estimate_cost=coalesce(labor_estimate,0)+coalesce(material_estimate,0)+coalesce(other_cost_estimate,0)+total
        where id=owner_id and project_id=p_project_id;
    else
      update public.estimate_categories set equipment_cost_items=items,category_equipment_estimate=total
        where id=owner_id and project_id=p_project_id;
    end if;
  end loop;
end;
$$;
revoke all on function public.save_equipment_cost_breakdown(bigint,jsonb) from public,anon;
grant execute on function public.save_equipment_cost_breakdown(bigint,jsonb) to authenticated;
commit;
