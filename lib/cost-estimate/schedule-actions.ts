"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProjectAccess } from "@/lib/auth/project-access";
import { revalidateProjectPaths } from "@/lib/projects/revalidate";
import { recordGanttCheckpoint } from "./undo-redo";
import { isScheduleDate, type ScheduleDateChange } from "./schedule-dates";

export async function moveSelectedSchedules(projectId: number, changes: ScheduleDateChange[]) {
  try {
    const profile = await requireProjectAccess(projectId);
    if (!profile) return { error: "You do not have permission to edit this project." };
    if (!Array.isArray(changes) || changes.length === 0 || changes.length > 1000) return { error: "Select between 1 and 1,000 schedule rows." };
    const keys = new Set<string>();
    for (const change of changes) {
      if (!change || !["category", "task"].includes(change.kind) || !Number.isSafeInteger(change.id) || change.id <= 0
        || !isScheduleDate(change.start) || !isScheduleDate(change.end) || change.end < change.start
        || (change.previousStart !== null && !isScheduleDate(change.previousStart))
        || (change.previousEnd !== null && !isScheduleDate(change.previousEnd))) return { error: "Selected schedules contain invalid dates or records." };
      const key = `${change.kind}:${change.id}`;
      if (keys.has(key)) return { error: "A schedule row was selected more than once." };
      keys.add(key);
    }
    const client = await createClient();
    const { error } = await client.rpc("move_selected_schedules", { p_project_id: projectId, p_changes: changes });
    if (error) {
      if (["PGRST202", "42883"].includes(error.code)) return { error: "Group dragging needs migration 0109_gantt_group_schedule_move.sql. Apply it in Supabase and retry." };
      return { error: ["22023", "40001", "42501", "55000"].includes(error.code) ? error.message : "Could not move the selected schedules. Please retry." };
    }
    await recordGanttCheckpoint(client, projectId, profile.id);
    revalidateProjectPaths(projectId);
    return { success: true };
  } catch {
    return { error: "Could not move the selected schedules. Please retry." };
  }
}
