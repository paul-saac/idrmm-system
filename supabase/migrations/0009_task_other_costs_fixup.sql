-- ============================================================================
-- Replaces the per-project "other cost types" model with a proper
-- per-task one-to-many relationship: every task's "Other cost" line
-- items (e.g. "Permit Fee", "Delivery Fee") now live in their own table,
-- linked to that specific task, instead of a shared list on `projects`
-- and a jsonb blob on `estimate_tasks`.
--
-- This is a defensive fixup, safe to run whether or not you already ran
-- the older versions of 0003/0004 that had other_cost_types /
-- other_cost_breakdown — if you're setting up fresh and already ran the
-- current 0003/0004 (which no longer create those columns), every
-- statement here is a harmless no-op.
--
-- Run this AFTER 0008_project_expenses.sql.
-- ============================================================================

create table if not exists public.estimate_task_other_costs (
  id bigint generated always as identity primary key,
  task_id bigint not null references public.estimate_tasks (id) on delete cascade,
  cost_name text not null,
  amount numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_estimate_task_other_costs_task_id
  on public.estimate_task_other_costs (task_id);

alter table public.estimate_task_other_costs enable row level security;

drop policy if exists "Admins can view estimate task other costs" on public.estimate_task_other_costs;
create policy "Admins can view estimate task other costs" on public.estimate_task_other_costs
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create estimate task other costs" on public.estimate_task_other_costs;
create policy "Admins can create estimate task other costs" on public.estimate_task_other_costs
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can update estimate task other costs" on public.estimate_task_other_costs;
create policy "Admins can update estimate task other costs" on public.estimate_task_other_costs
  for update using (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete estimate task other costs" on public.estimate_task_other_costs;
create policy "Admins can delete estimate task other costs" on public.estimate_task_other_costs
  for delete using (public.get_my_role() = 'admin');

-- One-time migration of any data already sitting in the old jsonb blob,
-- so nothing typed in earlier gets silently lost. Written as dynamic SQL
-- inside a column-existence check — a *static* query referencing
-- other_cost_breakdown would fail to even parse on a database where
-- that column was never created (e.g. a fresh install that already ran
-- the current 0004), so the guard has to happen before the query is
-- built, not inside its WHERE clause.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'estimate_tasks'
      and column_name = 'other_cost_breakdown'
  ) then
    execute $sql$
      insert into public.estimate_task_other_costs (task_id, cost_name, amount)
      select t.id, entry.key, (entry.value)::numeric
      from public.estimate_tasks t,
        jsonb_each_text(
          case
            when jsonb_typeof(t.other_cost_breakdown) = 'object'
              then t.other_cost_breakdown
            else '{}'::jsonb
          end
        ) as entry
    $sql$;
  end if;
end $$;

alter table public.estimate_tasks drop column if exists other_cost_breakdown;
alter table public.projects drop column if exists other_cost_types;
