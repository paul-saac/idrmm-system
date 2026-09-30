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

/** How a planned material line and a logged usage row find each other —
 * name + unit, case/whitespace-insensitive. See
 * 0050_task_progress_material_entries.sql for why this isn't an id. Unit
 * is part of the key so two same-named lines in different units (e.g.
 * "Gravel" in cu.m and in bags) are never summed together. */
export function materialKey(name: string, unit: string | null): string {
  return `${name.trim().toLowerCase()}|${(unit ?? "").trim().toLowerCase()}`;
}

/** One distinct material planned for a task — its Material Breakdown
 * lines grouped by materialKey, so a name repeated across two lines
 * (e.g. the same cement listed twice with different specs) shows up as
 * one row to log against rather than two ambiguous ones. */
export type PlannedMaterial = {
  key: string;
  name: string;
  unit: string | null;
  plannedQuantity: number;
  /** Peso value of the planned quantity — each line's own Amount
   * (amountOverride, or plannedQuantity * unitCost), summed. What makes
   * materials in different units comparable to each other at all — see
   * materialsPercent's own doc comment. */
  plannedValue: number;
};

export function groupPlannedMaterials(
  lines: {
    materialName: string;
    unit: string | null;
    plannedQuantity: number;
    unitCost: number;
    amountOverride: number | null;
  }[]
): PlannedMaterial[] {
  const byKey = new Map<string, PlannedMaterial>();
  for (const line of lines) {
    const name = line.materialName.trim();
    if (!name) continue;
    const key = materialKey(name, line.unit);
    const value = line.amountOverride ?? line.plannedQuantity * line.unitCost;
    const existing = byKey.get(key);
    if (existing) {
      existing.plannedQuantity += line.plannedQuantity;
      existing.plannedValue += value;
    } else {
      byKey.set(key, {
        key,
        name,
        unit: line.unit,
        plannedQuantity: line.plannedQuantity,
        plannedValue: value,
      });
    }
  }
  return Array.from(byKey.values());
}

/** A task/category's own cumulative totals to date, across every
 * Progress Tracking Override entry it's ever had. */
export type ProgressAnchor = {
  /** Quantity used so far per material, keyed by materialKey — summed
   * across every day's entry. */
  cumulativeMaterialUsage: Record<string, number>;
  /** Worker-days logged so far — each day's headcount, summed. */
  cumulativeLaborHeadcount: number;
  /** The most recently-dated entry's own manual percent-complete
   * override (see 0049_progress_percent_override.sql), if it has one —
   * null if the latest entry has none, or there are no entries at all.
   * Always a task-local percent (0-100), never weight points, even
   * though the modal lets it be typed as weight points — see
   * ProgressTrackingModalContent's own doc comment for why. */
  latestPercentCompleteOverride: number | null;
};

export const EMPTY_PROGRESS_ANCHOR: ProgressAnchor = {
  cumulativeMaterialUsage: {},
  cumulativeLaborHeadcount: 0,
  latestPercentCompleteOverride: null,
};

export type PercentCompleteBreakdown = {
  /** How much of the task's own planned materials has been used so far.
   * Each material's own used/planned fraction is capped at 100% (using
   * more cement than planned doesn't make up for not having touched the
   * rebar yet), then weighted by that material's own planned peso value
   * — the one unit bags, cu.m, pcs, and kgs all have in common — so a
   * ₱50,000 line counts for more than a ₱1,000 one. Falls back to a
   * plain average of the fractions when no line has a cost entered. Null
   * when the task has no planned material with a quantity above 0 —
   * nothing to measure against. */
  materialsPercent: number | null;
  /** Cumulative worker-days logged / (plannedWorkerCount * the task's
   * own total working days) — "worker-days used so far" against
   * "worker-days planned for the whole task." Null when there's no
   * planned worker count, or no working-day total to multiply it by
   * (see timePercent below). */
  laborPercent: number | null;
  /** Working days elapsed (through yesterday) / total working days,
   * Start to End. Null when there's no planned Start/End date yet. */
  timePercent: number | null;
  /** The plain average of whichever of the three above are actually
   * available (not null) — a task missing a planned material list,
   * labor count, or schedule simply isn't measured on that axis rather
   * than being treated as 0% on it. 0 if none are available at all.
   * Replaced outright by anchor.latestPercentCompleteOverride when one
   * is set — isOverridden says which case this is. */
  blendedPercent: number;
  /** True when blendedPercent above is the manually-typed override, not
   * the computed blend. */
  isOverridden: boolean;
  /** Exposed alongside timePercent for display (e.g. "5 of 10 working
   * days"). Null under the same condition as timePercent. */
  elapsedWorkingDays: number | null;
  totalWorkingDays: number | null;
};

/**
 * A task's own live-computed Percent Complete — Automatic Progress
 * Completion: an equal-weighted blend of three independent signals
 * (Materials, Labor, Time), each answering a different question about
 * the same task. Deliberately a pure function of its inputs, not
 * something stored: it has to change on its own every day without any
 * write happening (Time% keeps moving even between Progress Tracking
 * Overrides), which only works if it's recomputed fresh on every read.
 *
 * This is the task's OWN percent (0-100) — its contribution to the
 * project as a whole is this times the task's own weight (see
 * getProjectProgress, lib/progress/data.ts), computed there, not here.
 *
 * A day only ever counts as "elapsed" once it's actually over — never
 * today itself — otherwise Time% would jump the instant today begins
 * rather than once it's actually finished.
 *
 * `anchor.latestPercentCompleteOverride`, when not null, replaces the
 * computed blend outright — the same override idea
 * 0043_amount_overrides.sql already uses for a BOM line's Amount. The
 * three component percents are still computed and returned either way,
 * so a caller can keep showing them as context.
 *
 * Returns the exact, unrounded fraction — callers format it for display.
 */
export function computeProgressBreakdown({
  plannedStartDate,
  plannedEndDate,
  plannedMaterials,
  plannedWorkerCount,
  workingDays,
  anchor,
  today,
}: {
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  plannedMaterials: PlannedMaterial[];
  plannedWorkerCount: number;
  workingDays: WorkingDays;
  anchor: ProgressAnchor;
  today: Date;
}): PercentCompleteBreakdown {
  const measurable = plannedMaterials.filter((m) => m.plannedQuantity > 0);
  let materialsPercent: number | null = null;
  if (measurable.length > 0) {
    const fractions = measurable.map((m) => ({
      fraction: Math.min(1, (anchor.cumulativeMaterialUsage[m.key] ?? 0) / m.plannedQuantity),
      value: Math.max(0, m.plannedValue),
    }));
    const totalValue = fractions.reduce((sum, f) => sum + f.value, 0);
    materialsPercent = clampPercent(
      totalValue > 0
        ? (fractions.reduce((sum, f) => sum + f.fraction * f.value, 0) / totalValue) * 100
        : (fractions.reduce((sum, f) => sum + f.fraction, 0) / fractions.length) * 100
    );
  }

  let elapsedWorkingDays: number | null = null;
  let totalWorkingDays: number | null = null;
  let timePercent: number | null = null;

  if (plannedStartDate && plannedEndDate) {
    const start = toLocalDate(plannedStartDate);
    const end = toLocalDate(plannedEndDate);
    const now = startOfDay(today);
    const total = countWorkingDays(start, end, workingDays);

    if (total > 0) {
      totalWorkingDays = total;
      if (now <= start) {
        elapsedWorkingDays = 0;
      } else if (now > end) {
        elapsedWorkingDays = total;
      } else {
        // Up through *yesterday*, not today — see this function's own
        // doc comment on why today never counts as elapsed yet.
        elapsedWorkingDays = countWorkingDays(start, addDays(now, -1), workingDays);
      }
      timePercent = clampPercent((elapsedWorkingDays / total) * 100);
    }
  }

  const laborPercent =
    plannedWorkerCount > 0 && totalWorkingDays !== null && totalWorkingDays > 0
      ? clampPercent(
          (anchor.cumulativeLaborHeadcount / (plannedWorkerCount * totalWorkingDays)) *
            100
        )
      : null;

  const availableComponents = [materialsPercent, laborPercent, timePercent].filter(
    (percent): percent is number => percent !== null
  );
  const computedPercent =
    availableComponents.length > 0
      ? availableComponents.reduce((sum, percent) => sum + percent, 0) /
        availableComponents.length
      : 0;
  const override = anchor.latestPercentCompleteOverride;

  return {
    materialsPercent,
    laborPercent,
    timePercent,
    blendedPercent: override !== null ? clampPercent(override) : computedPercent,
    isOverridden: override !== null,
    elapsedWorkingDays,
    totalWorkingDays,
  };
}

/** Thin wrapper around computeProgressBreakdown for every caller that
 * only needs the final number (e.g. getCostEstimate). */
export function computeAutoPercentComplete(
  args: Parameters<typeof computeProgressBreakdown>[0]
): number {
  return computeProgressBreakdown(args).blendedPercent;
}
