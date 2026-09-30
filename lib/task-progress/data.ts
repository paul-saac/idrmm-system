import { createClient } from "@/lib/supabase/server";
import { materialKey, type ProgressAnchor } from "@/lib/task-progress/calculate";

/** Every task's own cumulative totals (see ProgressAnchor's own doc
 * comment) for a whole project's worth of tasks — powers
 * computeAutoPercentComplete inside getCostEstimate. Keyed by task id;
 * a task with no Progress Tracking Override recorded yet is simply
 * absent (callers fall back to EMPTY_PROGRESS_ANCHOR). */
export type TaskProgressAnchors = Record<number, ProgressAnchor>;

export type TaskProgressToday = {
  /** Quantity used so far per material (keyed by materialKey), across
   * every day ever recorded — shown in the Progress Tracking modal as
   * each material's own "used so far." */
  cumulativeMaterialUsage: Record<string, number>;
  /** Worker-days logged so far, across every day ever recorded. */
  cumulativeLaborHeadcount: number;
  /** This task's own entry for *today* specifically, if one was
   * already recorded (e.g. the admin is reopening the modal to correct
   * it) — pre-fills the form instead of it starting blank. Null means
   * nothing's been recorded yet today. */
  today: {
    laborHeadcount: number;
    materialUsage: Record<string, number>;
    percentCompleteOverride: number | null;
  } | null;
};

type Supabase = Awaited<ReturnType<typeof createClient>>;

type EntryWithMaterials = {
  taskId: number;
  entryDate: string;
  laborHeadcount: number;
  percentCompleteOverride: number | null;
  /** That day's own usage per material, keyed by materialKey. */
  materials: Record<string, number>;
};

/**
 * Every Progress Tracking Override entry for these tasks, oldest first,
 * each with its own day's material usage attached. Every entry is its
 * own day's *increment*, not a running total (see
 * 0040_task_progress_tracking.sql), so a task's cumulative standing is
 * just the sum of its entries. Two queries rather than one embedded
 * select — neither table declares a Relationships entry in
 * lib/supabase/types.ts for the typed client to embed through.
 */
async function fetchEntriesWithMaterials(
  supabase: Supabase,
  taskIds: number[]
): Promise<EntryWithMaterials[]> {
  const { data: entries, error: entriesError } = await supabase
    .from("task_progress_entries")
    .select("id, task_id, entry_date, labor_headcount, percent_complete_override")
    .in("task_id", taskIds)
    .order("entry_date", { ascending: true });

  // Logged rather than swallowed — a not-yet-run migration or an RLS
  // denial otherwise just looks like "no progress ever recorded."
  if (entriesError) {
    console.error("[task-progress] entries query failed:", entriesError.message);
  }

  const rows = entries ?? [];
  const materialsByEntry = new Map<number, Record<string, number>>();

  if (rows.length > 0) {
    const { data: materialRows, error: materialsError } = await supabase
      .from("task_progress_material_entries")
      .select("progress_entry_id, material_name, unit, quantity_used")
      .in(
        "progress_entry_id",
        rows.map((row) => row.id)
      );

    if (materialsError) {
      console.error(
        "[task-progress] material entries query failed:",
        materialsError.message
      );
    }

    for (const row of materialRows ?? []) {
      const usage = materialsByEntry.get(row.progress_entry_id) ?? {};
      const key = materialKey(row.material_name, row.unit);
      usage[key] = (usage[key] ?? 0) + (row.quantity_used ?? 0);
      materialsByEntry.set(row.progress_entry_id, usage);
    }
  }

  return rows.map((row) => ({
    taskId: row.task_id,
    entryDate: row.entry_date,
    laborHeadcount: row.labor_headcount ?? 0,
    percentCompleteOverride: row.percent_complete_override,
    materials: materialsByEntry.get(row.id) ?? {},
  }));
}

function addEntryTotals(
  target: { cumulativeMaterialUsage: Record<string, number>; cumulativeLaborHeadcount: number },
  entry: EntryWithMaterials
) {
  for (const [key, quantity] of Object.entries(entry.materials)) {
    target.cumulativeMaterialUsage[key] =
      (target.cumulativeMaterialUsage[key] ?? 0) + quantity;
  }
  target.cumulativeLaborHeadcount += entry.laborHeadcount;
}

export async function listTaskProgressAnchors(
  taskIds: number[]
): Promise<TaskProgressAnchors> {
  if (taskIds.length === 0) return {};
  const supabase = await createClient();
  const entries = await fetchEntriesWithMaterials(supabase, taskIds);

  const result: TaskProgressAnchors = {};
  for (const entry of entries) {
    const anchor = result[entry.taskId] ?? {
      cumulativeMaterialUsage: {},
      cumulativeLaborHeadcount: 0,
      latestPercentCompleteOverride: null,
    };
    addEntryTotals(anchor, entry);
    // Entries arrive oldest-first, so whichever entry is processed last
    // is the latest one — a newer entry saved without an override
    // correctly clears an older one's.
    anchor.latestPercentCompleteOverride = entry.percentCompleteOverride;
    result[entry.taskId] = anchor;
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
 * Every task's own cumulative-to-date totals plus whatever's already
 * recorded for today, for a whole project's worth of tasks — fetched
 * server-side alongside everything else (see page.tsx) and handed to
 * the Progress Tracking modal as a plain prop, same "server pre-fetches
 * everything, no per-open client fetch" convention every other Gantt
 * modal in this app already follows.
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
  const entries = await fetchEntriesWithMaterials(supabase, taskIds);

  const result: Record<number, TaskProgressToday> = {};
  for (const taskId of taskIds) {
    result[taskId] = {
      cumulativeMaterialUsage: {},
      cumulativeLaborHeadcount: 0,
      today: null,
    };
  }
  for (const entry of entries) {
    const progress = result[entry.taskId];
    if (!progress) continue;
    addEntryTotals(progress, entry);
    if (entry.entryDate === today) {
      progress.today = {
        laborHeadcount: entry.laborHeadcount,
        materialUsage: entry.materials,
        percentCompleteOverride: entry.percentCompleteOverride,
      };
    }
  }
  return result;
}
