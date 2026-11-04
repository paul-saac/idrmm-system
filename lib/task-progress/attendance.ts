import type { PostgrestError } from "@supabase/supabase-js";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Hourly work or a subcontractor's fixed daily amount; unused rows are omitted. */
export type AttendanceInput = { workerId: number; hours: number; amount?: number }[];

type AttendanceRow = {
  worker_id: number;
  worker_name: string;
  hours: number;
  hourly_rate: number;
  fixed_amount?: number;
};

export type ResolvedAttendance = {
  /** Hourly costs plus subcontractors' fixed daily amounts. */
  laborCost: number;
  rows: AttendanceRow[];
};

// Nobody works more than a day's hours, all tasks and phases together.
const MAX_HOURS_A_DAY = 24;

// A table or function a not-yet-run migration hasn't made.
function isMissing(error: PostgrestError) {
  return error.code === "PGRST205" || error.code === "42P01" || error.code === "PGRST202";
}

function formatHours(hours: number) {
  const value = Math.round(hours * 100) / 100;
  return `${value} hr${value === 1 ? "" : "s"}`;
}

/**
 * Checks a day's attendance (0068/0069) and prices it from each member's
 * own Default Rate — read here, never taken from the browser — at the
 * hours each employee worked, or a subcontractor's entered daily amount.
 * Nobody is counted past 24 hourly hours that day: what
 * they're already counted on every other task and phase, any project, is
 * added in.
 */
export async function resolveAttendance(
  supabase: Supabase,
  attendance: unknown,
  entryDate: string,
  item: { taskId: number } | { categoryId: number }
): Promise<{ error: string } | ResolvedAttendance> {
  const marks: unknown[] = Array.isArray(attendance) ? attendance : [];
  const hoursByWorker = new Map<number, number>();
  const amountsByWorker = new Map<number, number>();
  for (const mark of marks) {
    const { workerId, hours, amount } = (mark ?? {}) as { workerId?: unknown; hours?: unknown; amount?: unknown };
    const id = Number(workerId);
    const worked = Math.round(Number(hours) * 100) / 100;
    if (!Number.isInteger(id) || id <= 0) {
      return { error: "Someone on the list isn't on the team." };
    }
    const fixed = amount !== undefined;
    if (fixed && (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount >= 1e12 || Number(hours) !== 0)) {
      return { error: "Enter a valid daily subcontractor amount with no hourly time." };
    }
    if (!fixed && (!Number.isFinite(worked) || worked <= 0 || worked > MAX_HOURS_A_DAY)) {
      return { error: "Hours worked must be more than 0 and at most 24." };
    }
    if (hoursByWorker.has(id)) {
      return { error: "Someone's listed twice." };
    }
    hoursByWorker.set(id, worked);
    if (fixed) amountsByWorker.set(id, Math.round((amount as number) * 100) / 100);
  }
  if (hoursByWorker.size === 0) return { laborCost: 0, rows: [] };

  const ids = Array.from(hoursByWorker.keys());
  // "*" so a member read before 0069 (no hourly_rate yet) still loads.
  const { data: workers, error } = await supabase.from("workers").select("*").in("id", ids);
  if (error) {
    console.error("[attendance] Could not read the crew:", error.message);
    return { error: "Could not read the crew's rates. Please try again." };
  }
  const workerById = new Map((workers ?? []).map((worker) => [worker.id, worker]));
  for (const id of ids) {
    const worker = workerById.get(id);
    if (!worker) {
      return { error: "Someone on the list is no longer on the team." };
    }
    if (worker.employment_type === "subcontractor") {
      if (!amountsByWorker.has(id)) return { error: `Enter ${worker.full_name}'s daily subcontractor amount instead of hours.` };
      continue;
    }
    if (amountsByWorker.has(id)) return { error: `${worker.full_name}'s labor must be calculated from hours and their saved rate.` };
    if (worker.category !== "skilled") {
      return {
        error: `Only skilled workers are counted by the hour — ${worker.full_name} isn't one.`,
      };
    }
  }

  const hourlyIds = ids.filter(id => !amountsByWorker.has(id));
  const { data: elsewhere, error: elsewhereError } = hourlyIds.length ? await supabase.rpc("attendance_elsewhere", {
    p_date: entryDate,
    p_worker_ids: hourlyIds,
    p_task_id: "taskId" in item ? item.taskId : null,
    p_category_id: "categoryId" in item ? item.categoryId : null,
  }) : { data: [], error: null };
  if (elsewhereError && !isMissing(elsewhereError)) {
    console.error("[attendance] Elsewhere check failed:", elsewhereError.message);
    return { error: "Could not check today's attendance. Please try again." };
  }
  for (const id of hourlyIds) {
    const others = (elsewhere ?? []).filter((row) => row.worker_id === id);
    const counted = others.reduce((sum, row) => sum + Number(row.hours), 0);
    if (counted + (hoursByWorker.get(id) ?? 0) > MAX_HOURS_A_DAY) {
      const name = workerById.get(id)?.full_name ?? "Someone";
      const where = Array.from(new Set(others.map((row) => row.item_name))).join(", ");
      return {
        error: `${name} is already counted ${formatHours(counted)} on ${where} today — that's more than a day with these.`,
      };
    }
  }

  const rows = ids.map((id) => {
    const worker = workerById.get(id)!;
    return {
      worker_id: id,
      worker_name: worker.full_name,
      hours: hoursByWorker.get(id)!,
      hourly_rate: amountsByWorker.has(id) ? 0 : Number(worker.hourly_rate) || 0,
      ...(amountsByWorker.has(id) ? { fixed_amount: amountsByWorker.get(id)! } : {}),
    };
  });
  const laborCost =
    Math.round(rows.reduce((sum, row) => sum + (row.fixed_amount ?? row.hourly_rate * row.hours), 0) * 100) / 100;
  return { laborCost, rows };
}

/**
 * Replaces one progress entry's attendance with `rows` — a day saved again
 * replaces who worked, never adds to it. Null when it went through, else
 * the message to show.
 */
export async function replaceAttendance(
  supabase: Supabase,
  kind: "task" | "category",
  entryId: number,
  rows: AttendanceRow[]
): Promise<string | null> {
  const records = rows.map((row) => ({ ...row, progress_entry_id: entryId }));
  const failed = "Could not save who worked today. Please try again.";

  const { error: deleteError } =
    kind === "task"
      ? await supabase.from("task_progress_attendance").delete().eq("progress_entry_id", entryId)
      : await supabase
          .from("category_progress_attendance")
          .delete()
          .eq("progress_entry_id", entryId);
  if (deleteError) {
    // Before 0068 has run there's nothing to replace — fine while nobody's
    // listed.
    if (rows.length === 0 && isMissing(deleteError)) return null;
    console.error("[attendance] Old attendance delete failed:", deleteError.message);
    return failed;
  }
  if (records.length === 0) return null;

  const { error: insertError } =
    kind === "task"
      ? await supabase.from("task_progress_attendance").insert(records)
      : await supabase.from("category_progress_attendance").insert(records);
  if (insertError) {
    console.error("[attendance] Attendance insert failed:", insertError.message);
    return failed;
  }
  return null;
}
