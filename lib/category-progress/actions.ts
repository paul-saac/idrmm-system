"use server";

import { revalidateProjectPaths } from "@/lib/projects/revalidate";
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireProjectAccess } from "@/lib/auth/project-access";

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

function todayIso() {
  return new Date().toLocaleDateString("en-CA");
}

/**
 * Same idea as recordTaskProgress, one level up — a task-less
 * category's own Progress Tracking Override for *today* (see
 * 0048_category_progress_tracking.sql's own doc comment for why this
 * exists at all). Identical shape/behavior throughout — see
 * recordTaskProgress's own doc comment, unchanged here, including why
 * this no longer touches project_materials/category_progress_material_
 * usage, and how percentCompleteOverride (0049_progress_percent_
 * override.sql) gets written.
 */
export async function recordCategoryProgress(
  categoryId: number,
  projectId: number,
  input: {
    laborHeadcount: number;
    percentCompleteOverride: number | null;
  }
): Promise<CategoryProgressActionState> {
  return safely(async () => {
    const profile = await requireProjectAccess(projectId);
    if (!profile) {
      return { error: "You are not authorized to record progress." };
    }
    if (!Number.isFinite(input.laborHeadcount) || input.laborHeadcount < 0) {
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

    const { error: upsertError } = await supabase
      .from("category_progress_entries")
      .upsert(
        {
          category_id: categoryId,
          entry_date: entryDate,
          labor_headcount: Math.round(input.laborHeadcount),
          percent_complete_override: input.percentCompleteOverride,
          recorded_by: profile.id,
        },
        { onConflict: "category_id,entry_date" }
      );

    if (upsertError) {
      logSupabaseError(
        "[recordCategoryProgress] Supabase entry upsert failed",
        upsertError
      );
      return { error: "Could not save progress. Please try again." };
    }

    revalidateProjectPaths(projectId);
    return { success: true };
  });
}
