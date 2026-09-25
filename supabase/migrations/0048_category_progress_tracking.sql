DONEEE
-- 0040_task_progress_tracking.sql gave tasks, one level up, for a
-- task-less "standalone" category (e.g. "MOBILIZATION" with nothing
-- broken out under it yet). Per an explicit request: such a category
-- now acts exactly like a regular task everywhere else in the Gantt
-- Chart (its own draggable bar, Labor Percentage, Assign, Priority —
-- see 0047_category_labor_estimate.sql and gantt-chart-view.tsx's own
-- doc comment on categoryById/isProject), so clicking its own bar
-- should open the same Progress Tracking Override a task's bar does,
-- not do nothing.
--
-- Deliberately a SEPARATE pair of tables from task_progress_entries/
-- task_progress_material_usage, not a nullable dual-FK on the same
-- ones — same "give category its own X, one level up, in its own
-- table" convention every other category feature this session already
-- follows (category_worker_assignments vs task_worker_assignments,
-- category_labor_estimate vs labor_estimate, etc.).
--
-- Only ever meaningful for a category with no tasks yet — once it has
-- any, its own percent complete goes back to being a rollup of theirs
-- (see percentCompleteByCategoryId's own doc comment), same asymmetric
-- rule Start/End/Labor Percentage already use one level up.
--
-- Run this AFTER 0047_category_labor_estimate.sql.
-- ============================================================================

alter table public.estimate_categories
  add column if not exists estimated_quantity numeric,
  add column if not exists unit text;

create table if not exists public.category_progress_entries (
  id bigint generated always as identity primary key,
  category_id bigint not null references public.estimate_categories (id) on delete cascade,
  -- Same "always today, unique per category/day" shape as
  -- task_progress_entries.entry_date — see that column's own comment.
  entry_date date not null,
  quantity_completed numeric not null default 0,
  labor_headcount integer not null default 0 check (labor_headcount >= 0),
  recorded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (category_id, entry_date)
);

create index if not exists idx_category_progress_entries_category_id
  on public.category_progress_entries (category_id);

create table if not exists public.category_progress_material_usage (
  id bigint generated always as identity primary key,
  progress_entry_id bigint not null references public.category_progress_entries (id) on delete cascade,
  material_id bigint not null references public.project_materials (id) on delete cascade,
  quantity numeric not null default 0 check (quantity >= 0)
);

create index if not exists idx_category_progress_material_usage_entry_id
  on public.category_progress_material_usage (progress_entry_id);

alter table public.category_progress_entries enable row level security;
alter table public.category_progress_material_usage enable row level security;

-- Admin-only, same convention as every other table — see
-- 0040_task_progress_tracking.sql for the exact policy set copied below.
drop policy if exists "Admins can view category progress entries" on public.category_progress_entries;
create policy "Admins can view category progress entries" on public.category_progress_entries
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create category progress entries" on public.category_progress_entries;
create policy "Admins can create category progress entries" on public.category_progress_entries
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can update category progress entries" on public.category_progress_entries;
create policy "Admins can update category progress entries" on public.category_progress_entries
  for update using (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete category progress entries" on public.category_progress_entries;
create policy "Admins can delete category progress entries" on public.category_progress_entries
  for delete using (public.get_my_role() = 'admin');

drop policy if exists "Admins can view category progress material usage" on public.category_progress_material_usage;
create policy "Admins can view category progress material usage" on public.category_progress_material_usage
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create category progress material usage" on public.category_progress_material_usage;
create policy "Admins can create category progress material usage" on public.category_progress_material_usage
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete category progress material usage" on public.category_progress_material_usage;
create policy "Admins can delete category progress material usage" on public.category_progress_material_usage
  for delete using (public.get_my_role() = 'admin');
