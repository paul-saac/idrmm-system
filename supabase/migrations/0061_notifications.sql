-- In-app notifications (the bell beside Log out). One kind for now: a DDD
-- progress override — someone saving a day's Daily Progress Update on a
-- task or a task-less phase — sent to every admin plus the project's own
-- foreman and project manager, except whoever saved it. Written by
-- triggers on the progress entry tables, so however an entry is saved,
-- it notifies.
--
-- Names are kept on the row as they were (actor, item, project) rather
-- than joined at read time: a recipient may not be allowed to read the
-- actor's profile, and a renamed or deleted task shouldn't blank old
-- notifications.
--
-- Run this AFTER 0060_team_member_details.sql.

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text,
  kind text not null default 'progress_override' check (kind in ('progress_override')),
  project_id bigint not null references public.projects (id) on delete cascade,
  project_name text not null,
  item_kind text not null check (item_kind in ('task', 'category')),
  item_id bigint not null,
  item_name text not null,
  entry_date date not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_recipient
  on public.notifications (recipient_id, created_at desc);

alter table public.notifications enable row level security;

-- Each user sees, marks read and clears only their own. No insert policy:
-- only the trigger below (security definer) writes them.
drop policy if exists "Users can view their notifications" on public.notifications;
create policy "Users can view their notifications" on public.notifications
  for select using (recipient_id = auth.uid());
drop policy if exists "Users can update their notifications" on public.notifications;
create policy "Users can update their notifications" on public.notifications
  for update using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
drop policy if exists "Users can delete their notifications" on public.notifications;
create policy "Users can delete their notifications" on public.notifications
  for delete using (recipient_id = auth.uid());

-- tg_argv[0] is 'task' or 'category' — which entry table fired it.
create or replace function public.notify_progress_override()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text := tg_argv[0];
  v_item_id bigint := (to_jsonb(new) ->> (tg_argv[0] || '_id'))::bigint;
  v_actor uuid := coalesce(new.recorded_by, auth.uid());
  v_actor_name text;
  v_item_name text;
  v_project_id bigint;
  v_project_name text;
  v_foreman uuid;
  v_manager uuid;
begin
  if v_kind = 'task' then
    select task_name, project_id into v_item_name, v_project_id
    from estimate_tasks where id = v_item_id;
  else
    select category_name, project_id into v_item_name, v_project_id
    from estimate_categories where id = v_item_id;
  end if;
  if v_project_id is null then
    return new;
  end if;

  select project_name, foreman_id, project_manager_id
    into v_project_name, v_foreman, v_manager
  from projects where id = v_project_id;

  select nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
    into v_actor_name
  from profiles where id = v_actor;

  -- One per item and day: saving the same day again replaces whatever's
  -- still unread from the earlier save instead of piling up.
  delete from notifications
  where kind = 'progress_override'
    and item_kind = v_kind
    and item_id = v_item_id
    and entry_date = new.entry_date
    and read_at is null;

  insert into notifications (
    recipient_id, actor_id, actor_name, project_id, project_name,
    item_kind, item_id, item_name, entry_date
  )
  select r.id, v_actor, v_actor_name, v_project_id, v_project_name,
         v_kind, v_item_id, v_item_name, new.entry_date
  from profiles r
  where (r.role = 'admin' or r.id = v_foreman or r.id = v_manager)
    and r.id is distinct from v_actor;

  return new;
end;
$$;

drop trigger if exists task_progress_entries_notify on public.task_progress_entries;
create trigger task_progress_entries_notify
  after insert or update on public.task_progress_entries
  for each row execute function public.notify_progress_override('task');

drop trigger if exists category_progress_entries_notify on public.category_progress_entries;
create trigger category_progress_entries_notify
  after insert or update on public.category_progress_entries
  for each row execute function public.notify_progress_override('category');

-- Live updates for the bell (Supabase Realtime).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
