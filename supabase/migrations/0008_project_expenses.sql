-- ============================================================================
-- Project expenses: a single ledger for actual recorded costs, with a
-- category column rather than four separate tables — this mirrors how
-- estimate_tasks (0004) already splits labor/material/equipment/other
-- into four parallel numbers, so estimated vs. actual costs stay
-- directly comparable side by side. Not built in the app UI yet.
--
-- material_usage/equipment_usage rows (0006/0007) can also carry a cost;
-- once the app is ready to compute totals, it's reasonable to have those
-- feed into this ledger too, or just be summed alongside it — that's an
-- app-level decision to make when this feature is actually built.
--
-- Run this AFTER 0007_equipment.sql.
-- ============================================================================

create table if not exists public.project_expenses (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id) on delete cascade,
  task_id bigint references public.estimate_tasks (id) on delete set null,
  category text not null check (category in ('labor', 'material', 'equipment', 'other')),
  description text,
  amount numeric not null default 0,
  expense_date date not null default current_date,
  recorded_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists idx_project_expenses_project_id on public.project_expenses (project_id);
create index if not exists idx_project_expenses_task_id on public.project_expenses (task_id);
create index if not exists idx_project_expenses_category on public.project_expenses (category);

alter table public.project_expenses enable row level security;

drop policy if exists "Admins can view project expenses" on public.project_expenses;
create policy "Admins can view project expenses" on public.project_expenses
  for select using (public.get_my_role() = 'admin');
drop policy if exists "Admins can create project expenses" on public.project_expenses;
create policy "Admins can create project expenses" on public.project_expenses
  for insert with check (public.get_my_role() = 'admin');
drop policy if exists "Admins can update project expenses" on public.project_expenses;
create policy "Admins can update project expenses" on public.project_expenses
  for update using (public.get_my_role() = 'admin');
drop policy if exists "Admins can delete project expenses" on public.project_expenses;
create policy "Admins can delete project expenses" on public.project_expenses
  for delete using (public.get_my_role() = 'admin');
