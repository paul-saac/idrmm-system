"use server";

import { revalidatePath } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";

export type CategoryProgressActionState = {
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
  run: () => Promise<CategoryProgressActionState>
): Promise<CategoryProgressActionState> {
  try {
    return await run();
  } catch (error) {
    console.error("[category-progress] Unexpected error:", error);
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
 * Same idea as recordTaskProgress, one level up — a task-less
 * category's own Progress Tracking Override for *today* (see
 * 0048_category_progress_tracking.sql's own doc comment for why this
 * exists at all). Identical shape/behavior throughout, including the
 * revert-then-reapply material stock handling — see recordTaskProgress's
 * own doc comment for the reasoning, unchanged here.
 */
export async function recordCategoryProgress(
  categoryId: number,
  projectId: number,
  input: {
    quantityCompletedToday: number;
    laborHeadcount: number;
    materialsUsed: { materialId: number; quantity: number }[];
  }
): Promise<CategoryProgressActionState> {
  return safely(async () => {
    const profile = await requireAdmin();
    if (!profile) {
      return { error: "You are not authorized to record progress." };
    }
    if (
      !Number.isFinite(input.quantityCompletedToday) ||
      input.quantityCompletedToday < 0
    ) {
      return { error: "Quantity completed can't be negative." };
    }
    if (!Number.isFinite(input.laborHeadcount) || input.laborHeadcount < 0) {
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
      .from("category_progress_entries")
      .select("id")
      .eq("category_id", categoryId)
      .eq("entry_date", entryDate)
      .maybeSingle();

    if (existingEntry) {
      const { data: oldUsage } = await supabase
        .from("category_progress_material_usage")
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
              "[recordCategoryProgress] Supabase stock-restore failed",
              restoreError
            );
            return { error: "Could not save progress. Please try again." };
          }
        }
      }

      const { error: deleteUsageError } = await supabase
        .from("category_progress_material_usage")
        .delete()
        .eq("progress_entry_id", existingEntry.id);
      if (deleteUsageError) {
        logSupabaseError(
          "[recordCategoryProgress] Supabase old-usage delete failed",
          deleteUsageError
        );
        return { error: "Could not save progress. Please try again." };
      }
    }

    const { data: savedEntry, error: upsertError } = await supabase
      .from("category_progress_entries")
      .upsert(
        {
          category_id: categoryId,
          entry_date: entryDate,
          quantity_completed: input.quantityCompletedToday,
          labor_headcount: Math.round(input.laborHeadcount),
          recorded_by: profile.id,
        },
        { onConflict: "category_id,entry_date" }
      )
      .select("id")
      .single();

    if (upsertError || !savedEntry) {
      logSupabaseError(
        "[recordCategoryProgress] Supabase entry upsert failed",
        upsertError!
      );
      return { error: "Could not save progress. Please try again." };
    }

    const materialsUsed = input.materialsUsed.filter((item) => item.quantity > 0);

    if (materialsUsed.length > 0) {
      const { error: insertUsageError } = await supabase
        .from("category_progress_material_usage")
        .insert(
          materialsUsed.map((item) => ({
            progress_entry_id: savedEntry.id,
            material_id: item.materialId,
            quantity: item.quantity,
          }))
        );
      if (insertUsageError) {
        logSupabaseError(
          "[recordCategoryProgress] Supabase new-usage insert failed",
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
              "[recordCategoryProgress] Supabase stock-deduct failed",
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
