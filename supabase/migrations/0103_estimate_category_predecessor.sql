-- Intent: allow standalone main tasks (estimate_categories without subtasks)
-- to store a Finish-to-Start predecessor category link, matching estimate_tasks.predecessor_task_id.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.estimate_categories
  add column if not exists predecessor_category_id bigint
    references public.estimate_categories(id) on delete set null;

create index if not exists idx_estimate_categories_predecessor_category_id
  on public.estimate_categories (predecessor_category_id);

notify pgrst, 'reload schema';
commit;

