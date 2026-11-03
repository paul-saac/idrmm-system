"use server";

import { revalidateProjectPaths } from "@/lib/projects/revalidate";
import { createClient } from "@/lib/supabase/server";
import { requireProjectAccess } from "@/lib/auth/project-access";
import { getCostEstimate } from "@/lib/cost-estimate/data";
import type { CostEstimateActionState } from "@/lib/cost-estimate/actions";

async function moveGanttHistory(projectId: number, direction: "undo" | "redo", includeCategories: boolean): Promise<CostEstimateActionState> {
  try {
    if (!await requireProjectAccess(projectId)) return { error: "You are not authorized to edit this project." };
    const client = await createClient();
    // Rows, dependencies, cursor and history state commit together or all roll back.
    const { data, error } = await client.rpc("gantt_history", { p_project_id: projectId, p_action: direction });
    if (error) return { error: ["40001", "55000", "P0002", "42501"].includes(error.code)
      ? error.message : "Could not restore the schedule. Please try again." };
    const state = data as { canUndo: boolean; canRedo: boolean };
    // Return the restored estimate directly; no second history-state round trip.
    if (!includeCategories) return { success: true, ...state };
    revalidateProjectPaths(projectId);
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

export async function undoGanttAction(projectId: number, includeCategories = true): Promise<CostEstimateActionState> {
  return moveGanttHistory(projectId, "undo", includeCategories);
}
export async function redoGanttAction(projectId: number, includeCategories = true): Promise<CostEstimateActionState> {
  return moveGanttHistory(projectId, "redo", includeCategories);
}

/** Ensure a baseline without erasing this editor's saved import/Undo history. */
export async function resetGanttHistory(projectId: number): Promise<{ canUndo: boolean; canRedo: boolean }> {
  if (!await requireProjectAccess(projectId)) throw new Error("You are not authorized to edit this project.");
  const client = await createClient();
  const { data, error } = await client.rpc("gantt_history", { p_project_id: projectId, p_action: "checkpoint" });
  if (error) throw new Error("Could not initialize schedule history. Refresh the project and retry.");
  return data as { canUndo: boolean; canRedo: boolean };
}
