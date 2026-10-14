-- Daily Progress Update: why a day went the way it did.
--
--   issue   — an optional quick pick of what held work up that day, so
--             delays can be counted by cause later (e.g. "5 weather
--             delays this month"). Null means no issue.
--   remarks — free text from the site ("rain after 1pm, stopped pouring").
--
-- quantity_completed (0040/0048) is used again as the main progress input
-- for any task with a planned quantity, so it isn't touched here.
--
-- Run this AFTER 0051_foreman_project_access.sql.

alter table public.task_progress_entries
  add column if not exists issue text,
  add column if not exists remarks text;

alter table public.category_progress_entries
  add column if not exists issue text,
  add column if not exists remarks text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'task_progress_entries_issue_check'
  ) then
    alter table public.task_progress_entries
      add constraint task_progress_entries_issue_check
      check (issue is null or issue in (
        'weather', 'materials_late', 'equipment_breakdown', 'manpower_shortage', 'other'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'category_progress_entries_issue_check'
  ) then
    alter table public.category_progress_entries
      add constraint category_progress_entries_issue_check
      check (issue is null or issue in (
        'weather', 'materials_late', 'equipment_breakdown', 'manpower_shortage', 'other'
      ));
  end if;
end $$;
