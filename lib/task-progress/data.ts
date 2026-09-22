import { createClient } from "@/lib/supabase/server";
import type { ProgressAnchor } from "@/lib/task-progress/calculate";

/** Every task's own progress anchor (see ProgressAnchor's own doc
 * comment) for a whole project's worth of tasks in one query — powers
 * computeAutoPercentComplete inside getCostEstimate. Keyed by task id;
 * a task with no Progress Tracking Override recorded yet is simply
 * absent (reads as `undefined`, same as ProgressAnchor's own `null`
 * case for "no override yet"). */
export type TaskProgressAnchors = Record<number, ProgressAnchor>;

/**
 * Every entry is its own day's *increment*, not a running total (see
 * 0040_task_progress_tracking.sql) — a task's cumulative standing as of
 * its own latest entry is just the sum of every entry it has, since
 * every entry necessarily falls on or before that latest date. Fetched
 * broadly and grouped in JS, same "fetch this project's rows in one
 * query" convention every other per-task lookup in this app already
 * uses (e.g. listTaskWorkerAssignments).
 */
export async function listTaskProgressAnchors(
  taskIds: number[]
): Promise<TaskProgressAnchors> {
  if (taskIds.length === 0) return {};
  const supabase = await createClient();

  const { data } = await supabase
    .from("task_progress_entries")
    .select("task_id, entry_date, quantity_completed")
    .in("task_id", taskIds);

  const sums = new Map<number, number>();
  const latestDates = new Map<number, string>();
  for (const row of data ?? []) {
    sums.set(
      row.task_id,
      (sums.get(row.task_id) ?? 0) + (row.quantity_completed ?? 0)
    );
    const current = latestDates.get(row.task_id);
    if (!current || row.entry_date > current) {
      latestDates.set(row.task_id, row.entry_date);
    }
  }

  const result: TaskProgressAnchors = {};
  for (const [taskId, entryDate] of latestDates) {
    result[taskId] = {
      entryDate,
      cumulativeQuantityCompleted: sums.get(taskId) ?? 0,
    };
  }
  return result;
}

export type TaskProgressToday = {
  /** Sum of every day ever recorded for this task — what Automatic
   * Progress Completion's own anchor is based on, shown in the
   * Progress Tracking modal for context ("X of Y done so far"). */
  cumulativeQuantityCompleted: number;
  /** This task's own entry for *today* specifically, if one was
   * already recorded (e.g. the admin already logged progress once
   * today and is reopening the modal to correct it) — pre-fills the
   * Progress Tracking Override form instead of it starting blank. Null
   * means nothing's been recorded yet today. */
  today: {
    quantityCompleted: number;
    laborHeadcount: number;
    materials: { materialId: number; quantity: number }[];
  } | null;
};

/** Local calendar date as `YYYY-MM-DD` — matches toLocalDate's own
 * parsing convention in lib/task-progress/calculate.ts (local midnight,
 * never UTC). */
function todayIso() {
  return new Date().toLocaleDateString("en-CA");
}

/**
 * Every task's own cumulative-to-date total plus whatever's already
 * recorded for today, for a whole project's worth of tasks in one pass
 * — fetched server-side alongside everything else (see page.tsx) and
 * handed to the Progress Tracking modal as a plain prop, same
 * "server pre-fetches everything, no per-open client fetch" convention
 * every other Gantt modal in this app already follows (Members,
 * Assign Workers, ...).
 */
export async function listTaskProgressToday(
  projectId: number
): Promise<Record<number, TaskProgressToday>> {
  const supabase = await createClient();

  // task_progress_entries has no project_id column of its own (it hangs
  // off task_id, which already implies one) — same "fetch this
  // project's task ids first" shape listTaskWorkerAssignments already
  // uses for the identical reason.
  const { data: taskRows } = await supabase
    .from("estimate_tasks")
    .select("id")
    .eq("project_id", projectId);
  const taskIds = (taskRows ?? []).map((row) => row.id);
  if (taskIds.length === 0) return {};

  const today = todayIso();

  const { data: entries } = await supabase
    .from("task_progress_entries")
    .select("id, task_id, entry_date, quantity_completed, labor_headcount")
    .in("task_id", taskIds);

  const cumulative = new Map<number, number>();
  const todayEntryByTask = new Map<
    number,
    { id: number; quantityCompleted: number; laborHeadcount: number }
  >();
  for (const row of entries ?? []) {
    cumulative.set(
      row.task_id,
      (cumulative.get(row.task_id) ?? 0) + (row.quantity_completed ?? 0)
    );
    if (row.entry_date === today) {
      todayEntryByTask.set(row.task_id, {
        id: row.id,
        quantityCompleted: row.quantity_completed ?? 0,
        laborHeadcount: row.labor_headcount ?? 0,
      });
    }
  }

  const todayEntryIds = Array.from(todayEntryByTask.values()).map((e) => e.id);
  const materialsByEntryId = new Map<
    number,
    { materialId: number; quantity: number }[]
  >();
  if (todayEntryIds.length > 0) {
    const { data: usageRows } = await supabase
      .from("task_progress_material_usage")
      .select("progress_entry_id, material_id, quantity")
      .in("progress_entry_id", todayEntryIds);
    for (const row of usageRows ?? []) {
      const list = materialsByEntryId.get(row.progress_entry_id) ?? [];
      list.push({ materialId: row.material_id, quantity: row.quantity ?? 0 });
      materialsByEntryId.set(row.progress_entry_id, list);
    }
  }

  const result: Record<number, TaskProgressToday> = {};
  for (const taskId of taskIds) {
    const todayEntry = todayEntryByTask.get(taskId);
    result[taskId] = {
      cumulativeQuantityCompleted: cumulative.get(taskId) ?? 0,
      today: todayEntry
        ? {
            quantityCompleted: todayEntry.quantityCompleted,
            laborHeadcount: todayEntry.laborHeadcount,
            materials: materialsByEntryId.get(todayEntry.id) ?? [],
          }
        : null,
    };
  }
  return result;
}
