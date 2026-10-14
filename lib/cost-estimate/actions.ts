"use server";

import { revalidateProjectPaths } from "@/lib/projects/revalidate";
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireProjectAccess } from "@/lib/auth/project-access";
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

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function createCategory(
  projectId: number,
  _prevState: CostEstimateActionState,
  formData: FormData
): Promise<CostEstimateActionState> {
  return safely(async () => {
    const profile = await requireProjectAccess(projectId);
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
    revalidateProjectPaths(projectId);
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
    const profile = await requireProjectAccess(projectId);
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
    revalidateProjectPaths(projectId);
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
    const profile = await requireProjectAccess(projectId);
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
    revalidateProjectPaths(projectId);
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
  };
}

export async function createTask(
  projectId: number,
  _prevState: CostEstimateActionState,
  formData: FormData
): Promise<CostEstimateActionState> {
  return safely(async () => {
    const profile = await requireProjectAccess(projectId);
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

    await recordGanttCheckpoint(supabase, projectId, profile.id);
    revalidateProjectPaths(projectId);
    return { success: true, taskId: task.id };
  });
}

// updateTask (the Cost Estimate Breakdown's own former edit action) lived
// here — removed as dead code once task-form.tsx (its sole caller) was
// deleted along with that tab's own editing capability. Gantt's own
// updateSubtask below is the one real task-edit path now.

// ---------------------------------------------------------------------------
// Import with AI
// ---------------------------------------------------------------------------

export type BomImportMaterialInput = {
  name: string;
  quantity: string;
  unit: string;
  unitCost: string;
};

export type BomImportTaskInput = {
  name: string;
  quantity: string;
  unit: string;
  materials: BomImportMaterialInput[];
};

export type BomImportCategoryInput = {
  name: string;
  /** This category's own direct amount — only meaningful (and only
   * ever applied below) while `tasks` is empty. See ExtractedCategory's
   * own doc comment (lib/bom-import/actions.ts) for where this comes
   * from. */
  amount: string;
  tasks: BomImportTaskInput[];
};

/**
 * Writes an admin-reviewed "Import with AI" draft to the project —
 * every category becomes a real estimate_categories row, every task a
 * real estimate_tasks row under it, every material line a real
 * estimate_task_material_assignments row under that. Called once, from
 * the review step's own "Confirm & Create Tasks" button, with whatever
 * the admin has at that point (Gemini's own extraction from
 * extractBomFromFile in lib/bom-import/actions.ts, corrected by hand as
 * needed) — nothing before this point ever touches the database.
 *
 * Rows are created sequentially, not as one batch insert per table —
 * each category/task needs its own id back before the next level can
 * reference it as a foreign key, and a multi-row INSERT isn't
 * guaranteed to return its rows in the same order they were given, so
 * batching them and matching ids back up by array index would be a
 * real (if rare) correctness risk — a task silently attached to the
 * wrong category. Materials are the one exception: they have no
 * children of their own to need an id back for, so each task's own
 * material lines go in as a single batch insert.
 *
 * A task's own material_estimate/total_estimate_cost are computed here
 * from its material lines' own (quantity * unitCost) sum — the same
 * formula updateTaskMaterialAssignments already uses for the same two
 * columns — so an imported task's own cost total is correct immediately,
 * not left at 0 until someone happens to reopen Material Breakdown and
 * resave it. A category with no tasks of its own instead gets its own
 * `amount` written straight to material_direct_amount/
 * category_material_estimate (the same two columns
 * updateCategoryMaterialAssignments uses for a category created by hand) —
 * this is the standalone-line-item case (e.g. a BOM's own "MOBILIZATION"
 * row with a peso amount and nothing broken out underneath it); a
 * category that does have tasks leaves those two columns at their
 * defaults, since its own total is already a rollup of its tasks.
 *
 * recordGanttCheckpoint runs once at the very end (or as soon as
 * something fails), not per row — this reads as one single undo step,
 * matching what a bulk import actually is to the admin, not dozens of
 * separate ones. Imported tasks/categories need no weight of their own:
 * weights are computed from cost when the estimate is read (see
 * lib/cost-estimate/weights.ts).
 */
export async function applyBomImport(
  projectId: number,
  categories: BomImportCategoryInput[]
): Promise<CostEstimateActionState> {
  return safely(async () => {
    const profile = await requireProjectAccess(projectId);
    if (!profile) {
      return { error: "You are not authorized to manage cost estimates." };
    }

    const cleanCategories = categories
      .map((category) => ({
        name: category.name.trim(),
        amount: parseNumber(category.amount),
        tasks: category.tasks
          .map((task) => ({
            name: task.name.trim(),
            quantity: parseNumber(task.quantity),
            unit: task.unit.trim(),
            materials: task.materials
              .map((material) => ({
                name: material.name.trim(),
                quantity: parseNumber(material.quantity),
                unit: material.unit.trim(),
                unitCost: parseNumber(material.unitCost),
              }))
              .filter((material) => material.name.length > 0),
          }))
          .filter((task) => task.name.length > 0),
      }))
      .filter((category) => category.name.length > 0);

    if (cleanCategories.length === 0) {
      return {
        error: "There's nothing to import — add at least one category with a name.",
      };
    }

    const supabase = await createClient();

    for (const category of cleanCategories) {
      const isStandalone = category.tasks.length === 0 && category.amount > 0;

      const { data: categoryRow, error: categoryError } = await supabase
        .from("estimate_categories")
        .insert({
          project_id: projectId,
          category_name: category.name,
          ...(isStandalone && {
            material_direct_amount: category.amount,
            category_material_estimate: category.amount,
          }),
        })
        .select("id")
        .single();

      if (categoryError || !categoryRow) {
        if (categoryError) {
          logSupabaseError(
            "[applyBomImport] Supabase category insert failed",
            categoryError
          );
        }
        await recordGanttCheckpoint(supabase, projectId, profile.id);
        revalidateProjectPaths(projectId);
        return {
          error: `Could not create "${category.name}" — the import stopped partway through; whatever was already created is still saved. Please try again for the rest.`,
        };
      }

      for (const task of category.tasks) {
        const materialEstimate = task.materials.reduce(
          (sum, material) => sum + material.quantity * material.unitCost,
          0
        );

        const { data: taskRow, error: taskError } = await supabase
          .from("estimate_tasks")
          .insert({
            project_id: projectId,
            category_id: categoryRow.id,
            task_name: task.name,
            estimated_quantity: task.quantity,
            unit: task.unit || null,
            material_estimate: materialEstimate,
            total_estimate_cost: materialEstimate,
            priority: "medium",
          })
          .select("id")
          .single();

        if (taskError || !taskRow) {
          if (taskError) {
            logSupabaseError("[applyBomImport] Supabase task insert failed", taskError);
          }
          await recordGanttCheckpoint(supabase, projectId, profile.id);
          revalidateProjectPaths(projectId);
          return {
            error: `Could not create "${task.name}" under "${category.name}" — the import stopped partway through; whatever was already created is still saved. Please try again for the rest.`,
          };
        }

        if (task.materials.length > 0) {
          const { error: materialError } = await supabase
            .from("estimate_task_material_assignments")
            .insert(
              task.materials.map((material) => ({
                task_id: taskRow.id,
                material_name: material.name,
                planned_quantity: material.quantity,
                unit: material.unit || null,
                unit_cost: material.unitCost,
              }))
            );

          if (materialError) {
            // Doesn't abort the import — the task row itself already
            // saved correctly, same "a partial failure is still real
            // DB state, not nothing" reasoning createTask's own material-
            // assignment error path above already uses. Only this one
            // task's own material breakdown is affected; it can always
            // be re-added by hand from Material Breakdown afterward.
            logSupabaseError(
              "[applyBomImport] Supabase material-assignment insert failed",
              materialError
            );
          }
        }
      }
    }

    await recordGanttCheckpoint(supabase, projectId, profile.id);
    revalidateProjectPaths(projectId);
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
    const profile = await requireProjectAccess(projectId);
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
    revalidateProjectPaths(projectId);
    return { success: true };
  });
}

/**
 * Same idea as updateTaskSchedule above, one level up — a category's
 * own planned start/end (see CostCategory.plannedStartDate's own doc
 * comment). Only reachable from the Gantt Chart's own Start/End cells
 * while the category has no tasks yet; once it does, those cells lock
 * back to a read-only rollup and this is never called for it again.
 */
export async function updateCategorySchedule(
  categoryId: number,
  projectId: number,
  plannedStartDate: string,
  plannedEndDate: string
): Promise<CostEstimateActionState> {
  return safely(async () => {
    const profile = await requireProjectAccess(projectId);
    if (!profile) {
      return { error: "You are not authorized to manage cost estimates." };
    }
    if (
      !isPlannedYearInRange(plannedStartDate) ||
      !isPlannedYearInRange(plannedEndDate)
    ) {
      return { error: INVALID_DATE_RANGE_ERROR };
    }
    if (plannedEndDate < plannedStartDate) {
      plannedEndDate = plannedStartDate;
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("estimate_categories")
      .update({
        planned_start_date: plannedStartDate,
        planned_end_date: plannedEndDate,
      })
      .eq("id", categoryId);

    if (error) {
      logSupabaseError("[updateCategorySchedule] Supabase update failed", error);
      return { error: "Could not save the new schedule. Please try again." };
    }

    await recordGanttCheckpoint(supabase, projectId, profile.id);
    revalidateProjectPaths(projectId);
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
    const profile = await requireProjectAccess(projectId);
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
    revalidateProjectPaths(projectId);
    return { success: true };
  });
}

/**
 * Same idea as updateTaskPriority above, one level up — a category's
 * own priority (see CostCategory.priority's own doc comment). Always
 * directly set, never a rollup of its tasks' own priorities.
 */
export async function updateCategoryPriority(
  categoryId: number,
  projectId: number,
  priority: string
): Promise<CostEstimateActionState> {
  return safely(async () => {
    const profile = await requireProjectAccess(projectId);
    if (!profile) {
      return { error: "You are not authorized to manage cost estimates." };
    }
    if (!(VALID_PRIORITIES as readonly string[]).includes(priority)) {
      return { error: "Invalid priority." };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("estimate_categories")
      .update({ priority })
      .eq("id", categoryId);

    if (error) {
      logSupabaseError(
        "[updateCategoryPriority] Supabase update failed",
        error
      );
      return { error: "Could not save the new priority. Please try again." };
    }

    await recordGanttCheckpoint(supabase, projectId, profile.id);
    revalidateProjectPaths(projectId);
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
    const profile = await requireProjectAccess(projectId);
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
    revalidateProjectPaths(projectId);
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
 * The actual validate-and-write behind updateSubtask's own "Successor"
 * field below (setting task A's predecessor is how task A's own
 * successor, "the task that starts after A," gets recorded). Split out
 * of updateSubtask as its own function purely so a failed link can
 * short-circuit that larger write cleanly, without updateSubtask having
 * to record its own recordGanttCheckpoint until everything it changed
 * (including this) has actually succeeded.
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
 * The Gantt Chart Schedule's own lightweight "Edit Task" form — updates
 * a task's own schedule fields (name/dates/milestone) and manages a
 * "Successor" field picking which *other* task should start after this
 * one (the inverse of that other task's own predecessor_task_id — see
 * applyPredecessor above, reused here for the "assign" half, since the
 * same-phase/not-self validation is identical either way). Reassigning
 * or clearing a successor means writing to the *other* task's own
 * predecessor_task_id, never this task's own row.
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
    const profile = await requireProjectAccess(projectId);
    if (!profile) {
      return { error: "You are not authorized to manage cost estimates." };
    }

    // No task name here — an existing task is renamed from the Gantt
    // task list's own Task cell (renameTask above), not this form.
    const isMilestone = formData.get("isMilestone") === "on";
    const successorTaskId = parseOptionalId(formData.get("successorTaskId"));

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
      // This whole action records its own single checkpoint at the end
      // — see applyPredecessor's own doc comment above for why.
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

    // Deliberately no planned_start_date/planned_end_date/priority here
    // — this form no longer manages a task's schedule or priority at
    // all (removed per an explicit request, since the Gantt task list's
    // own Start/End/Priority cells already do; those stay the one place
    // that edits them). Omitting the columns from this update leaves
    // whatever's already stored untouched, same as how
    // estimatedQuantity/materialEstimate/etc. were already excluded
    // here. Material/labor assignments are the same story — see this
    // form's own doc comment: materials are now exclusively managed
    // from the Material Breakdown modal, and the labor/manpower
    // role+headcount list this used to also manage here has no UI left
    // anywhere in the app to show it, so this action no longer touches
    // either table.
    const { error } = await supabase
      .from("estimate_tasks")
      .update({
        is_milestone: isMilestone,
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

    await recordGanttCheckpoint(supabase, projectId, profile.id);
    revalidateProjectPaths(projectId);
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
    const profile = await requireProjectAccess(projectId);
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

    await recordGanttCheckpoint(supabase, projectId, profile.id);
    revalidateProjectPaths(projectId);
    return { success: true };
  });
}

type MaterialDirectInput = {
  quantity: number;
  unit: string | null;
  unitCost: number;
  /** Null means "compute quantity * unitCost as normal"; a non-null value
   * means Amount was typed directly on this own line (no clean quantity/
   * unit cost breakdown). See 0043_amount_overrides.sql's own comment. */
  amountOverride: number | null;
};

type MaterialLineInput = {
  materialName: string;
  specification: string | null;
  plannedQuantity: number;
  unit: string | null;
  unitCost: number;
  amountOverride: number | null;
};

function finiteOrZero(value: number) {
  return Number.isFinite(value) ? value : 0;
}

/** A material list as it's saved: trimmed, non-finite numbers zeroed,
 * unnamed lines dropped. */
function cleanMaterialLines(lines: MaterialLineInput[]): MaterialLineInput[] {
  return lines
    .map((item) => ({
      materialName: item.materialName.trim(),
      specification: item.specification?.trim() || null,
      plannedQuantity: finiteOrZero(item.plannedQuantity),
      unit: item.unit?.trim() || null,
      unitCost: finiteOrZero(item.unitCost),
      amountOverride:
        item.amountOverride != null && Number.isFinite(item.amountOverride)
          ? item.amountOverride
          : null,
    }))
    .filter((item) => item.materialName.length > 0);
}

function materialLineRow(item: MaterialLineInput) {
  return {
    material_name: item.materialName,
    specification: item.specification,
    planned_quantity: item.plannedQuantity,
    unit: item.unit,
    unit_cost: item.unitCost,
    amount: item.amountOverride,
  };
}

/** An own direct line's columns, and the material total it and `lines`
 * add up to — what material_estimate / category_material_estimate store. */
function materialTotals(direct: MaterialDirectInput, lines: MaterialLineInput[]) {
  const quantity = finiteOrZero(direct.quantity);
  const unitCost = finiteOrZero(direct.unitCost);
  const amountOverride =
    direct.amountOverride != null && Number.isFinite(direct.amountOverride)
      ? direct.amountOverride
      : null;
  return {
    directFields: {
      material_direct_quantity: quantity,
      material_direct_unit: direct.unit?.trim() || null,
      material_unit_cost: unitCost,
      material_direct_amount: amountOverride,
    },
    total:
      (amountOverride ?? quantity * unitCost) +
      lines.reduce(
        (sum, item) => sum + (item.amountOverride ?? item.plannedQuantity * item.unitCost),
        0
      ),
  };
}

/** Whether a query failed only because its table doesn't exist yet — a
 * migration not run (PostgREST's PGRST205, or Postgres' own 42P01). */
function isMissingTable(error: PostgrestError | null) {
  return error?.code === "PGRST205" || error?.code === "42P01";
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
  materialDirect: MaterialDirectInput,
  assignments: MaterialLineInput[]
): Promise<CostEstimateActionState> {
  return safely(async () => {
    const profile = await requireProjectAccess(projectId);
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

    const cleaned = cleanMaterialLines(assignments);

    if (cleaned.length > 0) {
      const { error: insertError } = await supabase
        .from("estimate_task_material_assignments")
        .insert(cleaned.map((item) => ({ task_id: taskId, ...materialLineRow(item) })));
      if (insertError) {
        logSupabaseError(
          "[updateTaskMaterialAssignments] Supabase insert failed",
          insertError
        );
        return { error: "Could not save the material list. Please try again." };
      }
    }

    // material_estimate/total_estimate_cost are stored columns, not
    // computed at read time (see CostTask.materialEstimate's own doc
    // comment) — kept in sync here, in the same round trip, rather than
    // left stale until some unrelated action next happens to touch this
    // task's own cost fields.
    const { directFields, total: newMaterialEstimate } = materialTotals(
      materialDirect,
      cleaned
    );

    const { data: currentTask, error: taskFetchError } = await supabase
      .from("estimate_tasks")
      .select("labor_estimate, equipment_estimate, other_cost_estimate")
      .eq("id", taskId)
      .single();
    if (taskFetchError || !currentTask) {
      logSupabaseError(
        "[updateTaskMaterialAssignments] Supabase task fetch failed",
        taskFetchError
      );
      return { error: "Could not save the material list. Please try again." };
    }

    const newTotalEstimateCost =
      (currentTask.labor_estimate ?? 0) +
      newMaterialEstimate +
      (currentTask.equipment_estimate ?? 0) +
      (currentTask.other_cost_estimate ?? 0);

    const { error: taskUpdateError } = await supabase
      .from("estimate_tasks")
      .update({
        ...directFields,
        material_estimate: newMaterialEstimate,
        total_estimate_cost: newTotalEstimateCost,
      })
      .eq("id", taskId);
    if (taskUpdateError) {
      logSupabaseError(
        "[updateTaskMaterialAssignments] Supabase task update failed",
        taskUpdateError
      );
      return { error: "Could not save the material list. Please try again." };
    }

    await recordGanttCheckpoint(supabase, projectId, profile.id);
    revalidateProjectPaths(projectId);
    return { success: true };
  });
}

/**
 * Saves a task's own labor_estimate — called from the Labor Breakdown
 * modal's own Labor Percentage cell (see LaborBreakdownModalContent),
 * which computes this peso amount itself (percent * this task's own
 * material+equipment+other cost, the same rule-of-thumb formula
 * 0036_project_default_labor_cost_percent.sql originally documented)
 * and passes the result straight in — this action just persists it,
 * the same fetch-current-then-recompute-total pattern
 * updateTaskMaterialAssignments above already uses for the other cost
 * columns.
 */
export async function updateTaskLaborEstimate(
  taskId: number,
  projectId: number,
  laborEstimate: number
): Promise<CostEstimateActionState> {
  return safely(async () => {
    const profile = await requireProjectAccess(projectId);
    if (!profile) {
      return { error: "You are not authorized to manage cost estimates." };
    }

    const supabase = await createClient();

    const { data: currentTask, error: fetchError } = await supabase
      .from("estimate_tasks")
      .select("material_estimate, equipment_estimate, other_cost_estimate")
      .eq("id", taskId)
      .single();
    if (fetchError || !currentTask) {
      logSupabaseError(
        "[updateTaskLaborEstimate] Supabase task fetch failed",
        fetchError
      );
      return { error: "Could not save the labor cost. Please try again." };
    }

    const totalEstimateCost =
      laborEstimate +
      (currentTask.material_estimate ?? 0) +
      (currentTask.equipment_estimate ?? 0) +
      (currentTask.other_cost_estimate ?? 0);

    const { error } = await supabase
      .from("estimate_tasks")
      .update({
        labor_estimate: laborEstimate,
        total_estimate_cost: totalEstimateCost,
      })
      .eq("id", taskId);

    if (error) {
      logSupabaseError("[updateTaskLaborEstimate] Supabase update failed", error);
      return { error: "Could not save the labor cost. Please try again." };
    }

    await recordGanttCheckpoint(supabase, projectId, profile.id);
    revalidateProjectPaths(projectId);
    return { success: true };
  });
}

// Below this, two peso amounts are the same (they're shown to the peso).
const PESO_EPSILON = 0.005;

function formatPeso(amount: number) {
  return `₱${amount.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
}

function invalidCostComponents(values: number[]): boolean {
  return values.some((value) => !Number.isFinite(value) || value < 0);
}

/**
 * Saves a task's own cost components — Labor, Material, Equipment and
 * Other — typed straight into the Weight Breakdown panel
 * (weight-breakdown-modal-content.tsx). They're what a task's weight is
 * computed from (lib/cost-estimate/weights.ts), so changing them is what
 * moves it.
 *
 * Material is a total, but a task's material_estimate is its own direct
 * (lump-sum) line plus its itemized Material Breakdown lines — so the
 * itemized lines are left exactly as they are and the direct line takes
 * whatever the typed total adds on top of them (its amount override, see
 * 0043_amount_overrides.sql; cleared when it lands back on the line's
 * own quantity x unit cost). A total below the itemized lines' own sum is
 * refused — those lines are lowered in the Material Breakdown itself.
 * Material is only touched at all when it actually changed.
 *
 * Other is left as-is (the argument ignored) while the task has itemized
 * other costs (estimate_task_other_costs) — its Other is their sum then.
 */
export async function updateTaskCostComponents(
  taskId: number,
  projectId: number,
  components: {
    laborEstimate: number;
    materialEstimate: number;
    equipmentEstimate: number;
    otherCostEstimate: number;
  }
): Promise<CostEstimateActionState> {
  return safely(async () => {
    const profile = await requireProjectAccess(projectId);
    if (!profile) {
      return { error: "You are not authorized to manage cost estimates." };
    }
    const { laborEstimate, materialEstimate, equipmentEstimate, otherCostEstimate } =
      components;
    if (
      invalidCostComponents([laborEstimate, materialEstimate, equipmentEstimate, otherCostEstimate])
    ) {
      return { error: "Costs must be 0 or more." };
    }

    const supabase = await createClient();
    const [
      { data: currentTask, error: fetchError },
      { data: materialLines, error: linesError },
      { count: otherItemCount, error: countError },
    ] = await Promise.all([
      supabase
        .from("estimate_tasks")
        .select(
          "material_estimate, other_cost_estimate, material_direct_quantity, material_unit_cost"
        )
        .eq("id", taskId)
        .eq("project_id", projectId)
        .single(),
      supabase
        .from("estimate_task_material_assignments")
        .select("planned_quantity, unit_cost, amount")
        .eq("task_id", taskId),
      supabase
        .from("estimate_task_other_costs")
        .select("id", { count: "exact", head: true })
        .eq("task_id", taskId),
    ]);
    if (fetchError || linesError || countError || !currentTask) {
      if (fetchError) {
        logSupabaseError("[updateTaskCostComponents] Supabase task fetch failed", fetchError);
      }
      if (linesError) {
        logSupabaseError("[updateTaskCostComponents] Supabase material lines fetch failed", linesError);
      }
      if (countError) {
        logSupabaseError("[updateTaskCostComponents] Supabase other-cost count failed", countError);
      }
      return { error: "Could not save the costs. Please try again." };
    }

    const materialChanged =
      Math.abs(materialEstimate - (currentTask.material_estimate ?? 0)) >= PESO_EPSILON;
    let materialFields: {
      material_estimate: number;
      material_direct_amount: number | null;
    } | null = null;
    if (materialChanged) {
      const itemized = (materialLines ?? []).reduce(
        (sum, line) =>
          sum + (line.amount ?? (line.planned_quantity ?? 0) * (line.unit_cost ?? 0)),
        0
      );
      if (materialEstimate < itemized - PESO_EPSILON) {
        return {
          error: `Material can't be less than this task's itemized materials (${formatPeso(itemized)}) — lower those in the Material Breakdown.`,
        };
      }
      const directAmount = Math.max(0, materialEstimate - itemized);
      const directComputed =
        (currentTask.material_direct_quantity ?? 0) * (currentTask.material_unit_cost ?? 0);
      materialFields = {
        material_estimate: materialEstimate,
        material_direct_amount:
          Math.abs(directAmount - directComputed) < PESO_EPSILON ? null : directAmount,
      };
    }

    const material = materialFields?.material_estimate ?? currentTask.material_estimate ?? 0;
    const other =
      (otherItemCount ?? 0) > 0 ? (currentTask.other_cost_estimate ?? 0) : otherCostEstimate;

    const { error } = await supabase
      .from("estimate_tasks")
      .update({
        ...materialFields,
        labor_estimate: laborEstimate,
        equipment_estimate: equipmentEstimate,
        other_cost_estimate: other,
        total_estimate_cost: laborEstimate + material + equipmentEstimate + other,
      })
      .eq("id", taskId);

    if (error) {
      logSupabaseError("[updateTaskCostComponents] Supabase update failed", error);
      return { error: "Could not save the costs. Please try again." };
    }

    await recordGanttCheckpoint(supabase, projectId, profile.id);
    revalidateProjectPaths(projectId);
    return { success: true };
  });
}

/**
 * Same as updateTaskCostComponents above, one level up — a category's
 * own direct line (e.g. a standalone MOBILIZATION): its labor
 * (0047_category_labor_estimate.sql), material (0042_category_direct_
 * cost.sql — the typed total, less its own itemized lines (0058), becomes
 * the direct line's amount override, cleared when it lands back on its
 * own quantity x unit cost; never below those lines), and equipment /
 * other (0056_category_equipment_other.sql).
 */
export async function updateCategoryCostComponents(
  categoryId: number,
  projectId: number,
  components: {
    laborEstimate: number;
    materialEstimate: number;
    equipmentEstimate: number;
    otherCostEstimate: number;
  }
): Promise<CostEstimateActionState> {
  return safely(async () => {
    const profile = await requireProjectAccess(projectId);
    if (!profile) {
      return { error: "You are not authorized to manage cost estimates." };
    }
    const { laborEstimate, materialEstimate, equipmentEstimate, otherCostEstimate } =
      components;
    if (
      invalidCostComponents([laborEstimate, materialEstimate, equipmentEstimate, otherCostEstimate])
    ) {
      return { error: "Costs must be 0 or more." };
    }

    const supabase = await createClient();
    const [
      { data: currentCategory, error: fetchError },
      { data: materialLines, error: linesError },
    ] = await Promise.all([
      supabase
        .from("estimate_categories")
        .select("category_material_estimate, material_direct_quantity, material_unit_cost")
        .eq("id", categoryId)
        .eq("project_id", projectId)
        .single(),
      supabase
        .from("estimate_category_material_assignments")
        .select("planned_quantity, unit_cost, amount")
        .eq("category_id", categoryId),
    ]);
    // No lines table yet (0058 not run) just means no itemized lines.
    const realLinesError = isMissingTable(linesError) ? null : linesError;
    if (fetchError || realLinesError || !currentCategory) {
      if (fetchError) {
        logSupabaseError("[updateCategoryCostComponents] Supabase fetch failed", fetchError);
      }
      if (realLinesError) {
        logSupabaseError(
          "[updateCategoryCostComponents] Supabase material lines fetch failed",
          realLinesError
        );
      }
      return { error: "Could not save the costs. Please try again." };
    }

    const materialChanged =
      Math.abs(materialEstimate - (currentCategory.category_material_estimate ?? 0)) >=
      PESO_EPSILON;
    const itemized = (materialLines ?? []).reduce(
      (sum, line) =>
        sum + (line.amount ?? (line.planned_quantity ?? 0) * (line.unit_cost ?? 0)),
      0
    );
    if (materialChanged && materialEstimate < itemized - PESO_EPSILON) {
      return {
        error: `Material can't be less than this main task's itemized materials (${formatPeso(itemized)}) — lower those in the Material Breakdown.`,
      };
    }
    const directAmount = Math.max(0, materialEstimate - itemized);
    const directComputed =
      (currentCategory.material_direct_quantity ?? 0) * (currentCategory.material_unit_cost ?? 0);

    const { error } = await supabase
      .from("estimate_categories")
      .update({
        ...(materialChanged && {
          category_material_estimate: materialEstimate,
          material_direct_amount:
            Math.abs(directAmount - directComputed) < PESO_EPSILON ? null : directAmount,
        }),
        category_labor_estimate: laborEstimate,
        category_equipment_estimate: equipmentEstimate,
        category_other_estimate: otherCostEstimate,
      })
      .eq("id", categoryId);

    if (error) {
      logSupabaseError("[updateCategoryCostComponents] Supabase update failed", error);
      return { error: "Could not save the costs. Please try again." };
    }

    await recordGanttCheckpoint(supabase, projectId, profile.id);
    revalidateProjectPaths(projectId);
    return { success: true };
  });
}

const UNIT_MAX_LENGTH = 30;

function normalizeEstimatedQuantity(input: {
  estimatedQuantity: number;
  unit: string | null;
}): { estimatedQuantity: number; unit: string | null } | { error: string } {
  if (!Number.isFinite(input.estimatedQuantity) || input.estimatedQuantity < 0) {
    return { error: "Estimated quantity must be 0 or more." };
  }
  const unit = input.unit?.trim() || null;
  if (unit && unit.length > UNIT_MAX_LENGTH) {
    return { error: `Unit can be at most ${UNIT_MAX_LENGTH} characters.` };
  }
  return { estimatedQuantity: input.estimatedQuantity, unit };
}

/**
 * Saves a task's own Estimated Quantity and Unit, typed straight into
 * the Cost Estimate table — the amount of work to be done (e.g. 12
 * cu.m), which a Daily Progress Update's quantity completed is measured
 * against (lib/task-progress/calculate.ts). Not a cost, so it never
 * moves the task's weight.
 */
export async function updateTaskEstimatedQuantity(
  taskId: number,
  projectId: number,
  input: { estimatedQuantity: number; unit: string | null }
): Promise<CostEstimateActionState> {
  return safely(async () => {
    const profile = await requireProjectAccess(projectId);
    if (!profile) {
      return { error: "You are not authorized to manage cost estimates." };
    }
    const fields = normalizeEstimatedQuantity(input);
    if ("error" in fields) {
      return { error: fields.error };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("estimate_tasks")
      .update({ estimated_quantity: fields.estimatedQuantity, unit: fields.unit })
      .eq("id", taskId)
      .eq("project_id", projectId);

    if (error) {
      logSupabaseError("[updateTaskEstimatedQuantity] Supabase update failed", error);
      return { error: "Could not save the estimated quantity. Please try again." };
    }

    await recordGanttCheckpoint(supabase, projectId, profile.id);
    revalidateProjectPaths(projectId);
    return { success: true };
  });
}

/**
 * Same as updateTaskEstimatedQuantity above, one level up — a task-less
 * category's own quantity (see 0048_category_progress_tracking.sql). A
 * category with tasks has none of its own; its tasks each carry theirs.
 */
export async function updateCategoryEstimatedQuantity(
  categoryId: number,
  projectId: number,
  input: { estimatedQuantity: number; unit: string | null }
): Promise<CostEstimateActionState> {
  return safely(async () => {
    const profile = await requireProjectAccess(projectId);
    if (!profile) {
      return { error: "You are not authorized to manage cost estimates." };
    }
    const fields = normalizeEstimatedQuantity(input);
    if ("error" in fields) {
      return { error: fields.error };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("estimate_categories")
      .update({ estimated_quantity: fields.estimatedQuantity, unit: fields.unit })
      .eq("id", categoryId)
      .eq("project_id", projectId);

    if (error) {
      logSupabaseError("[updateCategoryEstimatedQuantity] Supabase update failed", error);
      return { error: "Could not save the estimated quantity. Please try again." };
    }

    await recordGanttCheckpoint(supabase, projectId, profile.id);
    revalidateProjectPaths(projectId);
    return { success: true };
  });
}

/**
 * Bulk-applies a Labor Rate % project-wide, unconditionally — called
 * from the Labor Breakdown modal's own top field (see
 * LaborBreakdownModalContent). Per an explicit decision: the rate is the
 * one authoritative source for labor cost, so changing it recomputes
 * EVERY task's own labor_estimate, AND every task-less category's own
 * category_labor_estimate (see 0047_category_labor_estimate.sql's own
 * comment — a category with tasks has no direct labor line of its own,
 * same asymmetric rule Material Breakdown already established), to
 * rate% * the project's overall Material + Equipment + Other total —
 * overwriting whatever was there before, including a row whose own
 * Labor Percentage cell was individually typed into earlier. There's no
 * "already has its own labor cost, leave it alone" carve-out; the rate
 * field is a reset, not a fill-in-the-blanks default.
 *
 * Deliberately fetches every category/task's own Material + Equipment +
 * Other cost FRESH here, server-side, rather than trusting the
 * categories the client already has in props — those can be one
 * revalidation behind the database (e.g. right after a Material
 * Breakdown save in the same session), and computing the % against a
 * stale, too-low total would silently under-apply the rate. This is the
 * one place that base is computed for real.
 */
export async function applyLaborRateProjectWide(
  projectId: number,
  percent: number
): Promise<CostEstimateActionState> {
  return safely(async () => {
    const profile = await requireProjectAccess(projectId);
    if (!profile) {
      return { error: "You are not authorized to manage cost estimates." };
    }

    const supabase = await createClient();

    const [{ data: categoryRows, error: categoryError }, { data: taskRows, error: taskError }] =
      await Promise.all([
        // "*" so a DB without 0056_category_equipment_other.sql's two
        // columns yet still works (they just count as 0).
        supabase
          .from("estimate_categories")
          .select("*")
          .eq("project_id", projectId),
        supabase
          .from("estimate_tasks")
          .select("id, category_id, material_estimate, equipment_estimate, other_cost_estimate")
          .eq("project_id", projectId),
      ]);

    if (categoryError || taskError || !categoryRows || !taskRows) {
      logSupabaseError(
        "[applyLaborRateProjectWide] Supabase fetch failed",
        categoryError ?? taskError!
      );
      return { error: "Could not apply the labor rate. Please try again." };
    }

    const projectBase =
      categoryRows.reduce(
        (sum, c) =>
          sum +
          (c.category_material_estimate ?? 0) +
          (c.category_equipment_estimate ?? 0) +
          (c.category_other_estimate ?? 0),
        0
      ) +
      taskRows.reduce(
        (sum, t) =>
          sum +
          (t.material_estimate ?? 0) +
          (t.equipment_estimate ?? 0) +
          (t.other_cost_estimate ?? 0),
        0
      );
    const newAmount = (percent / 100) * projectBase;

    const categoryTaskCount = new Map<number, number>();
    for (const t of taskRows) {
      categoryTaskCount.set(t.category_id, (categoryTaskCount.get(t.category_id) ?? 0) + 1);
    }
    const taskLessCategories = categoryRows.filter(
      (c) => (categoryTaskCount.get(c.id) ?? 0) === 0
    );

    // TEMPORARY diagnostics — narrowing down why task-less categories
    // keep reading back as 0% despite this running with no visible
    // error. .select() forces Supabase to return the rows it actually
    // matched/updated, so an empty array here (vs. a real row) would
    // mean RLS or the .eq("id", ...) itself silently matched nothing,
    // rather than the write erroring outright.
    console.log(
      "[applyLaborRateProjectWide] projectBase=",
      projectBase,
      "newAmount=",
      newAmount,
      "taskLessCategories=",
      taskLessCategories.map((c) => c.id)
    );

    const taskResults = await Promise.all(
      taskRows.map((t) =>
        supabase
          .from("estimate_tasks")
          .update({
            labor_estimate: newAmount,
            total_estimate_cost:
              newAmount +
              (t.material_estimate ?? 0) +
              (t.equipment_estimate ?? 0) +
              (t.other_cost_estimate ?? 0),
          })
          .eq("id", t.id)
      )
    );
    const categoryResults = await Promise.all(
      taskLessCategories.map((c) =>
        supabase
          .from("estimate_categories")
          .update({ category_labor_estimate: newAmount })
          .eq("id", c.id)
          .select("id, category_labor_estimate")
      )
    );
    console.log(
      "[applyLaborRateProjectWide] categoryResults=",
      categoryResults.map((r) => ({ error: r.error, data: r.data }))
    );
    const results = [...taskResults, ...categoryResults];
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      logSupabaseError("[applyLaborRateProjectWide] Supabase update failed", failed.error);
      return { error: "Could not apply the labor rate. Please try again." };
    }

    await recordGanttCheckpoint(supabase, projectId, profile.id);
    revalidateProjectPaths(projectId);
    return { success: true };
  });
}

/**
 * Saves a category's own direct labor cost (Labor Breakdown modal's own
 * per-category cell — see LaborBreakdownModalContent) — only meaningful
 * while the category has no tasks yet, same "own direct line" rule
 * updateCategoryMaterialAssignments below already follows for material cost.
 * A category's own material/equipment/other-cost columns don't apply
 * here (categories have no equipment/other cost of their own, and this
 * doesn't touch category_material_estimate), so there's no
 * total-recompute step the task equivalent needs — this is the only
 * cost figure a task-less category has.
 */
export async function updateCategoryLaborEstimate(
  categoryId: number,
  projectId: number,
  laborEstimate: number
): Promise<CostEstimateActionState> {
  return safely(async () => {
    const profile = await requireProjectAccess(projectId);
    if (!profile) {
      return { error: "You are not authorized to manage cost estimates." };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("estimate_categories")
      .update({ category_labor_estimate: laborEstimate })
      .eq("id", categoryId);

    if (error) {
      logSupabaseError("[updateCategoryLaborEstimate] Supabase update failed", error);
      return { error: "Could not save the labor cost. Please try again." };
    }

    await recordGanttCheckpoint(supabase, projectId, profile.id);
    revalidateProjectPaths(projectId);
    return { success: true };
  });
}

/**
 * Same as updateTaskMaterialAssignments above, one level up — a
 * category's own direct BOM line (see CostCategory.materialDirectQuantity's
 * own doc comment) plus its own itemized materials (0058_category_material_
 * lines.sql, a standalone main task's Add Material), the list replaced
 * wholesale and category_material_estimate kept in sync in the same round
 * trip.
 */
export async function updateCategoryMaterialAssignments(
  categoryId: number,
  projectId: number,
  materialDirect: MaterialDirectInput,
  assignments: MaterialLineInput[]
): Promise<CostEstimateActionState> {
  return safely(async () => {
    const profile = await requireProjectAccess(projectId);
    if (!profile) {
      return { error: "You are not authorized to manage cost estimates." };
    }

    const supabase = await createClient();
    const cleaned = cleanMaterialLines(assignments);

    const { error: deleteError } = await supabase
      .from("estimate_category_material_assignments")
      .delete()
      .eq("category_id", categoryId);
    // Before 0058 has run there are no lines to delete, and a direct line
    // alone still saves.
    if (deleteError && !(isMissingTable(deleteError) && cleaned.length === 0)) {
      logSupabaseError(
        "[updateCategoryMaterialAssignments] Supabase delete failed",
        deleteError
      );
      return { error: "Could not save the material list. Please try again." };
    }

    if (cleaned.length > 0) {
      const { error: insertError } = await supabase
        .from("estimate_category_material_assignments")
        .insert(cleaned.map((item) => ({ category_id: categoryId, ...materialLineRow(item) })));
      if (insertError) {
        logSupabaseError(
          "[updateCategoryMaterialAssignments] Supabase insert failed",
          insertError
        );
        return { error: "Could not save the material list. Please try again." };
      }
    }

    const { directFields, total } = materialTotals(materialDirect, cleaned);
    const { error: updateError } = await supabase
      .from("estimate_categories")
      .update({ ...directFields, category_material_estimate: total })
      .eq("id", categoryId);
    if (updateError) {
      logSupabaseError(
        "[updateCategoryMaterialAssignments] Supabase update failed",
        updateError
      );
      return { error: "Could not save the material list. Please try again." };
    }

    await recordGanttCheckpoint(supabase, projectId, profile.id);
    revalidateProjectPaths(projectId);
    return { success: true };
  });
}
