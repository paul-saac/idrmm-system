/**
 * Pure functions behind Automatic Progress Completion — no DB access,
 * so the same math can be unit-tested or reused client-side without
 * dragging a Supabase client along. See
 * supabase/migrations/0040_task_progress_tracking.sql for the feature's
 * own overview.
 */

/** ISO weekday numbers, 1=Monday..7=Sunday — matches projects.working_days. */
export type WorkingDays = readonly number[];

/** ISO dates (`YYYY-MM-DD`) the site is off on top of its non-working
 * weekdays — matches projects.holidays (0053_project_holidays.sql). */
export type Holidays = readonly string[];

/** Parses a `YYYY-MM-DD` string as local midnight, matching every other
 * date parse in this app (see gantt-chart-view.tsx's own toDate) — never
 * UTC, which would silently shift a day at some timezone offsets. */
export function toLocalDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

/** The inverse of toLocalDate — a local date as `YYYY-MM-DD`. */
export function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
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

/** A working weekday that isn't a holiday. */
export function isWorkingDay(
  date: Date,
  workingDays: WorkingDays,
  holidays: ReadonlySet<string>
): boolean {
  return workingDays.includes(isoWeekday(date)) && !holidays.has(toIsoDate(date));
}

/** Inclusive count of working days between `start` and `end` — 0 if
 * `end` is before `start`. */
export function countWorkingDays(
  start: Date,
  end: Date,
  workingDays: WorkingDays,
  holidays: ReadonlySet<string>
): number {
  const from = startOfDay(start);
  const to = startOfDay(end);
  if (to < from) return 0;
  let count = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (isWorkingDay(d, workingDays, holidays)) count += 1;
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

/** A material used that isn't on the planned lines — logged with the
 * unit cost typed for it (0073). */
export type UnplannedMaterial = {
  name: string;
  unit: string | null;
  quantity: number;
  unitCost: number;
};

/** What unplanned materials used cost — each quantity × its own unit
 * cost. To the centavo. */
export function unplannedMaterialCost(materials: readonly UnplannedMaterial[]): number {
  const total = materials.reduce((sum, material) => sum + material.quantity * material.unitCost, 0);
  return Math.round(total * 100) / 100;
}

/**
 * What these materials used cost at the estimate's own unit costs (each
 * planned material's value ÷ its planned quantity) — the itemized part of
 * a day's material cost, priced the same way in the progress window and
 * on save. A material without a planned quantity has no unit cost, so
 * isn't counted. To the centavo.
 */
export function itemizedMaterialCost(
  planned: PlannedMaterial[],
  /** Quantity used per material, keyed by materialKey. */
  used: Record<string, number>
): number {
  let total = 0;
  for (const material of planned) {
    if (material.plannedQuantity <= 0) continue;
    total += (used[material.key] ?? 0) * (material.plannedValue / material.plannedQuantity);
  }
  return Math.round(total * 100) / 100;
}


/** A task's four cost components — the same ones its weight comes from
 * (lib/cost-estimate/weights.ts). */
export const COST_COMPONENTS = ["labor", "material", "equipment", "other"] as const;
export type CostComponent = (typeof COST_COMPONENTS)[number];
export type CostAmounts = Record<CostComponent, number>;

export const ZERO_COSTS: CostAmounts = { labor: 0, material: 0, equipment: 0, other: 0 };

export function sumCosts(costs: CostAmounts): number {
  return costs.labor + costs.material + costs.equipment + costs.other;
}

/** A task/category's own totals across every Daily Progress Update it
 * has saved (see 0057_progress_entry_costs.sql) — saved entries only;
 * computeProgressBreakdown adds the automatic days on top. */
export type ProgressAnchor = {
  /** Work quantity completed (e.g. cu.m excavated) — each saved day's
   * "Quantity completed today", summed. */
  cumulativeQuantityCompleted: number;
  /** Quantity used per material, keyed by materialKey — summed across
   * every saved day. */
  cumulativeMaterialUsage: Record<string, number>;
  /** Spend per cost component — summed across every saved day. */
  cumulativeCosts: CostAmounts;
  /** Of cumulativeCosts.material, what went on materials not on the
   * planned lines (logged as unplanned, 0073) — real spend, so it's in
   * the costs to date, but not progress: it's left out of cost-based %
   * complete, and of what automatic days measure against the plan's own
   * material budget. Absent counts as 0. */
  cumulativeUnplannedMaterialCost?: number;
  /** The days (YYYY-MM-DD) that have a saved entry — a working day that
   * doesn't counts its planned share automatically instead. */
  loggedDates: readonly string[];
};

export const EMPTY_PROGRESS_ANCHOR: ProgressAnchor = {
  cumulativeQuantityCompleted: 0,
  cumulativeMaterialUsage: {},
  cumulativeCosts: ZERO_COSTS,
  loggedDates: [],
};

export type ScheduleStatus = "ahead" | "on_track" | "behind";
/** What % complete is measured from: the task's planned quantity when it
 * has one (the physical work done), else its cost, else its planned
 * materials. */
export type ProgressSource = "cost" | "quantity" | "materials" | "none";

// How far actual may drift from expected (in percentage points) and
// still read as on track — one quiet day shouldn't flip a task to behind.
const ON_TRACK_TOLERANCE = 5;

export function scheduleStatusFor(actual: number, expected: number): ScheduleStatus {
  const gap = actual - expected;
  if (gap > ON_TRACK_TOLERANCE) return "ahead";
  if (gap < -ON_TRACK_TOLERANCE) return "behind";
  return "on_track";
}

type Schedule = {
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  workingDays: WorkingDays;
  holidays: Holidays;
};

/** Total working days from Start to End (holidays left out) — null when
 * there's no planned Start/End yet, or no working day in between. */
function totalScheduledDays({
  plannedStartDate,
  plannedEndDate,
  workingDays,
  holidays,
}: Schedule): number | null {
  if (!plannedStartDate || !plannedEndDate) return null;
  const total = countWorkingDays(
    toLocalDate(plannedStartDate),
    toLocalDate(plannedEndDate),
    workingDays,
    new Set(holidays)
  );
  return total > 0 ? total : null;
}

/** Expected progress (Automatic Progress): working days so far — today
 * included, from the moment it starts (12:00 AM) — ÷ total working days,
 * Start to End; the same days automatic progress counts. Holidays never
 * count, same as a non-working weekday. All null when there's no planned
 * Start/End yet. */
export function computeExpectedProgress({
  plannedStartDate,
  plannedEndDate,
  workingDays,
  holidays,
  today,
}: Schedule & { today: Date }): {
  elapsedWorkingDays: number | null;
  totalWorkingDays: number | null;
  timePercent: number | null;
} {
  const none = { elapsedWorkingDays: null, totalWorkingDays: null, timePercent: null };
  const total = totalScheduledDays({ plannedStartDate, plannedEndDate, workingDays, holidays });
  if (total === null) return none;

  const start = toLocalDate(plannedStartDate!);
  const end = toLocalDate(plannedEndDate!);
  const now = startOfDay(today);
  const elapsed =
    now < start
      ? 0
      : now >= end
        ? total
        : countWorkingDays(start, now, workingDays, new Set(holidays));

  return {
    elapsedWorkingDays: elapsed,
    totalWorkingDays: total,
    timePercent: clampPercent((elapsed / total) * 100),
  };
}

/** One day's planned share of a task: each cost component, its quantity
 * and each planned material divided evenly across its working days. */
export type DailyPlan = {
  costs: CostAmounts;
  quantity: number;
  materials: Record<string, number>;
};

/**
 * The automatic values for one day — a working day inside the task's
 * Start..End gets planned ÷ total working days of everything (e.g. ₱1,000
 * of labor over 4 working days → ₱250 a day); any other day (outside the
 * schedule, a non-working weekday, a holiday) gets nothing. What the
 * Daily Progress Update's inputs start from, and what a working day with
 * no saved entry counts on its own (today included, from 12:00 AM).
 */
export function computeDailyPlan({
  plannedStartDate,
  plannedEndDate,
  workingDays,
  holidays,
  plannedCosts,
  estimatedQuantity,
  plannedMaterials,
  date,
}: Schedule & {
  plannedCosts: CostAmounts;
  estimatedQuantity: number;
  plannedMaterials: PlannedMaterial[];
  date: Date;
}): DailyPlan {
  const empty: DailyPlan = { costs: ZERO_COSTS, quantity: 0, materials: {} };
  const total = totalScheduledDays({ plannedStartDate, plannedEndDate, workingDays, holidays });
  if (total === null) return empty;
  const day = startOfDay(date);
  if (
    day < toLocalDate(plannedStartDate!) ||
    day > toLocalDate(plannedEndDate!) ||
    !isWorkingDay(day, workingDays, new Set(holidays))
  ) {
    return empty;
  }
  const materials: Record<string, number> = {};
  for (const material of plannedMaterials) {
    materials[material.key] = material.plannedQuantity / total;
  }
  return {
    costs: {
      labor: plannedCosts.labor / total,
      material: plannedCosts.material / total,
      equipment: plannedCosts.equipment / total,
      other: plannedCosts.other / total,
    },
    quantity: estimatedQuantity / total,
    materials,
  };
}

/**
 * Today's automatic values — what today counts while nothing's saved for
 * it, and so what its Daily Progress Update starts from: its planned
 * share (computeDailyPlan), capped the way computeProgressBreakdown caps
 * every automatic day — never more than what's left of each part after
 * every other day so far, saved or automatic. `anchor` is the saved days
 * other than today.
 */
export function computeTodayPlan({
  plannedCosts,
  estimatedQuantity,
  plannedMaterials,
  anchor,
  today,
  ...schedule
}: Schedule & {
  plannedCosts: CostAmounts;
  estimatedQuantity: number;
  plannedMaterials: PlannedMaterial[];
  anchor: ProgressAnchor;
  today: Date;
}): DailyPlan {
  const daily = computeDailyPlan({
    ...schedule,
    plannedCosts,
    estimatedQuantity,
    plannedMaterials,
    date: today,
  });
  // Everything so far but today — today counted as saved, with nothing.
  const before = computeProgressBreakdown({
    ...schedule,
    plannedCosts,
    estimatedQuantity,
    plannedMaterials,
    anchor: { ...anchor, loggedDates: [...anchor.loggedDates, toIsoDate(today)] },
    today,
  });
  const left = (dayShare: number, planned: number, toDate: number) =>
    Math.min(dayShare, Math.max(0, planned - toDate));

  const materials: Record<string, number> = {};
  for (const material of plannedMaterials) {
    materials[material.key] = left(
      daily.materials[material.key] ?? 0,
      material.plannedQuantity,
      before.materialUsageToDate[material.key] ?? 0
    );
  }
  return {
    costs: {
      labor: left(daily.costs.labor, plannedCosts.labor, before.costsToDate.labor),
      material: left(
        daily.costs.material,
        plannedCosts.material,
        before.costsToDate.material - (anchor.cumulativeUnplannedMaterialCost ?? 0)
      ),
      equipment: left(daily.costs.equipment, plannedCosts.equipment, before.costsToDate.equipment),
      other: left(daily.costs.other, plannedCosts.other, before.costsToDate.other),
    },
    quantity: left(daily.quantity, estimatedQuantity, before.quantityToDate),
    materials,
  };
}

export type PercentCompleteBreakdown = {
  /** Spend to date per cost component: every saved day's, plus each
   * working day so far (today included) without an entry counting its
   * planned share — never past the plan (see computeProgressBreakdown). */
  costsToDate: CostAmounts;
  plannedCostTotal: number;
  /** Cost to date ÷ planned cost — how much of the budget is spent; %
   * complete only for a task with no planned quantity. Null when nothing
   * is planned to measure against. */
  costPercent: number | null;
  quantityToDate: number;
  /** Quantity to date ÷ planned quantity — % complete whenever there's a
   * planned quantity. Null without one. */
  quantityPercent: number | null;
  materialUsageToDate: Record<string, number>;
  /** How much of the planned materials is used, each capped at 100% and
   * weighted by its planned peso value (so a ₱50,000 line counts for more
   * than a ₱1,000 one; a plain average when no line has a cost). Null
   * when no planned material has a quantity above 0. */
  materialsPercent: number | null;
  /** Expected progress — see computeExpectedProgress. */
  timePercent: number | null;
  elapsedWorkingDays: number | null;
  totalWorkingDays: number | null;
  /** Working days so far (today included) that counted their planned
   * share automatically (no saved entry). */
  automaticDays: number;
  /** % complete (0-100), from progressSource. */
  percentComplete: number;
  progressSource: ProgressSource;
  /** Actual (percentComplete) vs. expected (timePercent). Null when
   * there's no schedule to compare against. */
  scheduleStatus: ScheduleStatus | null;
};

/**
 * A task's own progress from its Daily Progress Updates.
 *
 * % complete is quantity done to date ÷ planned quantity — the physical
 * work done (units completed), the usual way site progress is measured —
 * falling back to cost to date ÷ planned cost (labor + material +
 * equipment + other), then materials, for a task with no planned
 * quantity. Its costs still count against their plan either way (over or
 * under budget), just not toward % complete.
 *
 * Automatic progress: every working day from Start through today that
 * has no saved entry counts its planned share (computeDailyPlan) on its
 * own — today from the moment it starts (12:00 AM) — so untouched, a task
 * keeps pace with its schedule; a saved entry overrides that day with what
 * was actually typed (more, less, or nothing at all — a rained-out day
 * saved as 0 holds the task back).
 *
 * Automatic days never take a part past its plan: together they add only
 * what's left of it after the saved days, at most their planned share.
 * So a day saved ahead of plan (0.8 of a 1-lot task's 0.5 a day) leaves
 * the next automatic day just the 0.2 that's left — not 1.3 — while one
 * saved behind (0.2) still leaves it its usual 0.5 (0.7, still behind:
 * an automatic day assumes a normal day's work, never a catch-up). Only
 * a saved entry can take a part over its plan.
 *
 * This is the task's OWN percent — its contribution to the project is
 * this times its weight (getProjectProgress, lib/progress/data.ts).
 * Returns exact, unrounded values — callers format them for display.
 */
export function computeProgressBreakdown({
  plannedStartDate,
  plannedEndDate,
  workingDays,
  holidays,
  plannedCosts,
  estimatedQuantity,
  plannedMaterials,
  anchor,
  today,
}: Schedule & {
  plannedCosts: CostAmounts;
  estimatedQuantity: number;
  plannedMaterials: PlannedMaterial[];
  anchor: ProgressAnchor;
  today: Date;
}): PercentCompleteBreakdown {
  const schedule = { plannedStartDate, plannedEndDate, workingDays, holidays };
  const { elapsedWorkingDays, totalWorkingDays, timePercent } = computeExpectedProgress({
    ...schedule,
    today,
  });

  // Elapsed working days (today included) with no saved entry — the
  // logged days are left out exactly like holidays are.
  let automaticDays = 0;
  if (totalWorkingDays !== null && elapsedWorkingDays) {
    const start = toLocalDate(plannedStartDate!);
    const end = toLocalDate(plannedEndDate!);
    const now = startOfDay(today);
    automaticDays = countWorkingDays(
      start,
      now < end ? now : end,
      workingDays,
      new Set([...holidays, ...anchor.loggedDates])
    );
  }
  const share =
    totalWorkingDays !== null ? automaticDays / totalWorkingDays : 0;
  // What the automatic days add to one part: their planned share of it,
  // but only what's left of its plan after the saved days.
  const automatic = (planned: number, saved: number) =>
    Math.min(planned * share, Math.max(0, planned - saved));

  const saved = anchor.cumulativeCosts;
  // Spent on materials not in the plan — in the costs to date, but not
  // measured against the plan's material budget, nor progress.
  const unplanned = anchor.cumulativeUnplannedMaterialCost ?? 0;
  const costsToDate: CostAmounts = {
    labor: saved.labor + automatic(plannedCosts.labor, saved.labor),
    material: saved.material + automatic(plannedCosts.material, saved.material - unplanned),
    equipment: saved.equipment + automatic(plannedCosts.equipment, saved.equipment),
    other: saved.other + automatic(plannedCosts.other, saved.other),
  };
  const plannedCostTotal = sumCosts(plannedCosts);
  const costPercent =
    plannedCostTotal > 0
      ? clampPercent(((sumCosts(costsToDate) - unplanned) / plannedCostTotal) * 100)
      : null;

  const quantityToDate =
    anchor.cumulativeQuantityCompleted +
    automatic(estimatedQuantity, anchor.cumulativeQuantityCompleted);
  const quantityPercent =
    estimatedQuantity > 0 ? clampPercent((quantityToDate / estimatedQuantity) * 100) : null;

  const materialUsageToDate: Record<string, number> = { ...anchor.cumulativeMaterialUsage };
  for (const material of plannedMaterials) {
    const used = materialUsageToDate[material.key] ?? 0;
    materialUsageToDate[material.key] = used + automatic(material.plannedQuantity, used);
  }
  const measurable = plannedMaterials.filter((m) => m.plannedQuantity > 0);
  let materialsPercent: number | null = null;
  if (measurable.length > 0) {
    const fractions = measurable.map((m) => ({
      fraction: Math.min(1, (materialUsageToDate[m.key] ?? 0) / m.plannedQuantity),
      value: Math.max(0, m.plannedValue),
    }));
    const totalValue = fractions.reduce((sum, f) => sum + f.value, 0);
    materialsPercent = clampPercent(
      totalValue > 0
        ? (fractions.reduce((sum, f) => sum + f.fraction * f.value, 0) / totalValue) * 100
        : (fractions.reduce((sum, f) => sum + f.fraction, 0) / fractions.length) * 100
    );
  }

  const progressSource: ProgressSource =
    quantityPercent !== null
      ? "quantity"
      : costPercent !== null
        ? "cost"
        : materialsPercent !== null
          ? "materials"
          : "none";
  const percentComplete =
    progressSource === "cost"
      ? costPercent!
      : progressSource === "quantity"
        ? quantityPercent!
        : progressSource === "materials"
          ? materialsPercent!
          : 0;

  return {
    costsToDate,
    plannedCostTotal,
    costPercent,
    quantityToDate,
    quantityPercent,
    materialUsageToDate,
    materialsPercent,
    timePercent,
    elapsedWorkingDays,
    totalWorkingDays,
    automaticDays,
    percentComplete,
    progressSource,
    scheduleStatus: timePercent !== null ? scheduleStatusFor(percentComplete, timePercent) : null,
  };
}

/** Thin wrapper around computeProgressBreakdown for every caller that
 * only needs the final number (e.g. getCostEstimate). */
export function computeAutoPercentComplete(
  args: Parameters<typeof computeProgressBreakdown>[0]
): number {
  return computeProgressBreakdown(args).percentComplete;
}
