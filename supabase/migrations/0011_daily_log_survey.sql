-- ============================================================================
-- Adds the "Survey" section shown on the Daily Log detail view — three
-- fixed yes/no questions with an optional note each (accidents, schedule
-- delays, weather delays), stored directly on daily_logs rather than a
-- separate table since there's a fixed, small set of questions, not a
-- dynamic/growing list.
--
-- There's no submission UI for these yet (the Add Daily Log modal
-- doesn't have a Survey step) — the detail view shows "Not yet
-- recorded" until that's built, same as every other still-unbuilt log
-- type on that page.
--
-- Run this AFTER 0010_daily_log_work_items.sql.
-- ============================================================================

alter table public.daily_logs
  add column if not exists accidents_occurred boolean,
  add column if not exists accidents_notes text,
  add column if not exists schedule_delays_occurred boolean,
  add column if not exists schedule_delays_notes text,
  add column if not exists weather_delays_occurred boolean,
  add column if not exists weather_delays_notes text;
