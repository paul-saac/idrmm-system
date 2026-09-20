"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";
import { restoreGanttSnapshot, type GanttSnapshot } from "@/lib/cost-estimate/undo-redo";
import type { CostEstimateActionState } from "@/lib/cost-estimate/actions";

async function requireAdmin() {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") return null;
  return profile;
}

/**
 * Shared by undoGanttAction/redoGanttAction below — they only differ in
 * which direction they look for a target checkpoint. Neither one records
 * a new checkpoint of its own (recordGanttCheckpoint is only called by
 * the 10 mutating actions in actions.ts) — doing so here would
 * immediately wipe out the very "redo" entries an undo just moved past.
 */
async function moveGanttHistory(
  projectId: number,
  direction: "undo" | "redo"
): Promise<CostEstimateActionState> {
  const profile = await requireAdmin();
  if (!profile) {
    return { error: "You are not authorized to manage cost estimates." };
  }

  const supabase = await createClient();

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, gantt_undo_cursor_id")
    .eq("id", projectId)
    .single();

  if (projectError || !project) {
    return { error: "Project not found." };
  }

  const cursorId = project.gantt_undo_cursor_id;
  if (cursorId === null) {
    return { error: direction === "undo" ? "Nothing to undo." : "Nothing to redo." };
  }

  const { data: target } =
    direction === "undo"
      ? await supabase
          .from("gantt_snapshots")
          .select("id, snapshot")
          .eq("project_id", projectId)
          .lt("id", cursorId)
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle()
      : await supabase
          .from("gantt_snapshots")
          .select("id, snapshot")
          .eq("project_id", projectId)
          .gt("id", cursorId)
          .order("id", { ascending: true })
          .limit(1)
          .maybeSingle();

  if (!target) {
    return { error: direction === "undo" ? "Nothing to undo." : "Nothing to redo." };
  }

  try {
    await restoreGanttSnapshot(supabase, projectId, target.snapshot as GanttSnapshot);
  } catch (error) {
    console.error(`[${direction}GanttAction] restore failed`, error);
    return { error: "Could not restore the previous state. Please try again." };
  }

  await supabase
    .from("projects")
    .update({ gantt_undo_cursor_id: target.id })
    .eq("id", projectId);

  revalidatePath(`/admin/projects/${projectId}`);
  return { success: true };
}

export async function undoGanttAction(
  projectId: number
): Promise<CostEstimateActionState> {
  return moveGanttHistory(projectId, "undo");
}

export async function redoGanttAction(
  projectId: number
): Promise<CostEstimateActionState> {
  return moveGanttHistory(projectId, "redo");
}
