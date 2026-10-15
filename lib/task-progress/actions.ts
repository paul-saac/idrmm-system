"use server";

import { revalidateProjectPaths } from "@/lib/projects/revalidate";
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireProjectAccess } from "@/lib/auth/project-access";
import { COST_COMPONENTS, type CostAmounts } from "@/lib/task-progress/calculate";
import {
  replaceAttendance,
  resolveAttendance,
  type AttendanceInput,
} from "@/lib/task-progress/attendance";

export type TaskProgressActionState = {
  error?: string;
  success?: boolean;
};

function logSupabaseError(label: string, error: PostgrestError) {
  console.error(label, {
    message: error.message,
    code: error.code,
    details: error.details,
    hint: error.hint,
  });
}

async function safely(
  run: () => Promise<TaskProgressActionState>
): Promise<TaskProgressActionState> {
  try {
    return await run();
  } catch (error) {
    console.error("[task-progress] Unexpected error:", error);
    return { error: "Something went wrong. Please try again." };
  }
}

function todayIso() {
  return new Date().toLocaleDateString("en-CA");
}

/**
 * Saves one task's Progress Tracking Override for *today* — the Gantt
 * Chart bar-click modal's own Save action. Always writes to today's own
 * date (see todayIso above; there's no date picker in the modal, this
 * isn't a historical backfill tool) — reopening the modal later the
 * same day and saving again corrects today's entry in place rather than
 * creating a second one, via the DB's own unique(task_id, entry_date)
 * constraint.
 *
 * Materials used are logged against the task's own planned material
 * lines (task_progress_material_entries, see 0050_task_progress_
 * material_entries.sql) — replaced wholesale for this day on every
 * save, so correcting today's numbers never double-counts. Never touches
 * project_materials stock.
 *
 * The day's spend per cost component (0057_progress_entry_costs.sql) is
 * what the task's % complete is measured from — saving a day overrides
 * its automatic planned share (see computeProgressBreakdown). Its labor
 * isn't typed: it's priced here from who worked (attendance, 0068) at
 * each one's own daily rate, and their attendance saved with it.
 */
export async function recordTaskProgress(
  taskId: number,
  projectId: number,
  input: {
    quantityCompletedToday: number;
    /** Labor's ignored — it's priced from `attendance`. */
    costs: CostAmounts;
    materialsUsed: { name: string; unit: string | null; quantity: number }[];
    attendance: AttendanceInput;
  }
): Promise<TaskProgressActionState> {
  return safely(async () => {
    const profile = await requireProjectAccess(projectId);
    if (!profile) {
      return { error: "You are not authorized to record task progress." };
    }
    if (
      !Number.isFinite(input.quantityCompletedToday) ||
      input.quantityCompletedToday < 0
    ) {
      return { error: "Quantity completed can't be negative." };
    }
    for (const material of input.materialsUsed) {
      if (!Number.isFinite(material.quantity) || material.quantity < 0) {
        return { error: "Material quantity used can't be negative." };
      }
    }
    if (
      COST_COMPONENTS.some(
        (component) =>
          !Number.isFinite(input.costs[component]) || input.costs[component] < 0
      )
    ) {
      return { error: "Costs must be 0 or more." };
    }

    const supabase = await createClient();
    const entryDate = todayIso();

    const crew = await resolveAttendance(supabase, input.attendance, entryDate, { taskId });
    if ("error" in crew) {
      return { error: crew.error };
    }

    const { data: savedEntry, error: upsertError } = await supabase
      .from("task_progress_entries")
      .upsert(
        {
          task_id: taskId,
          entry_date: entryDate,
          quantity_completed: input.quantityCompletedToday,
          labor_cost: crew.laborCost,
          material_cost: input.costs.material,
          equipment_cost: input.costs.equipment,
          other_cost: input.costs.other,
          recorded_by: profile.id,
        },
        { onConflict: "task_id,entry_date" }
      )
      .select("id")
      .single();

    if (upsertError || !savedEntry) {
      if (upsertError) {
        logSupabaseError(
          "[recordTaskProgress] Supabase entry upsert failed",
          upsertError
        );
      }
      return { error: "Could not save progress. Please try again." };
    }

    const attendanceError = await replaceAttendance(supabase, "task", savedEntry.id, crew.rows);
    if (attendanceError) {
      return { error: attendanceError };
    }

    const { error: deleteError } = await supabase
      .from("task_progress_material_entries")
      .delete()
      .eq("progress_entry_id", savedEntry.id);

    if (deleteError) {
      logSupabaseError(
        "[recordTaskProgress] Supabase old material entries delete failed",
        deleteError
      );
      return { error: "Could not save materials used. Please try again." };
    }

    const materialRows = input.materialsUsed
      .filter((material) => material.quantity > 0 && material.name.trim())
      .map((material) => ({
        progress_entry_id: savedEntry.id,
        material_name: material.name.trim(),
        unit: material.unit?.trim() || null,
        quantity_used: material.quantity,
      }));

    if (materialRows.length > 0) {
      const { error: insertError } = await supabase
        .from("task_progress_material_entries")
        .insert(materialRows);

      if (insertError) {
        logSupabaseError(
          "[recordTaskProgress] Supabase material entries insert failed",
          insertError
        );
        return { error: "Could not save materials used. Please try again." };
      }
    }

    revalidateProjectPaths(projectId);
    return { success: true };
  });
}
