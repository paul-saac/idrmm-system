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


/** Cross-category movement and standalone-to-subtask conversion are atomic. */
export async function nestScheduleRow(projectId: number, move: import("./nesting").NestMove): Promise<{ error?: string; taskId?: number }> {
  try {
    const profile = await requireProjectAccess(projectId);
    if (!profile) return { error: "You do not have permission to move this project's tasks." };
    if (!move || !["task", "category"].includes(move.kind) || !Number.isSafeInteger(move.id) || move.id <= 0 ||
        !Number.isSafeInteger(move.categoryId) || move.categoryId <= 0 ||
        move.beforeTaskId != null && (!Number.isSafeInteger(move.beforeTaskId) || move.beforeTaskId <= 0))
      return { error: "Choose a saved task and a main task in this project." };
    const client = await createClient();
    const { data, error } = await client.rpc("nest_estimate_row", { p_project_id: projectId, p_kind: move.kind,
      p_row_id: move.id, p_category_id: move.categoryId, p_before_task_id: move.beforeTaskId });
    if (error) return { error: ["PGRST202", "42883"].includes(error.code)
      ? "Moving tasks into main tasks needs migration 0120_nest_estimate_rows.sql. Apply it and retry."
      : ["22023", "40001", "55000"].includes(error.code) ? error.message : "Could not move this task. The previous structure has been restored." };
    if (!data?.task_id) return { error: "The task move could not be confirmed. Refresh and retry." };
    await recordGanttCheckpoint(client, projectId, profile.id);
    revalidateProjectPaths(projectId);
    return { taskId: data.task_id };
  } catch { return { error: "Could not move the task. The previous structure has been restored." }; }
}

/** Outdent a leaf as one undoable transaction; operational records are protected. */
export async function outdentScheduleRow(projectId: number, move: import("./nesting").OutdentMove): Promise<{ error?: string; categoryId?: number }> {
  try {
    const profile = await requireProjectAccess(projectId);
    if (!profile) return { error: "You do not have permission to move this project's tasks." };
    if (!move || !Number.isSafeInteger(move.id) || move.id <= 0 || !Number.isSafeInteger(move.targetCategoryId) || move.targetCategoryId <= 0 || typeof move.after !== "boolean")
      return { error: "Choose a saved subtask and a position in this project." };
    const client = await createClient();
    const { data, error } = await client.rpc("outdent_estimate_row", { p_project_id: projectId, p_task_id: move.id,
      p_target_category_id: move.targetCategoryId, p_after: move.after });
    if (error) return { error: ["PGRST202", "42883"].includes(error.code)
      ? "Outdenting needs migration 0121_outdent_estimate_rows.sql. Apply it and retry."
      : ["22023", "40001", "55000"].includes(error.code) ? error.message : "Could not outdent this task. Its previous position has been restored." };
    if (!data?.category_id) return { error: "The task move could not be confirmed. Refresh and retry." };
    await recordGanttCheckpoint(client, projectId, profile.id);
    revalidateProjectPaths(projectId);
    return { categoryId: data.category_id };
  } catch { return { error: "Could not outdent the task. Its previous position has been restored." }; }
}
