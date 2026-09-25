-- Gives a category (phase) its own persisted planned start/end date —
-- used only while it has no tasks yet. A phase with tasks already has a
-- real schedule: its own start/end is the rollup (earliest task start /
-- latest task end, see gantt-chart-view.tsx's own `tasks` useMemo), and
-- stays that way, locked in the Gantt Chart's own UI, exactly as before.
-- But an empty phase's date range was only ever an in-memory placeholder
-- (today/today, recomputed fresh on every render, never saved) with no
-- way to actually set it — this is what makes that range real and
-- editable instead, the same way a standalone task's own dates are.
--
-- Run this AFTER 0043_amount_overrides.sql.

alter table public.estimate_categories
  add column if not exists planned_start_date date,
  add column if not exists planned_end_date date;
