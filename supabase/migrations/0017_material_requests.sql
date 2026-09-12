-- ============================================================================
-- material_requests / material_request_items: the Materials tab's
-- "Material Requests" sub-tab — a Foreman-submitted request for one or
-- more material line items on a project, which an admin then approves,
-- cancels, or edits (including recording how much of each item has
-- actually been fulfilled).
--
-- Two-table shape, same header/line-items split as cost estimates
-- (0004) and daily logs (0005 + 0010/0013/0015): material_requests is
-- the header (who/when/status), material_request_items is one row per
-- requested material. Item fields are denormalized (material_name,
-- specification, uom stored directly) rather than pointing at the
-- materials catalog (0006) or project_materials (0014) — a request is
-- often for something not stocked yet, so it must stand on its own.
--
-- status is the overall request's workflow state:
--   submitted   -> just created, awaiting admin review
--   approved    -> admin approved, nothing issued against it yet
--   partially_fulfilled / fulfilled -> derived from how much of each
--     item's quantity_needed has been covered by quantity_fulfilled
--     (see recomputeMaterialRequestStatus in lib/material-requests/
--     actions.ts) — not set directly by an action
--   canceled    -> terminal, set explicitly by an admin
--
-- Run this AFTER 0016_equipment_inventory_fixup.sql.
-- ============================================================================

create table if not exists public.material_requests (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id) on delete cascade,
  mr_no text not null,
  requested_by uuid not null references public.profiles (id) on delete restrict,
  request_date timestamptz not null default now(),
  date_required date,
  -- Routine/Urgent/Emergency, the standard construction work-order/
  -- procurement priority scale (routine = can be scheduled/planned;
  -- urgent = needed soon to avoid impairing progress; emergency =
  -- addresses an unforeseen/safety-critical condition) rather than a
  -- generic Normal/Urgent toggle.
  priority text not null default 'routine'
    check (priority in ('routine', 'urgent', 'emergency')),
  remarks text,
  status text not null default 'submitted'
    check (status in ('submitted', 'approved', 'partially_fulfilled', 'fulfilled', 'canceled')),
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, mr_no)
);

create table if not exists public.material_request_items (
  id bigint generated always as identity primary key,
  material_request_id bigint not null references public.material_requests (id) on delete cascade,
  material_name text not null,
  specification text,
  quantity_needed numeric not null default 0,
  uom text,
  purpose text,
  quantity_fulfilled numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_material_requests_project_id
  on public.material_requests (project_id);
create index if not exists idx_material_requests_status
  on public.material_requests (status);
create index if not exists idx_material_request_items_request_id
  on public.material_request_items (material_request_id);

alter table public.material_requests enable row level security;
alter table public.material_request_items enable row level security;

-- Admin-only for now, same caveat as every other Materials/Progress
-- table: a Foreman-scoped policy (submit/view own project's requests)
-- belongs here once the Foreman portal exists to check the access
-- pattern against.
drop policy if exists "Admins can view material requests" on public.material_requests;
create policy "Admins can view material requests" on public.material_requests
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create material requests" on public.material_requests;
create policy "Admins can create material requests" on public.material_requests
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can update material requests" on public.material_requests;
create policy "Admins can update material requests" on public.material_requests
  for update using (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete material requests" on public.material_requests;
create policy "Admins can delete material requests" on public.material_requests
  for delete using (public.get_my_role() = 'admin');

drop policy if exists "Admins can view material request items" on public.material_request_items;
create policy "Admins can view material request items" on public.material_request_items
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create material request items" on public.material_request_items;
create policy "Admins can create material request items" on public.material_request_items
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can update material request items" on public.material_request_items;
create policy "Admins can update material request items" on public.material_request_items
  for update using (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete material request items" on public.material_request_items;
create policy "Admins can delete material request items" on public.material_request_items
  for delete using (public.get_my_role() = 'admin');

drop trigger if exists set_material_requests_updated_at on public.material_requests;
create trigger set_material_requests_updated_at
  before update on public.material_requests
  for each row execute function public.set_updated_at();
