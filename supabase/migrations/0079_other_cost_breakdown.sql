-- Itemized planned Other costs for subtasks and standalone main tasks.
-- Preserve existing amounts; save all edited owners and totals atomically. dddd
begin;

alter table public.estimate_task_other_costs
  alter column task_id drop not null,
  add column if not exists category_id bigint references public.estimate_categories(id) on delete cascade,
  add column if not exists quantity numeric not null default 1,
  add column if not exists unit text,
  add column if not exists unit_cost numeric,
  add column if not exists amount_override numeric;

-- A null unit_cost also supports older task forms that insert only amount.
alter table public.estimate_task_other_costs
  drop constraint if exists other_cost_single_owner;
alter table public.estimate_task_other_costs
  add constraint other_cost_single_owner check (num_nonnulls(task_id, category_id) = 1);
create index if not exists estimate_other_costs_category_idx
  on public.estimate_task_other_costs(category_id);

drop policy if exists "Foremen manage category other costs" on public.estimate_task_other_costs;
create policy "Foremen manage category other costs" on public.estimate_task_other_costs
  for all to authenticated
  using (public.is_category_foreman(category_id))
  with check (public.is_category_foreman(category_id));

create or replace function public.save_other_cost_breakdown(p_project_id bigint, p_changes jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare
  owner jsonb;
  line jsonb;
  owner_id bigint;
  owner_kind text;
  qty numeric;
  rate numeric;
  override_amount numeric;
  line_amount numeric;
  total numeric;
begin
  if auth.uid() is null or not coalesce(
    public.get_my_role() = 'admin' or public.is_project_foreman(p_project_id), false
  ) then
    raise exception 'Not authorized to manage these estimates.';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'array' then
    raise exception 'Invalid other cost changes.';
  end if;
  -- Serialize breakdown saves for this project.
  perform id from public.projects where id = p_project_id for update;
  if not found then raise exception 'Project not found.'; end if;
  for owner in select value from jsonb_array_elements(p_changes) loop
    owner_id := (owner->>'id')::bigint;
    owner_kind := owner->>'kind';
    if owner_kind = 'task' then
      perform id from public.estimate_tasks
        where id = owner_id and project_id = p_project_id for update;
      if not found then raise exception 'Task does not belong to this project.'; end if;
    elsif owner_kind = 'category' then
      perform id from public.estimate_categories
        where id = owner_id and project_id = p_project_id for update;
      if not found then raise exception 'Main task does not belong to this project.'; end if;
      if exists(select 1 from public.estimate_tasks where category_id = owner_id) then
        raise exception 'Main tasks with subtasks use their subtasks totals.';
      end if;
    else
      raise exception 'Invalid cost owner.';
    end if;
    if jsonb_typeof(owner->'lines') is distinct from 'array' then
      raise exception 'Invalid cost lines.';
    end if;
    delete from public.estimate_task_other_costs
      where (owner_kind = 'task' and task_id = owner_id)
         or (owner_kind = 'category' and category_id = owner_id);
    total := 0;
    for line in select value from jsonb_array_elements(owner->'lines') loop
      qty := (line->>'quantity')::numeric;
      rate := (line->>'unitCost')::numeric;
      override_amount := (line->>'amountOverride')::numeric;
      if nullif(trim(line->>'costName'), '') is null
        or qty is null or rate is null
        or not (qty >= 0 and qty < 1e12 and rate >= 0 and rate < 1e12)
        or (override_amount is not null and not (override_amount >= 0 and override_amount < 1e15))
      then raise exception 'Enter a cost name and valid nonnegative quantities and costs.'; end if;
      line_amount := round(coalesce(override_amount, qty * rate), 2);
      total := total + line_amount;
      insert into public.estimate_task_other_costs
        (task_id, category_id, cost_name, quantity, unit, unit_cost, amount_override, amount)
      values
        (case when owner_kind = 'task' then owner_id end,
         case when owner_kind = 'category' then owner_id end,
         trim(line->>'costName'), qty, nullif(trim(line->>'unit'), ''), rate, override_amount, line_amount);
    end loop;
    if owner_kind = 'task' then
      update public.estimate_tasks set other_cost_estimate = total,
        total_estimate_cost = coalesce(labor_estimate, 0) + coalesce(material_estimate, 0)
          + coalesce(equipment_estimate, 0) + total
        where id = owner_id and project_id = p_project_id;
    else
      update public.estimate_categories set category_other_estimate = total
        where id = owner_id and project_id = p_project_id;
    end if;
  end loop;
end;
$$;
revoke all on function public.save_other_cost_breakdown(bigint, jsonb) from public, anon;
grant execute on function public.save_other_cost_breakdown(bigint, jsonb) to authenticated;
commit;
