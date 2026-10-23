-- Intent: record project-scoped punch-list findings, corrective work, evidence,
-- and verification so Reports can generate a traceable punch-list document.
begin;

create table if not exists public.project_punch_items (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  description text not null default '' check (length(description) <= 5000),
  area text not null default '' check (length(area) <= 120),
  specific_location text not null default '' check (length(specific_location) <= 500),
  related_work_key text not null default '' check (length(related_work_key) <= 80),
  related_work_name text not null default '' check (length(related_work_name) <= 200),
  issue_type text not null check (issue_type in ('incomplete','defective','damaged','plan_deviation','cleanup','safety')),
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  status text not null default 'open' check (status in ('open','closed','in_progress','ready_for_inspection','resolved','reopened')),
  responsible_trade text not null default '' check (length(responsible_trade) <= 200),
  assigned_to uuid references public.profiles(id) on delete set null,
  identified_on date not null default current_date,
  due_date date,
  correction_notes text not null default '' check (length(correction_notes) <= 5000),
  verification_notes text not null default '' check (length(verification_notes) <= 5000),
  before_photo_url text not null default '',
  before_photo_path text not null default '',
  after_photo_url text not null default '',
  after_photo_path text not null default '',
  identified_by uuid not null default auth.uid() references public.profiles(id),
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date is null or due_date >= identified_on)
);

create index if not exists project_punch_items_project_status
  on public.project_punch_items(project_id, status, identified_on desc);

create or replace function public.stamp_project_punch_item()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.project_id <> old.project_id then
    raise exception 'A punch-list item cannot be moved to another project';
  end if;
  new.updated_at := now();
  if (new.status in ('resolved', 'closed')) and (tg_op = 'INSERT' or old.status not in ('resolved', 'closed')) then
    new.resolved_at := now();
    new.verified_at := now();
    new.verified_by := auth.uid();
  elsif new.status not in ('resolved', 'closed') then
    new.resolved_at := null;
    new.verified_at := null;
    new.verified_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_project_punch_item on public.project_punch_items;
create trigger stamp_project_punch_item
  before insert or update on public.project_punch_items
  for each row execute function public.stamp_project_punch_item();

alter table public.project_punch_items enable row level security;
grant select, insert, update on public.project_punch_items to authenticated;

drop policy if exists "Project members read punch items" on public.project_punch_items;
create policy "Project members read punch items" on public.project_punch_items
  for select to authenticated using (
    public.invitation_setup_complete() and (
      public.get_my_role() in ('admin','super_admin')
      or public.is_project_foreman(project_id)
      or exists (
        select 1 from public.projects p
        where p.id = project_id and p.project_manager_id = auth.uid()
      )
    )
  );

drop policy if exists "Project members create punch items" on public.project_punch_items;
create policy "Project members create punch items" on public.project_punch_items
  for insert to authenticated with check (
    identified_by = auth.uid() and public.invitation_setup_complete() and (
      public.get_my_role() in ('admin','super_admin')
      or public.is_project_foreman(project_id)
      or exists (
        select 1 from public.projects p
        where p.id = project_id and p.project_manager_id = auth.uid()
      )
    )
  );

drop policy if exists "Project members update punch items" on public.project_punch_items;
create policy "Project members update punch items" on public.project_punch_items
  for update to authenticated using (
    public.invitation_setup_complete() and (
      public.get_my_role() in ('admin','super_admin')
      or public.is_project_foreman(project_id)
      or exists (
        select 1 from public.projects p
        where p.id = project_id and p.project_manager_id = auth.uid()
      )
    )
  ) with check (
    public.invitation_setup_complete() and (
      public.get_my_role() in ('admin','super_admin')
      or public.is_project_foreman(project_id)
      or exists (
        select 1 from public.projects p
        where p.id = project_id and p.project_manager_id = auth.uid()
      )
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('punch-list-evidence', 'punch-list-evidence', true, 10485760,
  array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

drop policy if exists "Public view punch list evidence" on storage.objects;
create policy "Public view punch list evidence" on storage.objects
  for select to public using (bucket_id = 'punch-list-evidence');
drop policy if exists "Authenticated upload punch list evidence" on storage.objects;
create policy "Authenticated upload punch list evidence" on storage.objects
  for insert to authenticated with check (bucket_id = 'punch-list-evidence');

commit;
