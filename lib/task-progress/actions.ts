"use server";

import { revalidateProjectPaths } from "@/lib/projects/revalidate";
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireProjectAccess } from "@/lib/auth/project-access";

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
 * save, so correcting today's numbers never double-counts. No longer
 * touches project_materials stock at all: the old "Materials consumed
 * today" picker pulled from the project's whole stock roster with no
 * connection to what was planned for this specific task.
 * quantity_completed is no longer written either — the modal's own
 * "Quantity completed" field was removed; a task's Materials% now comes
 * from its materials used vs. planned instead.
 *
 * percentCompleteOverride (see 0049_progress_percent_override.sql) is
 * written as-is, including null — null is what actually clears a
 * previously-saved override rather than leaving a stale value in place.
 */
export async function recordTaskProgress(
  taskId: number,
  projectId: number,
  input: {
    laborHeadcount: number;
    materialsUsed: { name: string; unit: string | null; quantity: number }[];
    percentCompleteOverride: number | null;
  }
): Promise<TaskProgressActionState> {
  return safely(async () => {
    const profile = await requireProjectAccess(projectId);
    if (!profile) {
      return { error: "You are not authorized to record task progress." };
    }
    for (const material of input.materialsUsed) {
      if (!Number.isFinite(material.quantity) || material.quantity < 0) {
        return { error: "Material quantity used can't be negative." };
      }
    }
    if (
      !Number.isFinite(input.laborHeadcount) ||
      input.laborHeadcount < 0
    ) {
      return { error: "Labor headcount can't be negative." };
    }
    if (
      input.percentCompleteOverride !== null &&
      (!Number.isFinite(input.percentCompleteOverride) ||
        input.percentCompleteOverride < 0 ||
        input.percentCompleteOverride > 100)
    ) {
      return { error: "Percent complete must be a number between 0 and 100." };
    }

    const supabase = await createClient();
    const entryDate = todayIso();

    const { data: savedEntry, error: upsertError } = await supabase
      .from("task_progress_entries")
      .upsert(
        {
          task_id: taskId,
          entry_date: entryDate,
          labor_headcount: Math.round(input.laborHeadcount),
          percent_complete_override: input.percentCompleteOverride,
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
