"use server";

import { revalidatePath } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";
import { recordGanttCheckpoint } from "@/lib/cost-estimate/undo-redo";
import type { CostCategory } from "@/lib/cost-estimate/data";

export type CostEstimateActionState = {
  error?: string;
  success?: boolean;
  /** Only set by createCategory, for the Gantt Chart's own inline "add
   * a phase, then immediately rename it in place" flow (see
   * handleAddPhase in gantt-chart-view.tsx) — lets the caller know
   * which row to drop straight into a rename input for, without a
   * second round trip to look it back up. */
  categoryId?: number;
  /** Same idea as categoryId above, just for createTask — the Gantt
   * Chart's own inline "add a subtask, then immediately rename it in
   * place" flow (see handleAddSubtask in gantt-chart-view.tsx). */
  taskId?: number;
  /** Only set by undoGanttAction/redoGanttAction (undo-redo-actions.ts)
   * — the freshly-restored categories/tasks, fetched server-side via
   * getCostEstimate in that same round trip, so the Gantt Chart can
   * show the actual reverted schedule the instant this resolves
   * instead of waiting on a second, much slower router.refresh() (that
   * one re-fetches this whole page's ~23 unrelated queries) just to
   * find out what undo/redo actually changed. */
  categories?: CostCategory[];
  /** Same idea as `categories` above, set alongside it by the same two
   * actions — the freshly-recomputed canUndo/canRedo *after* this
   * particular undo/redo already landed. Without this, the Undo/Redo
   * buttons kept reading their stale *pre*-undo enabled state (still
   * true right after an undo that emptied the history) until
   * router.refresh() caught up — a real bug, not just a cosmetic
   * flash: a second click landing in that window fired a second real
   * undo/redo the admin never intended. */
  canUndo?: boolean;
  canRedo?: boolean;
};

// A sane bound for a task's own planned Start/End year — same
// reasoning and same numbers as gantt-chart-view.tsx's own client-side
// copy of this check (kept deliberately duplicated rather than shared
// across the client/server boundary, matching how this app already
// treats every other cross-cutting validation constant). This is the
// actual, authoritative check; the client-side one just keeps an
// obviously-mistyped year from ever flashing on screen while this
// round-trips.
const MIN_PLANNED_YEAR = 1980;
const MAX_PLANNED_YEAR = 2100;

function isPlannedYearInRange(iso: string): boolean {
  const year = Number(iso.slice(0, 4));
  return (
    Number.isFinite(year) && year >= MIN_PLANNED_YEAR && year <= MAX_PLANNED_YEAR
  );
}

const INVALID_DATE_RANGE_ERROR = `Invalid date range — planned dates must fall between ${MIN_PLANNED_YEAR} and ${MAX_PLANNED_YEAR}.`;

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

const VALID_PRIORITIES = ["low", "medium", "high"] as const;
type TaskPriorityValue = (typeof VALID_PRIORITIES)[number];

function parsePriority(value: FormDataEntryValue | null): TaskPriorityValue {
  const str = String(value ?? "").trim();
  return (VALID_PRIORITIES as readonly string[]).includes(str)
    ? (str as TaskPriorityValue)
    : "medium";
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
    const { data, error } = await supabase
      .from("estimate_categories")
      .insert({
        project_id: projectId,
        category_name: categoryName,
      })
      .select("id")
      .single();

    if (error || !data) {
      if (error) {
        logSupabaseError("[createCategory] Supabase insert failed", error);
      }
      return { error: "Could not create category. Please try again." };
    }

    await recordGanttCheckpoint(supabase, projectId, profile.id);
    revalidatePath(`/admin/projects/${projectId}`);
    return { success: true, categoryId: data.id };
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

    await recordGanttCheckpoint(supabase, projectId, profile.id);
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

    await recordGanttCheckpoint(supabase, projectId, profile.id);
    revalidatePath(`/admin/projects/${projectId}`);
    return { success: true };
  });
}

// createPhaseWithFirstTask (the Gantt Chart's old "Add Task" flow) lived
// here — removed after it turned out to be the actual cause of a real
// bug: every new phase silently came with a same-named first subtask
// nobody asked for. AddPhaseForm now calls createCategory above
// directly instead, the same plain "just the phase, nothing under it"
// creation the Cost Estimate Breakdown's own CategoryForm already used.

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

/**
 * Same repeated-field convention as buildOtherCostItems, for the Gantt
 * Chart Schedule task form's "Materials Needed" rows — materials
 * planned for this task ahead of time, not what was actually used (see
 * 0035_estimate_task_priority_and_assignments.sql). A row with a blank
 * material name is dropped.
 */
function buildMaterialAssignmentDrafts(formData: FormData) {
  const names = formData.getAll("materialAssignmentName").map((v) => String(v).trim());
  const specs = formData.getAll("materialAssignmentSpec");
  const quantities = formData.getAll("materialAssignmentQuantity");
  const units = formData.getAll("materialAssignmentUnit");

  const drafts: {
    materialName: string;
    specification: string;
    plannedQuantity: number;
    unit: string;
  }[] = [];
  for (let i = 0; i < names.length; i++) {
    const materialName = names[i];
    if (!materialName) continue;
    drafts.push({
      materialName,
      specification: String(specs[i] ?? "").trim(),
      plannedQuantity: parseNumber(quantities[i] ?? null),
      unit: String(units[i] ?? "").trim(),
    });
  }
  return drafts;
}

/**
 * Same convention, for the "Manpower Needed" rows. A row with a blank
 * worker role is dropped.
 */
function buildLaborAssignmentDrafts(formData: FormData) {
  const roles = formData.getAll("laborAssignmentRole").map((v) => String(v).trim());
  const counts = formData.getAll("laborAssignmentCount");

  const drafts: { workerRole: string; plannedWorkerCount: number }[] = [];
  for (let i = 0; i < roles.length; i++) {
    const workerRole = roles[i];
    if (!workerRole) continue;
    drafts.push({
      workerRole,
      plannedWorkerCount: parseNumber(counts[i] ?? null),
    });
  }
  return drafts;
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
  const isMilestone = formData.get("isMilestone") === "on";
  const priority = parsePriority(formData.get("priority"));

  const otherCostItems = buildOtherCostItems(formData);
  const otherCostEstimate = otherCostItems.reduce(
    (sum, item) => sum + item.amount,
    0
  );

  const totalEstimateCost =
    laborEstimate + materialEstimate + equipmentEstimate + otherCostEstimate;

  const materialAssignments = buildMaterialAssignmentDrafts(formData);
  const laborAssignments = buildLaborAssignmentDrafts(formData);

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
    isMilestone,
    priority,
    materialAssignments,
    laborAssignments,
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
      (fields.plannedStartDate && !isPlannedYearInRange(fields.plannedStartDate)) ||
      (fields.plannedEndDate && !isPlannedYearInRange(fields.plannedEndDate))
    ) {
      return { error: INVALID_DATE_RANGE_ERROR };
    }
    // Never let the end date fall before the start date — snap it to
    // match the start (a single-day task) instead of rejecting the
    // whole submission over it. Per an explicit request: whatever the
    // start date ends up being, the end date should never read as
    // earlier than it, automatically, not something the admin has to
    // notice and fix by hand.
    if (
      fields.plannedStartDate &&
      fields.plannedEndDate &&
      fields.plannedEndDate < fields.plannedStartDate
    ) {
      fields.plannedEndDate = fields.plannedStartDate;
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
        is_milestone: fields.isMilestone,
        priority: fields.priority,
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

    if (fields.materialAssignments.length > 0) {
      const { error: materialError } = await supabase
        .from("estimate_task_material_assignments")
        .insert(
          fields.materialAssignments.map((item) => ({
            task_id: task.id,
            material_name: item.materialName,
            specification: item.specification || null,
            planned_quantity: item.plannedQuantity,
            unit: item.unit || null,
          }))
        );

      if (materialError) {
        logSupabaseError(
          "[createTask] Supabase material-assignment insert failed",
          materialError
        );
        await recordGanttCheckpoint(supabase, projectId, profile.id);
        return {
          error:
            "Task item saved, but its planned materials could not be saved. Please edit the task and try again.",
        };
      }
    }

    if (fields.laborAssignments.length > 0) {
      const { error: laborError } = await supabase
        .from("estimate_task_labor_assignments")
        .insert(
          fields.laborAssignments.map((item) => ({
            task_id: task.id,
            worker_role: item.workerRole,
            planned_worker_count: item.plannedWorkerCount,
          }))
        );

      if (laborError) {
        logSupabaseError(
          "[createTask] Supabase labor-assignment insert failed",
          laborError
        );
        await recordGanttCheckpoint(supabase, projectId, profile.id);
        return {
          error:
            "Task item saved, but its planned manpower could not be saved. Please edit the task and try again.",
        };
      }
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
        await recordGanttCheckpoint(supabase, projectId, profile.id);
        return {
          error:
            "Task item saved, but its other costs could not be saved. Please edit the task and try again.",
        };
      }
    }

    await recomputeWeights(supabase, projectId);

    await recordGanttCheckpoint(supabase, projectId, profile.id);
    revalidatePath(`/admin/projects/${projectId}`);
    return { success: true, taskId: task.id };
  });
}

// updateTask (the Cost Estimate Breakdown's own former edit action) lived
// here — removed as dead code once task-form.tsx (its sole caller) was
// deleted along with that tab's own editing capability. Gantt's own
// updateSubtask below is the one real task-edit path now.

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
    if (
      !isPlannedYearInRange(plannedStartDate) ||
      !isPlannedYearInRange(plannedEndDate)
    ) {
      return { error: INVALID_DATE_RANGE_ERROR };
    }
    // Never let the end date fall before the start date — snap it to
    // match the start instead of rejecting the drag/edit outright. See
    // createTask's own matching comment for the reasoning. gantt-chart-
    // view.tsx's own persistTaskDates already clamps this client-side
    // too (so the optimistic override shown immediately after a drag or
    // typed edit is already correct, no flash-then-correct), but this
    // is the actual source of truth and has to hold on its own
    // regardless of what any particular caller already did.
    if (plannedEndDate < plannedStartDate) {
      plannedEndDate = plannedStartDate;
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

    await recordGanttCheckpoint(supabase, projectId, profile.id);
    revalidatePath(`/admin/projects/${projectId}`);
    return { success: true };
  });
}

/**
 * The Gantt Chart's own inline Priority cell — a dropdown, not a form,
 * so this is called directly (same pattern as updateTaskSchedule above)
 * rather than through useActionState. `priority` comes from a <select>
 * already limited to VALID_PRIORITIES client-side, but re-checked here
 * regardless since the submitted value still ultimately comes from the
 * client.
 */
export async function updateTaskPriority(
  taskId: number,
  projectId: number,
  priority: string
): Promise<CostEstimateActionState> {
  return safely(async () => {
    const profile = await requireAdmin();
    if (!profile) {
      return { error: "You are not authorized to manage cost estimates." };
    }
    if (!(VALID_PRIORITIES as readonly string[]).includes(priority)) {
      return { error: "Invalid priority." };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("estimate_tasks")
      .update({ priority })
      .eq("id", taskId);

    if (error) {
      logSupabaseError("[updateTaskPriority] Supabase update failed", error);
      return { error: "Could not save the new priority. Please try again." };
    }

    await recordGanttCheckpoint(supabase, projectId, profile.id);
    revalidatePath(`/admin/projects/${projectId}`);
    return { success: true };
  });
}

/**
 * Narrow, name-only update for a subtask's inline rename cell — mirrors
 * updateCategory's own narrow shape above, deliberately NOT built on top
 * of updateSubtask further down: that action overwrites dates, priority,
 * milestone flag, successor link, and material/labor assignments
 * wholesale from whatever FormData it's given, so driving it from a
 * name-only inline edit would silently wipe every other field on the
 * task. This only ever touches task_name.
 */
export async function renameTask(
  taskId: number,
  projectId: number,
  name: string
): Promise<CostEstimateActionState> {
  return safely(async () => {
    const profile = await requireAdmin();
    if (!profile) {
      return { error: "You are not authorized to manage cost estimates." };
    }
    if (!name.trim()) {
      return { error: "Task name is required." };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("estimate_tasks")
      .update({ task_name: name.trim() })
      .eq("id", taskId);

    if (error) {
      logSupabaseError("[renameTask] Supabase update failed", error);
      return { error: "Could not save the new name. Please try again." };
    }

    await recordGanttCheckpoint(supabase, projectId, profile.id);
    revalidatePath(`/admin/projects/${projectId}`);
    return { success: true };
  });
}

// updateTaskPercentComplete (the Gantt Chart's old freely-typable
// Percent Complete cell) lived here — removed along with that cell.
// Percent complete is now always computed (Automatic Progress
// Completion, anchored by a Progress Tracking Override — see
// lib/task-progress/calculate.ts and recordTaskProgress in
// lib/task-progress/actions.ts), never a plain directly-editable field.

/**
 * The actual validate-and-write behind setPredecessor below, split out so
 * updateSubtask (further down) can reuse it directly instead of calling
 * the exported setPredecessor action — which would otherwise record its
 * own recordGanttCheckpoint mid-way through updateSubtask's own larger
 * write, splitting one "Edit Task" submission into two separate undo
 * steps. Each caller records its own single checkpoint once, at the end
 * of everything *it* changed.
 */
async function applyPredecessor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  taskId: number,
  predecessorTaskId: number,
  projectId: number
): Promise<CostEstimateActionState> {
  const predecessorError = await validatePredecessor(
    supabase,
    predecessorTaskId,
    projectId,
    taskId
  );
  if (predecessorError) {
    return { error: predecessorError };
  }

  const { data: rows } = await supabase
    .from("estimate_tasks")
    .select("id, category_id")
    .in("id", [taskId, predecessorTaskId])
    .eq("project_id", projectId);

  if (
    !rows ||
    rows.length !== 2 ||
    rows[0].category_id !== rows[1].category_id
  ) {
    return { error: "Both tasks must be in the same phase." };
  }

  const { error } = await supabase
    .from("estimate_tasks")
    .update({ predecessor_task_id: predecessorTaskId })
    .eq("id", taskId);

  if (error) {
    logSupabaseError("[applyPredecessor] Supabase update failed", error);
    return { error: "Could not link the tasks. Please try again." };
  }

  return { success: true };
}

/**
 * Sets one task's predecessor by dragging a connector on the Gantt Chart
 * Schedule directly from one bar to another — called directly (not
 * bound to a <form>), same as updateTaskSchedule above. This is a
 * narrower entry point than the Predecessor <select> in the Task form:
 * that dropdown already lets you pick any task in the project as a
 * predecessor, but a connector dragged on the chart is deliberately
 * scoped to "within this phase" (see gantt-chart-view.tsx's own
 * connector-drag handler, which only ever offers same-phase targets to
 * drop onto) — enforced here too, not just assumed from the client.
 */
export async function setPredecessor(
  taskId: number,
  predecessorTaskId: number,
  projectId: number
): Promise<CostEstimateActionState> {
  return safely(async () => {
    const profile = await requireAdmin();
    if (!profile) {
      return { error: "You are not authorized to manage cost estimates." };
    }

    const supabase = await createClient();

    const result = await applyPredecessor(
      supabase,
      taskId,
      predecessorTaskId,
      projectId
    );
    if (result.error) {
      return result;
    }

    await recordGanttCheckpoint(supabase, projectId, profile.id);
    revalidatePath(`/admin/projects/${projectId}`);
    return { success: true };
  });
}

/**
 * The Gantt Chart Schedule's own lightweight "Edit Task" form — updates
 * a task's own schedule fields (name/dates/milestone) and, unlike
 * updateTask's own Predecessor field (which points *this* task at
 * whichever one it starts after), manages the *inverse* relationship: a
 * "Successor" field picking which *other* task should start after this
 * one — the same thing dragging this task's own connector handle onto
 * another bar sets (see setPredecessor above, reused here for the
 * "assign" half, since the same-phase/not-self validation is identical
 * either way). Reassigning or clearing a successor means writing to the
 * *other* task's own predecessor_task_id, never this task's own row.
 *
 * A task can only have one predecessor (a single FK column), so
 * "current successor" is "whichever other task in the project already
 * has its own predecessor_task_id pointing here" — normally at most
 * one, by construction (every write path that sets one, including this
 * one, goes through the same same-phase/single-select flow), but this
 * still defensively clears *every* match, not just the first, in case
 * an older, less-restrictive edit ever left more than one.
 */
export async function updateSubtask(
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

    const taskName = String(formData.get("taskName") ?? "").trim();
    const plannedStartDate = parseOptionalDate(formData.get("plannedStartDate"));
    let plannedEndDate = parseOptionalDate(formData.get("plannedEndDate"));
    const isMilestone = formData.get("isMilestone") === "on";
    const successorTaskId = parseOptionalId(formData.get("successorTaskId"));
    const priority = parsePriority(formData.get("priority"));
    const materialAssignments = buildMaterialAssignmentDrafts(formData);
    const laborAssignments = buildLaborAssignmentDrafts(formData);

    if (!taskName) {
      return { error: "Task name is required." };
    }
    if (
      (plannedStartDate && !isPlannedYearInRange(plannedStartDate)) ||
      (plannedEndDate && !isPlannedYearInRange(plannedEndDate))
    ) {
      return { error: INVALID_DATE_RANGE_ERROR };
    }
    // Never let the end date fall before the start date — snap it to
    // match the start instead of rejecting the whole edit. See
    // createTask's own matching comment for the reasoning.
    if (
      plannedStartDate &&
      plannedEndDate &&
      plannedEndDate < plannedStartDate
    ) {
      plannedEndDate = plannedStartDate;
    }

    const supabase = await createClient();

    const { data: currentSuccessors } = await supabase
      .from("estimate_tasks")
      .select("id")
      .eq("project_id", projectId)
      .eq("predecessor_task_id", taskId);

    const toClear = (currentSuccessors ?? [])
      .map((row) => row.id)
      .filter((id) => id !== successorTaskId);

    if (toClear.length > 0) {
      const { error: clearError } = await supabase
        .from("estimate_tasks")
        .update({ predecessor_task_id: null })
        .in("id", toClear);
      if (clearError) {
        logSupabaseError(
          "[updateSubtask] Supabase successor-clear failed",
          clearError
        );
        return {
          error: "Could not update the successor link. Please try again.",
        };
      }
    }

    const alreadyLinked = (currentSuccessors ?? []).some(
      (row) => row.id === successorTaskId
    );
    if (successorTaskId !== null && !alreadyLinked) {
      // applyPredecessor, not setPredecessor — this whole action records
      // its own single checkpoint at the end (see applyPredecessor's own
      // doc comment above for why).
      const linkResult = await applyPredecessor(
        supabase,
        successorTaskId,
        taskId,
        projectId
      );
      if (linkResult.error) {
        return linkResult;
      }
    }

    const { error } = await supabase
      .from("estimate_tasks")
      .update({
        task_name: taskName,
        planned_start_date: plannedStartDate,
        planned_end_date: plannedEndDate,
        is_milestone: isMilestone,
        priority,
      })
      .eq("id", taskId)
      .eq("project_id", projectId);

    if (error) {
      logSupabaseError("[updateSubtask] Supabase update failed", error);
      // A successor clear/link above may have already committed — real
      // DB-state change even though this particular write failed.
      await recordGanttCheckpoint(supabase, projectId, profile.id);
      return { error: "Could not update task. Please try again." };
    }

    // Replace this task's planned materials/manpower wholesale, same
    // "delete then reinsert" convention updateTask uses for Other Cost
    // Items — nothing else references these rows by id.
    const { error: materialDeleteError } = await supabase
      .from("estimate_task_material_assignments")
      .delete()
      .eq("task_id", taskId);
    if (materialDeleteError) {
      logSupabaseError(
        "[updateSubtask] Supabase material-assignment delete failed",
        materialDeleteError
      );
      await recordGanttCheckpoint(supabase, projectId, profile.id);
      return { error: "Could not save planned materials. Please try again." };
    }
    if (materialAssignments.length > 0) {
      const { error: materialInsertError } = await supabase
        .from("estimate_task_material_assignments")
        .insert(
          materialAssignments.map((item) => ({
            task_id: taskId,
            material_name: item.materialName,
            specification: item.specification || null,
            planned_quantity: item.plannedQuantity,
            unit: item.unit || null,
          }))
        );
      if (materialInsertError) {
        logSupabaseError(
          "[updateSubtask] Supabase material-assignment insert failed",
          materialInsertError
        );
        await recordGanttCheckpoint(supabase, projectId, profile.id);
        return { error: "Could not save planned materials. Please try again." };
      }
    }

    const { error: laborDeleteError } = await supabase
      .from("estimate_task_labor_assignments")
      .delete()
      .eq("task_id", taskId);
    if (laborDeleteError) {
      logSupabaseError(
        "[updateSubtask] Supabase labor-assignment delete failed",
        laborDeleteError
      );
      await recordGanttCheckpoint(supabase, projectId, profile.id);
      return { error: "Could not save planned manpower. Please try again." };
    }
    if (laborAssignments.length > 0) {
      const { error: laborInsertError } = await supabase
        .from("estimate_task_labor_assignments")
        .insert(
          laborAssignments.map((item) => ({
            task_id: taskId,
            worker_role: item.workerRole,
            planned_worker_count: item.plannedWorkerCount,
          }))
        );
      if (laborInsertError) {
        logSupabaseError(
          "[updateSubtask] Supabase labor-assignment insert failed",
          laborInsertError
        );
        await recordGanttCheckpoint(supabase, projectId, profile.id);
        return { error: "Could not save planned manpower. Please try again." };
      }
    }

    await recordGanttCheckpoint(supabase, projectId, profile.id);
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

    await recordGanttCheckpoint(supabase, projectId, profile.id);
    revalidatePath(`/admin/projects/${projectId}`);
    return { success: true };
  });
}

/**
 * Replaces one task's entire planned-materials list wholesale — the
 * same delete-then-reinsert block updateSubtask's own form submission
 * already runs against estimate_task_material_assignments, pulled out
 * on its own so the Cost Estimate Breakdown's own Material Breakdown
 * modal (see material-breakdown-modal-content.tsx) can save an edited
 * list directly, without going through updateSubtask's full form (task
 * name/dates/successor/priority/manpower — none of which that modal
 * touches). Called directly as a plain function (not useActionState —
 * this takes a plain array, matching setTaskWorkers' own convention in
 * lib/workers/actions.ts for the same reason), one call per task whose
 * own list actually changed.
 */
export async function updateTaskMaterialAssignments(
  taskId: number,
  projectId: number,
  assignments: {
    materialName: string;
    specification: string | null;
    plannedQuantity: number;
    unit: string | null;
  }[]
): Promise<CostEstimateActionState> {
  return safely(async () => {
    const profile = await requireAdmin();
    if (!profile) {
      return { error: "You are not authorized to manage cost estimates." };
    }

    const supabase = await createClient();

    const { error: deleteError } = await supabase
      .from("estimate_task_material_assignments")
      .delete()
      .eq("task_id", taskId);
    if (deleteError) {
      logSupabaseError(
        "[updateTaskMaterialAssignments] Supabase delete failed",
        deleteError
      );
      return { error: "Could not save the material list. Please try again." };
    }

    const cleaned = assignments
      .map((item) => ({
        materialName: item.materialName.trim(),
        specification: item.specification?.trim() || null,
        plannedQuantity: item.plannedQuantity,
        unit: item.unit?.trim() || null,
      }))
      .filter((item) => item.materialName.length > 0);

    if (cleaned.length > 0) {
      const { error: insertError } = await supabase
        .from("estimate_task_material_assignments")
        .insert(
          cleaned.map((item) => ({
            task_id: taskId,
            material_name: item.materialName,
            specification: item.specification,
            planned_quantity: Number.isFinite(item.plannedQuantity)
              ? item.plannedQuantity
              : 0,
            unit: item.unit,
          }))
        );
      if (insertError) {
        logSupabaseError(
          "[updateTaskMaterialAssignments] Supabase insert failed",
          insertError
        );
        return { error: "Could not save the material list. Please try again." };
      }
    }

    await recordGanttCheckpoint(supabase, projectId, profile.id);
    revalidatePath(`/admin/projects/${projectId}`);
    return { success: true };
  });
}
