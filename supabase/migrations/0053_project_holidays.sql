Done
-- non-working weekdays (working_days, 0040_task_progress_tracking.sql).
-- A holiday counts exactly like a non-working weekday: it's left out of
-- Expected progress (Automatic Progress) and out of planned labor
-- (crew x working days). Set from the Edit Project form's own Holidays
-- calendar, saved together with working_days.
--
-- Run this AFTER 0052_progress_entry_notes.sql.

alter table public.projects
  add column if not exists holidays date[] not null default '{}';
