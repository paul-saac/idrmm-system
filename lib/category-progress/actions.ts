"use server";

import { revalidateProjectPaths } from "@/lib/projects/revalidate";
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireProjectAccess } from "@/lib/auth/project-access";
import { isAdminRole } from "@/lib/auth/roles";
import { logOverride } from "@/lib/progress-logs/write";
import { entryCosts } from "@/lib/task-progress/data";
import { priceMaterialsUsed } from "@/lib/task-progress/material-cost";
import { COST_COMPONENTS, type CostAmounts } from "@/lib/task-progress/calculate";
import {
  replaceAttendance,
  resolveAttendance,
  type AttendanceInput,
} from "@/lib/task-progress/attendance";

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
 * Labor's priced from attendance the same way.
 */
export async function recordCategoryProgress(
  categoryId: number,
  projectId: number,
  input: {
    quantityCompletedToday: number;
    /** Labor's ignored — it's priced from `attendance`; material is just
     * typed only for a category without Material Breakdown lines — what's
     * used is priced here. */
    costs: CostAmounts;
    attendance: AttendanceInput;
    /** Used of the category's own Material Breakdown lines today (0070) —
     * empty for a category without any. */
    materialsUsed?: { name: string; unit: string | null; quantity: number }[];
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
    const materialsUsed = input.materialsUsed ?? [];
    for (const material of materialsUsed) {
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

    const crew = await resolveAttendance(supabase, input.attendance, entryDate, {
      categoryId,
    });
    if ("error" in crew) {
      return { error: crew.error };
    }

    // Material cost: what was used, priced from the category's own
    // Material Breakdown (like labor from attendance) — or, without any
    // lines, typed.
    const priced = await priceMaterialsUsed(supabase, { categoryId }, materialsUsed);
    if ("error" in priced) {
      return { error: priced.error };
    }
    const materialCost = Math.round((priced.cost + input.costs.material) * 100) / 100;

    const { data: savedEntry, error: upsertError } = await supabase
      .from("category_progress_entries")
      .upsert(
        {
          category_id: categoryId,
          entry_date: entryDate,
          quantity_completed: input.quantityCompletedToday,
          labor_cost: crew.laborCost,
          material_cost: materialCost,
          equipment_cost: input.costs.equipment,
          other_cost: input.costs.other,
          recorded_by: profile.id,
        },
        { onConflict: "category_id,entry_date" }
      )
      .select("id")
      .single();

    if (upsertError || !savedEntry) {
      if (upsertError) {
        logSupabaseError(
          "[recordCategoryProgress] Supabase entry upsert failed",
          upsertError
        );
      }
      return { error: "Could not save progress. Please try again." };
    }

    const attendanceError = await replaceAttendance(
      supabase,
      "category",
      savedEntry.id,
      crew.rows
    );
    if (attendanceError) {
      return { error: attendanceError };
    }

    // Materials used, replaced the same way as a task's — skipped
    // entirely for a category with no Material Breakdown lines.
    if (materialsUsed.length > 0) {
      const { error: deleteError } = await supabase
        .from("category_progress_material_entries")
        .delete()
        .eq("progress_entry_id", savedEntry.id);

      if (deleteError) {
        logSupabaseError(
          "[recordCategoryProgress] Supabase old material entries delete failed",
          deleteError
        );
        return { error: "Could not save materials used. Please try again." };
      }

      const materialRows = materialsUsed
        .filter((material) => material.quantity > 0 && material.name.trim())
        .map((material) => ({
          progress_entry_id: savedEntry.id,
          material_name: material.name.trim(),
          unit: material.unit?.trim() || null,
          quantity_used: material.quantity,
        }));

      if (materialRows.length > 0) {
        const { error: insertError } = await supabase
          .from("category_progress_material_entries")
          .insert(materialRows);

        if (insertError) {
          logSupabaseError(
            "[recordCategoryProgress] Supabase material entries insert failed",
            insertError
          );
          return { error: "Could not save materials used. Please try again." };
        }
      }
    }

    // Kept in the override history too — every save, not just the day's
    // latest (0071).
    await logOverride(supabase, profile, projectId, { kind: "category", id: categoryId }, {
      action: "saved",
      entryDate,
      quantityCompleted: input.quantityCompletedToday,
      costs: {
        labor: crew.laborCost,
        material: materialCost,
        equipment: input.costs.equipment,
        other: input.costs.other,
      },
      materialsUsed: materialsUsed
        .filter((material) => material.quantity > 0 && material.name.trim())
        .map((material) => ({
          name: material.name.trim(),
          unit: material.unit?.trim() || null,
          quantity: material.quantity,
        })),
      attendance: crew.rows.map((row) => ({
        name: row.worker_name,
        hours: row.hours,
        rate: row.hourly_rate,
      })),
    });

    revalidateProjectPaths(projectId);
    return { success: true };
  });
}

/**
 * Same as deleteTaskProgressEntry, one level up — one day's saved Daily
 * Progress Update (an override) for a task-less category, admins and
 * super admins only. Its attendance goes with it (on delete cascade), and
 * the day goes back to automatic progress: a past working day counts its
 * planned share again, today nothing until it's over.
 */
export async function deleteCategoryProgressEntry(
  categoryId: number,
  projectId: number,
  entryDate: string
): Promise<CategoryProgressActionState> {
  return safely(async () => {
    const profile = await requireProjectAccess(projectId);
    if (!profile || !isAdminRole(profile.role)) {
      return { error: "Only admins can delete a progress override." };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
      return { error: "That override couldn't be found." };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("category_progress_entries")
      .delete()
      .eq("category_id", categoryId)
      .eq("entry_date", entryDate)
      .select("*");

    if (error) {
      logSupabaseError("[deleteCategoryProgressEntry] Supabase delete failed", error);
      return { error: "Could not delete the override. Please try again." };
    }
    if (!data || data.length === 0) {
      return { error: "That override was already removed." };
    }

    // The history keeps who deleted it, when, and what it was (0071).
    const removed = data[0];
    await logOverride(supabase, profile, projectId, { kind: "category", id: categoryId }, {
      action: "deleted",
      entryDate,
      quantityCompleted: removed.quantity_completed ?? 0,
      costs: entryCosts(removed),
      materialsUsed: [],
      attendance: [],
    });

    revalidateProjectPaths(projectId);
    return { success: true };
  });
}
