/**
 * Pure functions behind Automatic Progress Completion — no DB access,
 * so the same math can be unit-tested or reused client-side without
 * dragging a Supabase client along. See
 * supabase/migrations/0040_task_progress_tracking.sql for the feature's
 * own overview.
 */

/** ISO weekday numbers, 1=Monday..7=Sunday — matches projects.working_days. */
export type WorkingDays = readonly number[];

/** Parses a `YYYY-MM-DD` string as local midnight, matching every other
 * date parse in this app (see gantt-chart-view.tsx's own toDate) — never
 * UTC, which would silently shift a day at some timezone offsets. */
export function toLocalDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

function isoWeekday(date: Date): number {
  const day = date.getDay(); // 0=Sunday..6=Saturday
  return day === 0 ? 7 : day;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = startOfDay(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function isWorkingDay(date: Date, workingDays: WorkingDays): boolean {
  return workingDays.includes(isoWeekday(date));
}

/** Inclusive count of working days between `start` and `end` — 0 if
 * `end` is before `start`. */
export function countWorkingDays(
  start: Date,
  end: Date,
  workingDays: WorkingDays
): number {
  const from = startOfDay(start);
  const to = startOfDay(end);
  if (to < from) return 0;
  let count = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (isWorkingDay(d, workingDays)) count += 1;
  }
  return count;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/** The task's own cumulative progress as of its most recent Progress
 * Tracking Override, plus the date that override was recorded on — the
 * anchor computeAutoPercentComplete projects forward from. Null means
 * no override has ever been recorded, so the task is still on its pure
 * schedule-based projection from its own planned start date. */
export type ProgressAnchor = {
  entryDate: string;
  cumulativeQuantityCompleted: number;
} | null;

/**
 * The Gantt Chart's own live-computed Percent Complete — Automatic
 * Progress Completion, anchored by the most recent Progress Tracking
 * Override if one exists (see this file's own top comment). Deliberately
 * a pure function of its inputs, not something stored: it has to change
 * on its own every day without any write happening, which only works if
 * it's recomputed fresh on every read.
 *
 * With no override yet, progress is purely date-based — a "fencepost"
 * fraction of working days elapsed since the task's own planned start,
 * out of the working days *between* start and end (a 5-working-day task
 * has 4 day-to-day gaps: start day itself is 0%, one full day elapsed is
 * 1/4 = 25%, the planned end is 100%). This branch deliberately never
 * needs estimatedQuantity — it's pure calendar math, so it works with
 * zero setup, before anyone has ever recorded a quantity for this task.
 *
 * With an override (and only once estimatedQuantity is actually set —
 * there's nothing to compute a percent from otherwise, so this falls
 * back to the same pure date-based math above instead), everything
 * before/at the override's own date reads as exactly what that override
 * recorded; everything after projects linearly from there to 100% at
 * the planned end date, using working days elapsed since the override
 * out of working days remaining — so a task that's ahead or behind its
 * naive schedule stays reflected as such until the next override
 * corrects it again.
 *
 * Today itself never counts as an "elapsed" day in either branch, in
 * either direction — only a day that has actually finished (start
 * through yesterday, or the override's own day through yesterday) adds
 * to the count. Otherwise progress would jump the instant today begins
 * rather than once it's actually over, effectively crediting a day of
 * work that hasn't happened yet.
 *
 * Returns the exact, unrounded fraction (e.g. 66.66666...), never
 * Math.round-ed — every caller that displays this formats it for
 * presentation at the point of display instead, so the stored/compared
 * value itself stays precise.
 */
export function computeAutoPercentComplete({
  plannedStartDate,
  plannedEndDate,
  estimatedQuantity,
  workingDays,
  anchor,
  today,
}: {
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  estimatedQuantity: number;
  workingDays: WorkingDays;
  anchor: ProgressAnchor;
  today: Date;
}): number {
  if (!plannedStartDate || !plannedEndDate) return 0;

  const start = toLocalDate(plannedStartDate);
  const end = toLocalDate(plannedEndDate);
  const now = startOfDay(today);

  if (anchor && estimatedQuantity > 0) {
    const anchorDate = toLocalDate(anchor.entryDate);
    const anchorPercent = clampPercent(
      (anchor.cumulativeQuantityCompleted / estimatedQuantity) * 100
    );
    if (now <= anchorDate) return anchorPercent;
    // Reaching the planned end date is its own completion marker, same
    // as the plain date-based branch below (now >= end -> 100) — checked
    // up front so the "up through yesterday" elapsed count just below
    // only ever has to handle days strictly before end.
    if (now >= end) return 100;

    const remainingWorkingDays = countWorkingDays(
      addDays(anchorDate, 1),
      end,
      workingDays
    );
    if (remainingWorkingDays <= 0) return anchorPercent;

    // Up through *yesterday*, not today — see this function's own doc
    // comment on why today never counts as elapsed yet.
    const elapsedSinceAnchor = countWorkingDays(
      addDays(anchorDate, 1),
      addDays(now, -1),
      workingDays
    );
    const gained =
      (100 - anchorPercent) * (elapsedSinceAnchor / remainingWorkingDays);
    return clampPercent(anchorPercent + gained);
  }

  if (now < start) return 0;
  if (now >= end) return 100;

  const totalWorkingDays = countWorkingDays(start, end, workingDays);
  if (totalWorkingDays <= 1) return 0;
  // Counts from `start` itself (inclusive) up through *yesterday*, not
  // today — see this function's own doc comment on why today never
  // counts as elapsed yet. On the start day itself this is 0 (yesterday
  // is before start, so countWorkingDays' own to<from guard returns 0),
  // giving exactly 0% rather than already counting day one. Divided by
  // totalWorkingDays - 1, not totalWorkingDays (the fencepost adjustment
  // described above) — this formula only ever runs for now < end (the
  // now >= end check above already handles the planned end date itself
  // as its own flat 100%), so it approaches but never has to reach 100%
  // on its own.
  const elapsedWorkingDays = countWorkingDays(start, addDays(now, -1), workingDays);
  return clampPercent((elapsedWorkingDays / (totalWorkingDays - 1)) * 100);
}
