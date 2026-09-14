"use server";

import { revalidatePath } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";

export type CostEstimateActionState = {
  error?: string;
  success?: boolean;
};

/**
 * Next's dev console-error overlay renders a raw PostgrestError object
 * as "{}" — its message/code/details/hint don't show up in the
 * overlay's inspector even though they're real fields — so every
 * Supabase-error log below goes through this to print them as plain
 * fields instead, where they're actually visible.
 */
function logSupabaseError(label: string, error: PostgrestError) {
  console.error(label, {
    message: error.message,
    code: error.code,
    details: error.details,
    hint: error.hint,
  });
}

/**
 * Wraps an action body so any unexpected exception (a network hiccup, a
 * stale dev-mode Server Action reference after a code change, anything
 * not already turned into a returned {error} below) becomes a clean
 * message the form can display, instead of an unhandled crash the
 * browser reports as a bare "Failed to fetch".
 */
async function safely(
  run: () => Promise<CostEstimateActionState>
): Promise<CostEstimateActionState> {
  try {
    return await run();
  } catch (error) {
    console.error("[cost-estimate] Unexpected error:", error);
    return { error: "Something went wrong. Please try again." };
  }
}

async function requireAdmin() {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") return null;
  return profile;
}

function parseNumber(value: FormDataEntryValue | null) {
  const num = Number(String(value ?? "0").trim());
  return Number.isFinite(num) ? num : 0;
}

function parseOptionalDate(value: FormDataEntryValue | null) {
  const str = String(value ?? "").trim();
  return str || null;
}

function parseOptionalId(value: FormDataEntryValue | null) {
  const str = String(value ?? "").trim();
  if (!str) return null;
  const num = Number(str);
  return Number.isFinite(num) ? num : null;
}

/**
 * A task's predecessor is picked from a <select> the form already limits
 * to that project's own tasks, but the submitted value still comes from
 * the client, so it's re-checked server-side: it must name a real task
 * in the same project, and (on an edit) can't be the task itself.
 */
async function validatePredecessor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  predecessorTaskId: number | null,
  projectId: number,
  excludeTaskId?: number
): Promise<string | null> {
  if (predecessorTaskId === null) return null;
  if (predecessorTaskId === excludeTaskId) {
    return "A task can't be its own predecessor.";
  }

  const { data } = await supabase
    .from("estimate_tasks")
    .select("id")
    .eq("id", predecessorTaskId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!data) {
    return "Selected predecessor task is not valid.";
  }
  return null;
}

/**
 * Recomputes every task's weight (its share of the project's total
 * estimated cost) and every category's weight (the sum of its tasks'
 * weights) for a project. Called after any task create/update/delete,
 * since adding or changing one task shifts the project total and
 * therefore every other task's percentage too.
 *
 * Weight is stored, not just computed for display, so a future
 * progress-tracking feature can read it directly instead of re-deriving
 * it from every task's cost on every request.
 */
async function recomputeWeights(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: number
) {
  const { data: tasks } = await supabase
    .from("estimate_tasks")
    .select("id, category_id, total_estimate_cost")
    .eq("project_id", projectId);

  const rows = tasks ?? [];
  const projectTotal = rows.reduce(
    (sum, row) => sum + (row.total_estimate_cost ?? 0),
    0
  );

  const categoryWeights = new Map<number, number>();

  await Promise.all(
    rows.map(async (row) => {
      const weight =
        projectTotal > 0
          ? Math.round(((row.total_estimate_cost ?? 0) / projectTotal) * 10000) /
            100
          : 0;
      categoryWeights.set(
        row.category_id,
        (categoryWeights.get(row.category_id) ?? 0) + weight
      );
      await supabase.from("estimate_tasks").update({ weight }).eq("id", row.id);
    })
  );

  const { data: categories } = await supabase
    .from("estimate_categories")
    .select("id")
    .eq("project_id", projectId);

  await Promise.all(
    (categories ?? []).map((category) =>
      supabase
        .from("estimate_categories")
        .update({ weight: categoryWeights.get(category.id) ?? 0 })
        .eq("id", category.id)
    )
  );
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function createCategory(
  projectId: number,
  _prevState: CostEstimateActionState,
  formData: FormData
): Promise<CostEstimateActionState> {
  return safely(async () => {
    const profile = await requireAdmin();
    if (!profile) {
      return { error: "You are not authorized to manage cost estimates." };
    }

    const categoryName = String(formData.get("categoryName") ?? "").trim();
    if (!categoryName) {
      return { error: "Category name is required." };
    }

    const supabase = await createClient();
    const { error } = await supabase.from("estimate_categories").insert({
      project_id: projectId,
      category_name: categoryName,
    });

    if (error) {
      logSupabaseError("[createCategory] Supabase insert failed", error);
      return { error: "Could not create category. Please try again." };
    }

    revalidatePath(`/admin/projects/${projectId}`);
    return { success: true };
  });
}

export async function updateCategory(
  categoryId: number,
  projectId: number,
  _prevState: CostEstimateActionState,
  formData: FormData
): Promise<CostEstimateActionState> {
  return safely(async () => {
    const profile = await requireAdmin();
    if (!profile) {
      return { error: "You are not authorized to manage cost estimates." };
    }

    const categoryName = String(formData.get("categoryName") ?? "").trim();
    if (!categoryName) {
      return { error: "Category name is required." };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("estimate_categories")
      .update({ category_name: categoryName })
      .eq("id", categoryId);

    if (error) {
      logSupabaseError("[updateCategory] Supabase update failed", error);
      return { error: "Could not save changes. Please try again." };
    }

    revalidatePath(`/admin/projects/${projectId}`);
    return { success: true };
  });
}

export async function deleteCategory(
  categoryId: number,
  projectId: number,
  _prevState: CostEstimateActionState,
  _formData: FormData
): Promise<CostEstimateActionState> {
  return safely(async () => {
    const profile = await requireAdmin();
    if (!profile) {
      return { error: "You are not authorized to manage cost estimates." };
    }

    const supabase = await createClient();

    // Block deleting a category that still has task items rather than
    // silently cascading the delete — the task items are real cost data
    // the user entered, so losing them needs to be an explicit choice.
    const { count } = await supabase
      .from("estimate_tasks")
      .select("id", { count: "exact", head: true })
      .eq("category_id", categoryId);

    if (count && count > 0) {
      return {
        error: `Move or delete this category's ${count} task item${count === 1 ? "" : "s"} first.`,
      };
    }

    const { error } = await supabase
      .from("estimate_categories")
      .delete()
      .eq("id", categoryId);

    if (error) {
      logSupabaseError("[deleteCategory] Supabase delete failed", error);
      return { error: "Could not delete category. Please try again." };
    }

    revalidatePath(`/admin/projects/${projectId}`);
    return { success: true };
  });
}

// ---------------------------------------------------------------------------
// Task items
// ---------------------------------------------------------------------------

/**
 * Reads this task's freely-added "Other cost" line items off the form.
 * The Task Item form renders one <input name="otherCostName"> + <input
 * name="otherCostAmount"> pair per row the user has added — since every
 * row shares the same two field names, FormData.getAll() returns them in
 * DOM order, so the i-th name pairs with the i-th amount. Rows with a
 * blank name are dropped (a row the user added but never filled in).
 */
function buildOtherCostItems(formData: FormData) {
  const names = formData.getAll("otherCostName").map((v) => String(v).trim());
  const amounts = formData.getAll("otherCostAmount");

  const items: { costName: string; amount: number }[] = [];
  for (let i = 0; i < names.length; i++) {
    const costName = names[i];
    if (!costName) continue;
    items.push({ costName, amount: parseNumber(amounts[i] ?? null) });
  }
  return items;
}

function buildTaskFields(formData: FormData) {
  const taskName = String(formData.get("taskName") ?? "").trim();
  const categoryId = Number(formData.get("categoryId"));
  const estimatedQuantity = parseNumber(formData.get("estimatedQuantity"));
  const unit = String(formData.get("unit") ?? "").trim();
  const laborEstimate = parseNumber(formData.get("laborEstimate"));
  const materialEstimate = parseNumber(formData.get("materialEstimate"));
  const equipmentEstimate = parseNumber(formData.get("equipmentEstimate"));
  const plannedStartDate = parseOptionalDate(formData.get("plannedStartDate"));
  const plannedEndDate = parseOptionalDate(formData.get("plannedEndDate"));
  const predecessorTaskId = parseOptionalId(formData.get("predecessorTaskId"));

  const otherCostItems = buildOtherCostItems(formData);
  const otherCostEstimate = otherCostItems.reduce(
    (sum, item) => sum + item.amount,
    0
  );

  const totalEstimateCost =
    laborEstimate + materialEstimate + equipmentEstimate + otherCostEstimate;

  return {
    taskName,
    categoryId,
    estimatedQuantity,
    unit,
    laborEstimate,
    materialEstimate,
    equipmentEstimate,
    otherCostItems,
    otherCostEstimate,
    totalEstimateCost,
    plannedStartDate,
    plannedEndDate,
    predecessorTaskId,
  };
}

export async function createTask(
  projectId: number,
  _prevState: CostEstimateActionState,
  formData: FormData
): Promise<CostEstimateActionState> {
  return safely(async () => {
    const profile = await requireAdmin();
    if (!profile) {
      return { error: "You are not authorized to manage cost estimates." };
    }

    const fields = buildTaskFields(formData);

    if (!fields.taskName) {
      return { error: "Task description is required." };
    }
    if (!fields.categoryId) {
      return { error: "Select a category." };
    }
    if (
      fields.plannedStartDate &&
      fields.plannedEndDate &&
      fields.plannedEndDate < fields.plannedStartDate
    ) {
      return { error: "Planned end date can't be before the planned start date." };
    }

    const supabase = await createClient();

    const predecessorError = await validatePredecessor(
      supabase,
      fields.predecessorTaskId,
      projectId
    );
    if (predecessorError) {
      return { error: predecessorError };
    }

    const { data: task, error } = await supabase
      .from("estimate_tasks")
      .insert({
        project_id: projectId,
        category_id: fields.categoryId,
        task_name: fields.taskName,
        estimated_quantity: fields.estimatedQuantity,
        unit: fields.unit || null,
        labor_estimate: fields.laborEstimate,
        material_estimate: fields.materialEstimate,
        equipment_estimate: fields.equipmentEstimate,
        other_cost_estimate: fields.otherCostEstimate,
        total_estimate_cost: fields.totalEstimateCost,
        planned_start_date: fields.plannedStartDate,
        planned_end_date: fields.plannedEndDate,
        predecessor_task_id: fields.predecessorTaskId,
      })
      .select("id")
      .single();

    if (error || !task) {
      // `error` can be null here (insert "succeeded" but returned no
      // row, e.g. an RLS check silently filtering it out), so only log
      // it through logSupabaseError when it's actually present.
      if (error) {
        logSupabaseError("[createTask] Supabase insert failed", error);
      } else {
        console.error("[createTask] Insert returned no row (RLS?).");
      }
      return { error: "Could not create task item. Please try again." };
    }

    if (fields.otherCostItems.length > 0) {
      const { error: otherCostError } = await supabase
        .from("estimate_task_other_costs")
        .insert(
          fields.otherCostItems.map((item) => ({
            task_id: task.id,
            cost_name: item.costName,
            amount: item.amount,
          }))
        );

      if (otherCostError) {
        logSupabaseError(
          "[createTask] Supabase other-cost insert failed",
          otherCostError
        );
        return {
          error:
            "Task item saved, but its other costs could not be saved. Please edit the task and try again.",
        };
      }
    }

    await recomputeWeights(supabase, projectId);

    revalidatePath(`/admin/projects/${projectId}`);
    return { success: true };
  });
}

export async function updateTask(
  taskId: number,
  projectId: number,
  _prevState: CostEstimateActionState,
  formData: FormData
): Promise<CostEstimateActionState> {
  return safely(async () => {
    const profile = await requireAdmin();
    if (!profile) {
      return { error: "You are not authorized to manage cost estimates." };
    }

    const fields = buildTaskFields(formData);

    if (!fields.taskName) {
      return { error: "Task description is required." };
    }
    if (!fields.categoryId) {
      return { error: "Select a category." };
    }
    if (
      fields.plannedStartDate &&
      fields.plannedEndDate &&
      fields.plannedEndDate < fields.plannedStartDate
    ) {
      return { error: "Planned end date can't be before the planned start date." };
    }

    const supabase = await createClient();

    const predecessorError = await validatePredecessor(
      supabase,
      fields.predecessorTaskId,
      projectId,
      taskId
    );
    if (predecessorError) {
      return { error: predecessorError };
    }

    const { error } = await supabase
      .from("estimate_tasks")
      .update({
        category_id: fields.categoryId,
        task_name: fields.taskName,
        estimated_quantity: fields.estimatedQuantity,
        unit: fields.unit || null,
        labor_estimate: fields.laborEstimate,
        material_estimate: fields.materialEstimate,
        equipment_estimate: fields.equipmentEstimate,
        other_cost_estimate: fields.otherCostEstimate,
        total_estimate_cost: fields.totalEstimateCost,
        planned_start_date: fields.plannedStartDate,
        planned_end_date: fields.plannedEndDate,
        predecessor_task_id: fields.predecessorTaskId,
      })
      .eq("id", taskId);

    if (error) {
      logSupabaseError("[updateTask] Supabase update failed", error);
      return { error: "Could not save changes. Please try again." };
    }

    // Replace this task's other-cost items wholesale rather than diffing
    // individual edits/adds/removes — simpler, and nothing else
    // references these rows by id, so reassigning fresh ids on every
    // save has no downstream effect.
    const { error: deleteError } = await supabase
      .from("estimate_task_other_costs")
      .delete()
      .eq("task_id", taskId);

    if (deleteError) {
      logSupabaseError(
        "[updateTask] Supabase other-cost delete failed",
        deleteError
      );
      return {
        error: "Could not save the other cost items. Please try again.",
      };
    }

    if (fields.otherCostItems.length > 0) {
      const { error: insertError } = await supabase
        .from("estimate_task_other_costs")
        .insert(
          fields.otherCostItems.map((item) => ({
            task_id: taskId,
            cost_name: item.costName,
            amount: item.amount,
          }))
        );

      if (insertError) {
        logSupabaseError(
          "[updateTask] Supabase other-cost insert failed",
          insertError
        );
        return {
          error: "Could not save the other cost items. Please try again.",
        };
      }
    }

    await recomputeWeights(supabase, projectId);

    revalidatePath(`/admin/projects/${projectId}`);
    return { success: true };
  });
}

/**
 * Persists a drag-move or drag-resize on the Gantt Chart view — just
 * the two schedule dates, not the full task form updateTask needs.
 * Called directly from the Gantt's on_date_change handler (not a form
 * submission), same as any other Server Action can be invoked as a
 * plain async function from a client component.
 */
export async function updateTaskSchedule(
  taskId: number,
  projectId: number,
  plannedStartDate: string,
  plannedEndDate: string
): Promise<CostEstimateActionState> {
  return safely(async () => {
    const profile = await requireAdmin();
    if (!profile) {
      return { error: "You are not authorized to manage cost estimates." };
    }
    if (plannedEndDate < plannedStartDate) {
      return { error: "Planned end date can't be before the planned start date." };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("estimate_tasks")
      .update({
        planned_start_date: plannedStartDate,
        planned_end_date: plannedEndDate,
      })
      .eq("id", taskId);

    if (error) {
      logSupabaseError("[updateTaskSchedule] Supabase update failed", error);
      return { error: "Could not save the new schedule. Please try again." };
    }

    revalidatePath(`/admin/projects/${projectId}`);
    return { success: true };
  });
}

export async function deleteTask(
  taskId: number,
  projectId: number,
  _prevState: CostEstimateActionState,
  _formData: FormData
): Promise<CostEstimateActionState> {
  return safely(async () => {
    const profile = await requireAdmin();
    if (!profile) {
      return { error: "You are not authorized to manage cost estimates." };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("estimate_tasks")
      .delete()
      .eq("id", taskId);

    if (error) {
      logSupabaseError("[deleteTask] Supabase delete failed", error);
      return { error: "Could not delete task item. Please try again." };
    }

    await recomputeWeights(supabase, projectId);

    revalidatePath(`/admin/projects/${projectId}`);
    return { success: true };
  });
}
