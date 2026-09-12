-- ============================================================================
-- Drops daily_log_progress — dead schema. It was created in 0005 for an
-- earlier progress-tracking design (a task's completion typed directly
-- as a percentage), before Work Logs (0010) was actually built with a
-- different, real model: "Quantity Completed" logged per task per day,
-- compared against the task's estimated_quantity. Nothing in the app
-- ever wrote to daily_log_progress, so any project's Progress Overview
-- stayed stuck at 0% no matter how many daily logs were approved — this
-- was the actual bug, not anything about approval status.
--
-- lib/progress/data.ts now reads daily_log_work_items instead, so this
-- table has no remaining purpose.
--
-- Run this AFTER 0011_daily_log_survey.sql.
-- ============================================================================

drop table if exists public.daily_log_progress;
