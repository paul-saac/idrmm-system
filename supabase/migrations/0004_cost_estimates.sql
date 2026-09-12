-- ============================================================================
-- Cost Estimate Breakdown: Category -> Task Item, two levels (there's
-- deliberately no third "cost item" table — see the app's
-- lib/cost-estimate/ for why).
--
-- total_estimate_cost and weight on both tables are NEVER user-entered —
-- the app computes and writes them every time a task is created, edited,
-- or deleted, since one task's total shifts every other task's
-- percentage of the project. This is what progress tracking (0005)
-- reads to weight each task's contribution to overall project completion.
--
-- Run this AFTER 0003_projects.sql.
-- ============================================================================

create table if not exists public.estimate_categories (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id) on delete cascade,
  category_name text not null,
  weight numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_estimate_categories_project_id
  on public.estimate_categories (project_id);

create table if not exists public.estimate_tasks (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id) on delete cascade,
  category_id bigint not null references public.estimate_categories (id) on delete cascade,
  task_name text not null,

  estimated_quantity numeric not null default 0,
  unit text,

  labor_estimate numeric not null default 0,
  material_estimate numeric not null default 0,
  equipment_estimate numeric not null default 0,
  -- Sum of this task's estimate_task_other_costs rows below — maintained
  -- by the app on every write, same as total_estimate_cost/weight.
  other_cost_estimate numeric not null default 0,

  total_estimate_cost numeric not null default 0,
  weight numeric not null default 0,

  created_at timestamptz not null default now()
);

create index if not exists idx_estimate_tasks_project_id on public.estimate_tasks (project_id);
create index if not exists idx_estimate_tasks_category_id on public.estimate_tasks (category_id);

-- Each task's freely-added "Other cost" line items (e.g. one task might
-- have "Permit Fee" + "Delivery Fee", another none at all, another a
-- completely different set) — a proper one-to-many relationship rather
-- than a jsonb blob or fixed columns, since every task's set of other
-- costs is independent of every other task's.
create table if not exists public.estimate_task_other_costs (
  id bigint generated always as identity primary key,
  task_id bigint not null references public.estimate_tasks (id) on delete cascade,
  cost_name text not null,
  amount numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_estimate_task_other_costs_task_id
  on public.estimate_task_other_costs (task_id);

alter table public.estimate_categories enable row level security;
alter table public.estimate_tasks enable row level security;
alter table public.estimate_task_other_costs enable row level security;

drop policy if exists "Admins can view estimate categories" on public.estimate_categories;
create policy "Admins can view estimate categories" on public.estimate_categories
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create estimate categories" on public.estimate_categories;
create policy "Admins can create estimate categories" on public.estimate_categories
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can update estimate categories" on public.estimate_categories;
create policy "Admins can update estimate categories" on public.estimate_categories
  for update using (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete estimate categories" on public.estimate_categories;
create policy "Admins can delete estimate categories" on public.estimate_categories
  for delete using (public.get_my_role() = 'admin');

drop policy if exists "Admins can view estimate tasks" on public.estimate_tasks;
create policy "Admins can view estimate tasks" on public.estimate_tasks
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create estimate tasks" on public.estimate_tasks;
create policy "Admins can create estimate tasks" on public.estimate_tasks
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can update estimate tasks" on public.estimate_tasks;
create policy "Admins can update estimate tasks" on public.estimate_tasks
  for update using (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete estimate tasks" on public.estimate_tasks;
create policy "Admins can delete estimate tasks" on public.estimate_tasks
  for delete using (public.get_my_role() = 'admin');

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
