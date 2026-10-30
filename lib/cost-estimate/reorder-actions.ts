"use server";

import { requireProjectAccess } from "@/lib/auth/project-access";
import { createClient } from "@/lib/supabase/server";
import { revalidateProjectPaths } from "@/lib/projects/revalidate";
import { recordGanttCheckpoint } from "./undo-redo";
import type { ScheduleRowMove, ScheduleRowOrder } from "./schedule-order";

export async function moveScheduleRow(projectId: number, move: ScheduleRowMove): Promise<{ error?: string; order?: ScheduleRowOrder }> {
  try {
    if (!move || !["category", "task"].includes(move.kind) || typeof move.after !== "boolean" ||
      !Number.isSafeInteger(move.id) || move.id <= 0 || !Number.isSafeInteger(move.targetId) || move.targetId <= 0 || move.id === move.targetId) {
      return { error: "Choose a saved task and a different position." };
    }
    const profile = await requireProjectAccess(projectId);
    if (!profile) return { error: "You do not have permission to reorder this project's tasks." };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("move_estimate_row", {
      p_project_id: projectId, p_kind: move.kind, p_row_id: move.id,
      p_target_id: move.targetId, p_after: move.after,
    });
    if (error) {
      if (["PGRST202", "42883", "42703", "PGRST204"].includes(error.code)) {
        return { error: "Task ordering is not configured. Run migration 0107_estimate_row_order.sql, then retry." };
      }
      return { error: error.code === "22023"
        ? "This position is no longer available. Refresh the chart and try again. Subtasks must stay within their main task."
        : "Could not save the task order. Your previous order has been restored." };
    }
    // The RPC returns the authoritative sibling order from the same transaction.
    const result = data as unknown as { category_id: number | null; ids: number[] };
    await recordGanttCheckpoint(supabase, projectId, profile.id);
    revalidateProjectPaths(projectId);
    return { order: { kind: move.kind, categoryId: result.category_id, ids: result.ids } };
  } catch {
    return { error: "Could not save the task order. Please try again." };
  }
}
