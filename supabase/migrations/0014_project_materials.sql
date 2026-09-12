-- ============================================================================
-- project_materials: the Materials Monitoring tab's "Material Record
-- Table" — one row per material line item a project is tracking on-hand
-- (Material ID/code, name, specification/size, quantity, unit, and a
-- manually-set stock status).
--
-- This is intentionally separate from the `materials` catalog (0006) —
-- that table is a shared, globally-unique name list ("Portland Cement"
-- named once for the whole app); this one is per-project inventory, so
-- the same material name can appear stocked on many projects at once.
-- Same denormalized-name convention as material_requests/material_usage
-- (0006): material_id links back to the catalog when the name matches
-- one, but material_name/specification/unit are stored directly so a
-- one-off item never needs a catalog entry first.
--
-- status is a manually-set field, not derived from quantity — the
-- reference design shows a material with quantity 1 marked "Fully
-- Consumed" while another with quantity 2 is "Low Stock", so there's no
-- single quantity threshold that explains both; whoever updates the
-- record picks the status directly.
--
-- Run this AFTER 0013_daily_log_labor_and_expense_items.sql.
-- ============================================================================

create table if not exists public.project_materials (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id) on delete cascade,
  material_id bigint references public.materials (id) on delete set null,
  material_code text not null,
  material_name text not null,
  specification text,
  quantity numeric not null default 0,
  unit text,
  status text not null default 'available'
    check (status in ('available', 'low_stock', 'fully_consumed')),
  recorded_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_materials_project_id
  on public.project_materials (project_id);
create index if not exists idx_project_materials_status
  on public.project_materials (status);

alter table public.project_materials enable row level security;

-- Admin-only for now, same caveat as every other Materials/Progress
-- table: a Foreman/PM-scoped policy belongs here once those dashboards
-- exist to check the access pattern against.
drop policy if exists "Admins can view project materials" on public.project_materials;
create policy "Admins can view project materials" on public.project_materials
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create project materials" on public.project_materials;
create policy "Admins can create project materials" on public.project_materials
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can update project materials" on public.project_materials;
create policy "Admins can update project materials" on public.project_materials
  for update using (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete project materials" on public.project_materials;
create policy "Admins can delete project materials" on public.project_materials
  for delete using (public.get_my_role() = 'admin');

drop trigger if exists set_project_materials_updated_at on public.project_materials;
create trigger set_project_materials_updated_at
  before update on public.project_materials
  for each row execute function public.set_updated_at();
