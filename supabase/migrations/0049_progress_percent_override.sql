-- Lets a Progress Tracking Override's own "New percent complete" be
-- typed directly, same override idea 0043_amount_overrides.sql already
-- uses for a BOM line's Amount: nullable — null means "no override,
-- use the live Materials/Labor/Time blend as normal" (see
-- computeProgressBreakdown, lib/task-progress/calculate.ts); a non-null
-- value means "use this instead." Cleared automatically the moment
-- Quantity Completed or Workers Today is edited (see
-- ProgressTrackingModalContent's own doc comment) — same "touching the
-- real inputs always wins back over a stale override" rule
-- 0043_amount_overrides.sql's own Amount cells already follow, so a
-- manually-typed percent can never silently disagree with freshly
-- logged data.
--
-- Run this AFTER 0048_category_progress_tracking.sql.

alter table public.task_progress_entries
  add column if not exists percent_complete_override numeric;

alter table public.category_progress_entries
  add column if not exists percent_complete_override numeric;
