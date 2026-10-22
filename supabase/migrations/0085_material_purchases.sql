-- Material invoice lines are the purchase-expense source. Received quantities
-- feed stock monitoring; progress usage never creates a second expense.
begin;
create table if not exists public.material_purchases (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects(id) on delete cascade,
  batch_id uuid not null,
  line_number integer not null check (line_number > 0),
  purchase_date date not null,
  supplier text not null check (length(trim(supplier)) between 1 and 200),
  invoice_number text not null default '',
  material_name text not null check (length(trim(material_name)) between 1 and 200),
  unit text not null check (length(trim(unit)) between 1 and 40),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  received_quantity numeric(14,3) not null default 0 check (received_quantity >= 0 and received_quantity <= quantity),
  amount numeric generated always as (round(quantity * unit_price, 2)) stored,
  recorded_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(batch_id,line_number)
);
create index if not exists material_purchases_project on public.material_purchases(project_id,purchase_date);
alter table public.material_purchases enable row level security;
drop policy if exists "Project members read purchases" on public.material_purchases;
create policy "Project members read purchases" on public.material_purchases for select to authenticated
  using(public.invitation_setup_complete() and public.get_my_role() is not null
    and exists(select 1 from public.projects p where p.id=project_id));
drop policy if exists "Project members record purchases" on public.material_purchases;
create policy "Project members record purchases" on public.material_purchases for insert to authenticated
  with check(recorded_by=auth.uid() and public.invitation_setup_complete() and public.get_my_role() is not null
    and exists(select 1 from public.projects p where p.id=project_id));
drop policy if exists "Project members update receipts" on public.material_purchases;
create policy "Project members update receipts" on public.material_purchases for update to authenticated
  using(public.invitation_setup_complete() and public.get_my_role() is not null
    and exists(select 1 from public.projects p where p.id=project_id))
  with check(public.invitation_setup_complete() and public.get_my_role() is not null
    and exists(select 1 from public.projects p where p.id=project_id));
grant select,insert on public.material_purchases to authenticated;
revoke update,delete on public.material_purchases from authenticated;
grant update(received_quantity) on public.material_purchases to authenticated;
grant usage,select on sequence public.material_purchases_id_seq to authenticated;
commit;
