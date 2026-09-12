-- ============================================================================
-- One daily log per project per date — the "site diary" model. A day's
-- log stays editable while it's pending or rejected (see updateDailyLog
-- in lib/daily-logs/actions.ts); an admin approving it is what locks it
-- and is the single point where its data takes effect (progress %,
-- material stock status, material request fulfillment). See the Edit
-- button gating in components/projects/daily-logs/daily-log-detail-view.tsx.
--
-- If this ALTER fails with a unique-violation, there are already
-- duplicate (project_id, log_date) rows from earlier testing. Find them
-- with:
--   select project_id, log_date, count(*)
--   from public.daily_logs group by 1, 2 having count(*) > 1;
-- then delete the extra rows before re-running.
--
-- Run this AFTER 0018_daily_log_material_procurement.sql.
-- ============================================================================

alter table public.daily_logs
  add constraint daily_logs_project_id_log_date_key
  unique (project_id, log_date);
