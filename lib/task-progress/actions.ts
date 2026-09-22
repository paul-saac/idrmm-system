"use server";

import { revalidatePath } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";

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

async function requireAdmin() {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") return null;
  return profile;
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
 * Materials consumed are a real project_materials.quantity deduction,
 * not just a logged number — the actual Gantt <-> Materials page
 * connection this feature exists for. Since re-saving today's entry can
 * change which materials (or how much of each) were used, this always
 * reverts whatever today's entry previously deducted before applying
 * the new amounts, rather than trying to diff old vs. new — simpler to
 * get right, and correct for every case (added, removed, or
 * re-quantified materials alike).
 */
export async function recordTaskProgress(
  taskId: number,
  projectId: number,
  input: {
    quantityCompletedToday: number;
    laborHeadcount: number;
    materialsUsed: { materialId: number; quantity: number }[];
  }
): Promise<TaskProgressActionState> {
  return safely(async () => {
    const profile = await requireAdmin();
    if (!profile) {
      return { error: "You are not authorized to record task progress." };
    }
    if (
      !Number.isFinite(input.quantityCompletedToday) ||
      input.quantityCompletedToday < 0
    ) {
      return { error: "Quantity completed can't be negative." };
    }
    if (
      !Number.isFinite(input.laborHeadcount) ||
      input.laborHeadcount < 0
    ) {
      return { error: "Labor headcount can't be negative." };
    }
    for (const item of input.materialsUsed) {
      if (!Number.isFinite(item.quantity) || item.quantity < 0) {
        return { error: "Material quantity can't be negative." };
      }
    }

    const supabase = await createClient();
    const entryDate = todayIso();

    const { data: existingEntry } = await supabase
      .from("task_progress_entries")
      .select("id")
      .eq("task_id", taskId)
      .eq("entry_date", entryDate)
      .maybeSingle();

    // Reverse whatever today's entry previously deducted from stock,
    // before applying the new amounts below — see this function's own
    // doc comment for why this is simplest done as "revert everything,
    // then reapply" rather than diffing old vs. new material lists.
    if (existingEntry) {
      const { data: oldUsage } = await supabase
        .from("task_progress_material_usage")
        .select("material_id, quantity")
        .eq("progress_entry_id", existingEntry.id);

      for (const usage of oldUsage ?? []) {
        const { data: material } = await supabase
          .from("project_materials")
          .select("quantity")
          .eq("id", usage.material_id)
          .maybeSingle();
        if (material) {
          const { error: restoreError } = await supabase
            .from("project_materials")
            .update({ quantity: (material.quantity ?? 0) + (usage.quantity ?? 0) })
            .eq("id", usage.material_id);
          if (restoreError) {
            logSupabaseError(
              "[recordTaskProgress] Supabase stock-restore failed",
              restoreError
            );
            return { error: "Could not save progress. Please try again." };
          }
        }
      }

      const { error: deleteUsageError } = await supabase
        .from("task_progress_material_usage")
        .delete()
        .eq("progress_entry_id", existingEntry.id);
      if (deleteUsageError) {
        logSupabaseError(
          "[recordTaskProgress] Supabase old-usage delete failed",
          deleteUsageError
        );
        return { error: "Could not save progress. Please try again." };
      }
    }

    const { data: savedEntry, error: upsertError } = await supabase
      .from("task_progress_entries")
      .upsert(
        {
          task_id: taskId,
          entry_date: entryDate,
          quantity_completed: input.quantityCompletedToday,
          labor_headcount: Math.round(input.laborHeadcount),
          recorded_by: profile.id,
        },
        { onConflict: "task_id,entry_date" }
      )
      .select("id")
      .single();

    if (upsertError || !savedEntry) {
      logSupabaseError(
        "[recordTaskProgress] Supabase entry upsert failed",
        upsertError!
      );
      return { error: "Could not save progress. Please try again." };
    }

    const materialsUsed = input.materialsUsed.filter((item) => item.quantity > 0);

    if (materialsUsed.length > 0) {
      const { error: insertUsageError } = await supabase
        .from("task_progress_material_usage")
        .insert(
          materialsUsed.map((item) => ({
            progress_entry_id: savedEntry.id,
            material_id: item.materialId,
            quantity: item.quantity,
          }))
        );
      if (insertUsageError) {
        logSupabaseError(
          "[recordTaskProgress] Supabase new-usage insert failed",
          insertUsageError
        );
        return { error: "Could not save progress. Please try again." };
      }

      for (const item of materialsUsed) {
        const { data: material } = await supabase
          .from("project_materials")
          .select("quantity")
          .eq("id", item.materialId)
          .maybeSingle();
        if (material) {
          const { error: deductError } = await supabase
            .from("project_materials")
            .update({
              quantity: Math.max(0, (material.quantity ?? 0) - item.quantity),
            })
            .eq("id", item.materialId);
          if (deductError) {
            logSupabaseError(
              "[recordTaskProgress] Supabase stock-deduct failed",
              deductError
            );
            return { error: "Could not save progress. Please try again." };
          }
        }
      }
    }

    revalidatePath(`/admin/projects/${projectId}`);
    return { success: true };
  });
}
