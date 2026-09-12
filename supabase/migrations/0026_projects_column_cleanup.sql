-- ============================================================================
-- Drops five columns on public.projects that were either never actually
-- read anywhere in the app, or duplicated a value the app already
-- computes live from a real source of truth — both are the same
-- "designed ahead of the real feature" pattern 0025_schema_cleanup.sql
-- already cleaned up elsewhere in the schema:
--
--   description      -> only ever set by the Edit Project form and
--     displayed back verbatim; the form field is being removed (not
--     something the client asked to keep editable), so nothing else
--     ever reads it.
--   progress_percent -> a static number the Edit Project form let an
--     admin type in by hand. Real progress has been computed live from
--     approved daily logs since lib/progress/data.ts's getProjectProgress
--     existed (see 0012's own note that this exact pattern already
--     bit daily_log_progress) — every actual progress display already
--     reads that, never this column.
--   selling_price    -> written by the form, never displayed or read
--     anywhere else in the app.
--   estimated_cost   -> same story as progress_percent: every real
--     "Total Estimated Cost" display reads
--     get_cost_estimate(...).summary.totalEstimatedCost (the live sum
--     of the Cost Estimate Breakdown's tasks), never this column.
--   actual_expense   -> was actually still read in three places in
--     project-detail-view.tsx (a stat card, the Total Costs chart, and
--     the Remaining Budget calc) — those are updated in the same change
--     to instead sum the four live expense ledgers
--     (lib/expenses/data.ts's summarizeExpenses), the same computation
--     the Reports page already uses, so removing this column doesn't
--     leave those displays stuck on a stale, hand-typed number.
--
-- status is NOT touched here — it's still a real, actively-read column
-- (badges, filters), just no longer manually settable through the Edit
-- Project form now that lib/projects/status.ts's
-- deriveProjectStatusFromProgress keeps it in sync automatically.
--
-- Run this AFTER 0025_schema_cleanup.sql.
-- ============================================================================

alter table public.projects
  drop column if exists description,
  drop column if exists progress_percent,
  drop column if exists selling_price,
  drop column if exists estimated_cost,
  drop column if exists actual_expense;
