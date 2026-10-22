import { createClient } from "@/lib/supabase/server";
import {
  materialKey,
  otherCostKey,
  unplannedMaterialCost,
  ZERO_COSTS,
  type CostAmounts,
  type ProgressAnchor,
  type UnplannedMaterial,
  type UnplannedOtherCost,
} from "@/lib/task-progress/calculate";

/** Every task's own saved totals (see ProgressAnchor's own doc comment)
 * for a whole project's worth of tasks — powers computeAutoPercentComplete
 * inside getCostEstimate. Keyed by task id; a task with no Daily Progress
 * Update saved yet is simply absent (callers fall back to
 * EMPTY_PROGRESS_ANCHOR). */
export type TaskProgressAnchors = Record<number, ProgressAnchor>;

/** One day's saved Daily Progress Update. */
export type ProgressDayEntry = {
  quantityCompleted: number;
  costs: CostAmounts;
  /** That day's usage per material, keyed by materialKey. */
  materialUsage: Record<string, number>;
  /** That day's materials used that aren't on the planned lines, each at
   * its own unit cost (0073) — kept apart from materialUsage. */
  unplannedMaterials: UnplannedMaterial[];
  /** That day's spend per planned equipment cost item, keyed by otherCostKey. */
  equipmentCostSpend?: Record<string, number>;
  /** That day's unplanned equipment cost items added on the spot (0089). */
  unplannedEquipmentCosts?: UnplannedOtherCost[];
  /** That day's spend per planned other cost item, keyed by otherCostKey. */
  otherCostSpend?: Record<string, number>;
  /** That day's unplanned other cost items added on the spot (0084). */
  unplannedOtherCosts?: UnplannedOtherCost[];
};

/** The most recently overridden day — what the Gantt chart's orange dot
 * marks, shown under the Daily Progress Update's inputs. */
export type LatestOverride = ProgressDayEntry & {
  entryDate: string;
  /** Who saved it — null when unknown, or not visible to this user
   * (they may only read their own profile). */
  savedByName: string | null;
};

/** A task's saved totals plus whatever's already saved for today — what
 * the Daily Progress Update modal starts from. `today` null means
 * nothing's been saved yet today (the form starts from the day's
 * automatic planned share instead — see computeDailyPlan). */
export type TaskProgressToday = ProgressAnchor & {
  today: ProgressDayEntry | null;
  latest: LatestOverride | null;
  /** Who's saved as working today (0068_progress_attendance.sql) — empty
   * when nobody, or nothing's saved yet today. */
  todayAttendance: AttendanceMark[];
};

/** One person on a day's saved attendance — the hours they worked. */
export type AttendanceMark = {
  workerId: number | null;
  workerName: string;
  hours: number;
};

/** Saved attendance for these progress entries, by entry id — empty
 * before 0068 has run. */
export async function attendanceByEntry(
  supabase: Supabase,
  kind: "task" | "category",
  entryIds: number[]
): Promise<Map<number, AttendanceMark[]>> {
  const byEntry = new Map<number, AttendanceMark[]>();
  if (entryIds.length === 0) return byEntry;
  const { data } =
    kind === "task"
      ? await supabase
          .from("task_progress_attendance")
          .select("progress_entry_id, worker_id, worker_name, hours")
          .in("progress_entry_id", entryIds)
      : await supabase
          .from("category_progress_attendance")
          .select("progress_entry_id, worker_id, worker_name, hours")
          .in("progress_entry_id", entryIds);
  for (const row of data ?? []) {
    const list = byEntry.get(row.progress_entry_id) ?? [];
    list.push({
      workerId: row.worker_id,
      workerName: row.worker_name,
      hours: Number(row.hours),
    });
    byEntry.set(row.progress_entry_id, list);
  }
  return byEntry;
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

type Entry = ProgressDayEntry & {
  id: number;
  taskId: number;
  entryDate: string;
  recordedBy: string | null;
};

/** Display names for whoever saved these entries, by profile id. */
export async function savedByNames(
  supabase: Supabase,
  ids: (string | null)[]
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
  const names = new Map<string, string>();
  if (unique.length === 0) return names;
  const { data } = await supabase
    .from("profiles")
    .select("id, first_name, last_name")
    .in("id", unique);
  for (const profile of data ?? []) {
    const name = `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim();
    if (name) names.set(profile.id, name);
  }
  return names;
}

/** A progress entry row's own four costs (0057_progress_entry_costs.sql)
 * — 0 for any column a not-yet-migrated DB doesn't have. */
export function entryCosts(row: {
  labor_cost?: number | null;
  material_cost?: number | null;
  equipment_cost?: number | null;
  other_cost?: number | null;
}): CostAmounts {
  return {
    labor: row.labor_cost ?? 0,
    material: row.material_cost ?? 0,
    equipment: row.equipment_cost ?? 0,
    other: row.other_cost ?? 0,
  };
}

/**
 * Every Daily Progress Update entry for these tasks, oldest first, each
 * with its own day's material usage attached. Every entry is its own
 * day's *increment*, not a running total (see
 * 0040_task_progress_tracking.sql), so a task's saved standing is just
 * the sum of its entries. "*" rather than a column list, so a DB missing
 * a newer column (e.g. 0057's costs) still loads. Two queries rather than
 * one embedded select — neither table declares a Relationships entry in
 * lib/supabase/types.ts for the typed client to embed through.
 */
async function fetchEntries(supabase: Supabase, taskIds: number[]): Promise<Entry[]> {
  const { data: entries, error: entriesError } = await supabase
    .from("task_progress_entries")
    .select("*")
    .in("task_id", taskIds)
    .order("entry_date", { ascending: true });

  // Logged rather than swallowed — a not-yet-run migration or an RLS
  // denial otherwise just looks like "no progress ever recorded."
  if (entriesError) {
    console.error("[task-progress] entries query failed:", entriesError.message);
  }

  const rows = entries ?? [];
  const materialsByEntry = new Map<number, Record<string, number>>();
  const unplannedByEntry = new Map<number, UnplannedMaterial[]>();
  const equipmentCostsByEntry = new Map<number, Record<string, number>>();
  const unplannedEquipmentByEntry = new Map<number, UnplannedOtherCost[]>();
  const otherCostsByEntry = new Map<number, Record<string, number>>();
  const unplannedOtherByEntry = new Map<number, UnplannedOtherCost[]>();

  if (rows.length > 0) {
    const entryIds = rows.map((row) => row.id);
    // "*" so a DB without 0073's unit_cost yet still loads.
    const { data: materialRows, error: materialsError } = await supabase
      .from("task_progress_material_entries")
      .select("*")
      .in("progress_entry_id", entryIds);

    if (materialsError) {
      console.error(
        "[task-progress] material entries query failed:",
        materialsError.message
      );
    }

    for (const row of materialRows ?? []) {
      // A unit cost of its own marks a material not on the planned lines.
      if (row.unit_cost !== null && row.unit_cost !== undefined) {
        const list = unplannedByEntry.get(row.progress_entry_id) ?? [];
        list.push({
          name: row.material_name,
          unit: row.unit,
          quantity: Number(row.quantity_used) || 0,
          unitCost: Number(row.unit_cost) || 0,
        });
        unplannedByEntry.set(row.progress_entry_id, list);
        continue;
      }
      const usage = materialsByEntry.get(row.progress_entry_id) ?? {};
      const key = materialKey(row.material_name, row.unit);
      usage[key] = (usage[key] ?? 0) + (row.quantity_used ?? 0);
      materialsByEntry.set(row.progress_entry_id, usage);
    }

    const { data: otherRows, error: otherError } = await (
      supabase as unknown as {
        from: (table: string) => {
          select: (cols: string) => {
            in: (
              col: string,
              vals: number[]
            ) => Promise<{
              data:
                | {
                    progress_entry_id: number;
                    cost_name: string;
                    amount: number;
                    unplanned?: boolean | null;
                  }[]
                | null;
              error: { code?: string; message: string } | null;
            }>;
          };
        };
      }
    )
      .from("task_progress_other_cost_entries")
      .select("*")
      .in("progress_entry_id", entryIds);

    if (
      otherError &&
      otherError.code !== "PGRST205" &&
      otherError.code !== "42P01"
    ) {
      console.error(
        "[task-progress] other cost entries query failed:",
        otherError.message
      );
    }

    for (const row of otherRows ?? []) {
      const amount = Number(row.amount) || 0;
      if (row.unplanned) {
        const list = unplannedOtherByEntry.get(row.progress_entry_id) ?? [];
        list.push({ name: row.cost_name, amount });
        unplannedOtherByEntry.set(row.progress_entry_id, list);
        continue;
      }
      const spend = otherCostsByEntry.get(row.progress_entry_id) ?? {};
      const key = otherCostKey(row.cost_name);
      spend[key] = (spend[key] ?? 0) + amount;
      otherCostsByEntry.set(row.progress_entry_id, spend);
    }

    const { data: equipmentRows, error: equipmentError } = await (
      supabase as unknown as {
        from: (table: string) => {
          select: (cols: string) => {
            in: (
              col: string,
              vals: number[]
            ) => Promise<{
              data:
                | {
                    progress_entry_id: number;
                    cost_name: string;
                    amount: number;
                    unplanned?: boolean | null;
                  }[]
                | null;
              error: { code?: string; message: string } | null;
            }>;
          };
        };
      }
    )
      .from("task_progress_equipment_cost_entries")
      .select("*")
      .in("progress_entry_id", entryIds);

    if (
      equipmentError &&
      equipmentError.code !== "PGRST205" &&
      equipmentError.code !== "42P01"
    ) {
      console.error(
        "[task-progress] equipment cost entries query failed:",
        equipmentError.message
      );
    }

    for (const row of equipmentRows ?? []) {
      const amount = Number(row.amount) || 0;
      if (row.unplanned) {
        const list = unplannedEquipmentByEntry.get(row.progress_entry_id) ?? [];
        list.push({ name: row.cost_name, amount });
        unplannedEquipmentByEntry.set(row.progress_entry_id, list);
        continue;
      }
      const spend = equipmentCostsByEntry.get(row.progress_entry_id) ?? {};
      const key = otherCostKey(row.cost_name);
      spend[key] = (spend[key] ?? 0) + amount;
      equipmentCostsByEntry.set(row.progress_entry_id, spend);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    entryDate: row.entry_date,
    quantityCompleted: row.quantity_completed ?? 0,
    costs: entryCosts(row),
    materialUsage: materialsByEntry.get(row.id) ?? {},
    unplannedMaterials: unplannedByEntry.get(row.id) ?? [],
    equipmentCostSpend: equipmentCostsByEntry.get(row.id) ?? {},
    unplannedEquipmentCosts: unplannedEquipmentByEntry.get(row.id) ?? [],
    otherCostSpend: otherCostsByEntry.get(row.id) ?? {},
    unplannedOtherCosts: unplannedOtherByEntry.get(row.id) ?? [],
    recordedBy: row.recorded_by ?? null,
  }));
}

function emptyAnchor(): ProgressAnchor & {
  loggedDates: string[];
  cumulativeUnplannedMaterialCost: number;
  cumulativeEquipmentCostSpend: Record<string, number>;
  cumulativeOtherCostSpend: Record<string, number>;
} {
  return {
    cumulativeQuantityCompleted: 0,
    cumulativeMaterialUsage: {},
    cumulativeEquipmentCostSpend: {},
    cumulativeOtherCostSpend: {},
    cumulativeCosts: { ...ZERO_COSTS },
    cumulativeUnplannedMaterialCost: 0,
    loggedDates: [],
  };
}

function addEntry(anchor: ReturnType<typeof emptyAnchor>, entry: Entry) {
  anchor.cumulativeQuantityCompleted += entry.quantityCompleted;
  for (const [key, quantity] of Object.entries(entry.materialUsage)) {
    anchor.cumulativeMaterialUsage[key] =
      (anchor.cumulativeMaterialUsage[key] ?? 0) + quantity;
  }
  for (const [key, amount] of Object.entries(entry.equipmentCostSpend ?? {})) {
    anchor.cumulativeEquipmentCostSpend[key] =
      (anchor.cumulativeEquipmentCostSpend[key] ?? 0) + amount;
  }
  for (const [key, amount] of Object.entries(entry.otherCostSpend ?? {})) {
    anchor.cumulativeOtherCostSpend[key] =
      (anchor.cumulativeOtherCostSpend[key] ?? 0) + amount;
  }
  anchor.cumulativeCosts.labor += entry.costs.labor;
  anchor.cumulativeCosts.material += entry.costs.material;
  anchor.cumulativeCosts.equipment += entry.costs.equipment;
  anchor.cumulativeCosts.other += entry.costs.other;
  anchor.cumulativeUnplannedMaterialCost += unplannedMaterialCost(entry.unplannedMaterials);
  anchor.loggedDates.push(entry.entryDate);
}

export async function listTaskProgressAnchors(
  taskIds: number[]
): Promise<TaskProgressAnchors> {
  if (taskIds.length === 0) return {};
  const supabase = await createClient();
  const entries = await fetchEntries(supabase, taskIds);

  const result: Record<number, ReturnType<typeof emptyAnchor>> = {};
  for (const entry of entries) {
    const anchor = (result[entry.taskId] ??= emptyAnchor());
    addEntry(anchor, entry);
  }
  return result;
}

/** Local calendar date as `YYYY-MM-DD` — matches toLocalDate's own
 * parsing convention in lib/task-progress/calculate.ts (local midnight,
 * never UTC). */
function todayIso() {
  return new Date().toLocaleDateString("en-CA");
}

/**
 * Every task's own saved totals plus whatever's already saved for today,
 * for a whole project's worth of tasks — fetched server-side alongside
 * everything else and handed to the Daily Progress Update modal as a
 * plain prop, same "server pre-fetches everything, no per-open client
 * fetch" convention every other Gantt modal follows.
 */
export async function listTaskProgressToday(
  projectId: number
): Promise<Record<number, TaskProgressToday>> {
  const supabase = await createClient();

  // task_progress_entries has no project_id column of its own (it hangs
  // off task_id) — same "fetch this project's task ids first" shape
  // listTaskWorkerAssignments already uses for the identical reason.
  const { data: taskRows } = await supabase
    .from("estimate_tasks")
    .select("id")
    .eq("project_id", projectId);
  const taskIds = (taskRows ?? []).map((row) => row.id);
  if (taskIds.length === 0) return {};

  const today = todayIso();
  const entries = await fetchEntries(supabase, taskIds);

  const result: Record<number, ReturnType<typeof emptyAnchor> & {
    today: ProgressDayEntry | null;
    latest: LatestOverride | null;
    todayAttendance: AttendanceMark[];
  }> = {};
  for (const taskId of taskIds) {
    result[taskId] = { ...emptyAnchor(), today: null, latest: null, todayAttendance: [] };
  }
  const todayEntryTask = new Map<number, number>();
  // Oldest first, so each task's last entry is its latest override.
  const latestByTask = new Map<number, Entry>();
  for (const entry of entries) {
    const progress = result[entry.taskId];
    if (!progress) continue;
    addEntry(progress, entry);
    latestByTask.set(entry.taskId, entry);
    if (entry.entryDate === today) {
      progress.today = {
        quantityCompleted: entry.quantityCompleted,
        costs: entry.costs,
        materialUsage: entry.materialUsage,
        unplannedMaterials: entry.unplannedMaterials,
        equipmentCostSpend: entry.equipmentCostSpend,
        unplannedEquipmentCosts: entry.unplannedEquipmentCosts,
        otherCostSpend: entry.otherCostSpend,
        unplannedOtherCosts: entry.unplannedOtherCosts,
      };
      todayEntryTask.set(entry.id, entry.taskId);
    }
  }
  const attendance = await attendanceByEntry(
    supabase,
    "task",
    Array.from(todayEntryTask.keys())
  );
  for (const [entryId, marks] of attendance) {
    const taskId = todayEntryTask.get(entryId);
    if (taskId !== undefined) result[taskId].todayAttendance = marks;
  }
  const names = await savedByNames(
    supabase,
    Array.from(latestByTask.values(), (entry) => entry.recordedBy)
  );
  for (const [taskId, entry] of latestByTask) {
    result[taskId].latest = {
      quantityCompleted: entry.quantityCompleted,
      costs: entry.costs,
      materialUsage: entry.materialUsage,
      unplannedMaterials: entry.unplannedMaterials,
      equipmentCostSpend: entry.equipmentCostSpend,
      unplannedEquipmentCosts: entry.unplannedEquipmentCosts,
      otherCostSpend: entry.otherCostSpend,
      unplannedOtherCosts: entry.unplannedOtherCosts,
      entryDate: entry.entryDate,
      savedByName: (entry.recordedBy && names.get(entry.recordedBy)) || null,
    };
  }
  return result;
}
