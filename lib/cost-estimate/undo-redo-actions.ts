"use server";

import { revalidateProjectPaths } from "@/lib/projects/revalidate";
import { createClient } from "@/lib/supabase/server";
import { requireProjectAccess } from "@/lib/auth/project-access";
import { getCostEstimate } from "@/lib/cost-estimate/data";
import type { CostEstimateActionState } from "@/lib/cost-estimate/actions";

async function moveGanttHistory(projectId: number, direction: "undo" | "redo"): Promise<CostEstimateActionState> {
  try {
    if (!await requireProjectAccess(projectId)) return { error: "You are not authorized to edit this project." };
    const client = await createClient();
    // Rows, dependencies, cursor and history state commit together or all roll back.
    const { data, error } = await client.rpc("gantt_history", { p_project_id: projectId, p_action: direction });
    if (error) return { error: ["40001", "55000", "P0002", "42501"].includes(error.code)
      ? error.message : "Could not restore the schedule. Please try again." };
    const state = data as { canUndo: boolean; canRedo: boolean };
    revalidateProjectPaths(projectId);
    // Return the restored estimate directly; no second history-state round trip.
    try {
      const estimate = await getCostEstimate(projectId);
      return { success: true, categories: estimate.categories, ...state };
    } catch {
      return { success: true, ...state };
    }
  } catch {
    return { error: "Could not reach the server. Please try again." };
  }
}

export async function undoGanttAction(projectId: number): Promise<CostEstimateActionState> {
  return moveGanttHistory(projectId, "undo");
}
export async function redoGanttAction(projectId: number): Promise<CostEstimateActionState> {
  return moveGanttHistory(projectId, "redo");
}

/** Begin a new visit with a complete, atomic baseline before any queued edits. */
export async function resetGanttHistory(projectId: number): Promise<void> {
  if (!await requireProjectAccess(projectId)) throw new Error("You are not authorized to edit this project.");
  const client = await createClient();
  const { error } = await client.rpc("gantt_history", { p_project_id: projectId, p_action: "reset" });
  if (error) throw new Error("Could not initialize schedule history. Refresh the project and retry.");
}
