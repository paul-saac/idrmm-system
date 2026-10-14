"use server";

import { revalidateProjectPaths } from "@/lib/projects/revalidate";
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireProjectAccess } from "@/lib/auth/project-access";
import { COST_COMPONENTS, type CostAmounts } from "@/lib/task-progress/calculate";

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
 * category's own Daily Progress Update for *today* (see
 * 0048_category_progress_tracking.sql's own doc comment for why this
 * exists at all). Identical shape/behavior throughout, minus materials —
 * a task-less category has no planned material list to log against.
 */
export async function recordCategoryProgress(
  categoryId: number,
  projectId: number,
  input: {
    quantityCompletedToday: number;
    costs: CostAmounts;
  }
): Promise<CategoryProgressActionState> {
  return safely(async () => {
    const profile = await requireProjectAccess(projectId);
    if (!profile) {
      return { error: "You are not authorized to record progress." };
    }
    if (
      !Number.isFinite(input.quantityCompletedToday) ||
      input.quantityCompletedToday < 0
    ) {
      return { error: "Quantity completed can't be negative." };
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

    const { error: upsertError } = await supabase
      .from("category_progress_entries")
      .upsert(
        {
          category_id: categoryId,
          entry_date: entryDate,
          quantity_completed: input.quantityCompletedToday,
          labor_cost: input.costs.labor,
          material_cost: input.costs.material,
          equipment_cost: input.costs.equipment,
          other_cost: input.costs.other,
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
