import { createClient } from "@/lib/supabase/server";
import { listTaskProgressAnchors } from "@/lib/task-progress/data";
import { listCategoryProgressAnchors } from "@/lib/category-progress/data";
import { computeWeights } from "@/lib/cost-estimate/weights";
import { projectLifecycle, type ProjectLifecycle } from "@/lib/projects/lifecycle";
import {
  computeProgressBreakdown,
  EMPTY_PROGRESS_ANCHOR,
  groupPlannedMaterials,
  ZERO_COSTS,
  type CostAmounts,
} from "@/lib/task-progress/calculate";

export type OtherCostItem = {
  id: number;
  costName: string;
  amount: number;
  quantity?: number;
  unit?: string | null;
  unitCost?: number;
  amountOverride?: number | null;
};

export type TaskPriority = "low" | "medium" | "high";

/** Materials planned in the Gantt task form. Actual usage and purchases
 * are recorded separately through progress entries and material purchases. */
export type TaskMaterialAssignment = {
  id: number;
  materialName: string;
  specification: string | null;
  plannedQuantity: number;
  unit: string | null;
  /** $/unit rate — this line's own Amount (Material Breakdown modal) is
   * plannedQuantity * unitCost. See 0041_material_line_costs.sql. */
  unitCost: number;
  /** Null means "compute plannedQuantity * unitCost as normal"; a
   * non-null value means Amount was typed directly on this line (no
   * clean quantity/unit cost breakdown). See
   * 0043_amount_overrides.sql's own comment. */
  amountOverride: number | null;
};

export type CostTask = {
  id: number;
  categoryId: number;
  name: string;
  estimatedQuantity: number;
  unit: string | null;
  laborEstimate: number;
  /** Stored, not computed at read time — kept in sync by
   * updateTaskMaterialAssignments (lib/cost-estimate/actions.ts)
   * whenever the Material Breakdown modal saves: (materialDirectQuantity
   * * materialUnitCost) + the sum of every materialAssignments line's
   * own (plannedQuantity * unitCost). See 0041_material_line_costs.sql. */
  materialEstimate: number;
  /** This task's own direct BOM line — a lump-sum task with no material
   * breakdown underneath it (e.g. "Mobilization") gets its Amount from
   * here instead. Deliberately separate from estimatedQuantity/unit
   * above — see 0041_material_line_costs.sql's own comment for why. */
  materialDirectQuantity: number;
  materialDirectUnit: string | null;
  materialUnitCost: number;
  /** Null means "compute materialDirectQuantity * materialUnitCost as
   * normal"; a non-null value means this task's own Amount was typed
   * directly (no clean quantity/unit cost breakdown). See
   * 0043_amount_overrides.sql's own comment. */
  materialDirectAmountOverride: number | null;
  equipmentEstimate: number;
  otherCostEstimate: number;
  otherCostItems: OtherCostItem[];
  equipmentCostItems?: OtherCostItem[];
  totalEstimateCost: number;
  /** This task's share of the project, in percent — its share of the
   * total estimated cost. See lib/cost-estimate/weights.ts. */
  weight: number;
  /** The task's baseline schedule — null on any task nobody's dated yet
   * (nothing requires these; see 0027_estimate_task_schedule.sql). Used
   * by the Gantt Chart and schedule-based Expected progress. */
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  /** The task this one starts after (Finish-to-Start; see
   * 0029_estimate_task_predecessor.sql) — draws as a dependency arrow
   * in the Gantt Chart. Null means no predecessor set. */
  predecessorTaskId: number | null;
  predecessorCategoryId?: number | null;
  /** Manually flagged by the admin (see
   * 0030_estimate_task_milestone.sql) — a real point-in-time event
   * ("Permit Approved", "Client Sign-off") rather than a task with
   * duration. Renders as a diamond instead of a bar in the Gantt Chart;
   * still an ordinary task otherwise (its own cost/category/
   * predecessor), not a separate concept. */
  isMilestone: boolean;
  /** Scheduling priority (see 0035_estimate_task_priority_and_
   * assignments.sql) — deliberately separate from `weight` above, which
   * is a cost-distribution % used throughout the EVM/progress
   * calculations, not a priority level. */
  priority: TaskPriority;
  /** Actual completion from saved progress, separate from schedule-based expectations. */
  percentComplete: number;
  /** Recorded spend per cost column from saved Daily Progress Updates only. */
  costsToDate: CostAmounts;
  materialAssignments: TaskMaterialAssignment[];
};

export type CostCategory = {
  id: number;
  name: string;
  /** Same as CostTask's own weight: the sum of its tasks' weights while
   * it has any, else its own. See lib/cost-estimate/weights.ts. */
  weight: number;
  tasks: CostTask[];
  /** A category's own direct BOM line — for a category with no tasks
   * yet, or a category-level lump sum — same reasoning as CostTask's own
   * materialDirectQuantity/materialDirectUnit/materialUnitCost, one
   * level up. See 0042_category_direct_cost.sql's own comment. */
  materialDirectQuantity: number;
  materialDirectUnit: string | null;
  materialUnitCost: number;
  /** Null means "compute materialDirectQuantity * materialUnitCost as
   * normal"; a non-null value means this category's own Amount was
   * typed directly (no clean quantity/unit cost breakdown). See
   * 0043_amount_overrides.sql's own comment. */
  materialDirectAmountOverride: number | null;
  /** Stored — this category's own direct line (materialDirectQuantity *
   * materialUnitCost, or materialDirectAmountOverride if set) plus its
   * own itemized materialAssignments, kept in sync by
   * updateCategoryMaterialAssignments (lib/cost-estimate/actions.ts).
   * Already folded into this CostEstimate's own
   * summary.totalsByColumn.material/totalEstimatedCost below. */
  categoryMaterialEstimate: number;
  /** A standalone category's own itemized materials — the same lines a
   * task carries, one level up (Material Breakdown's Add Material on a
   * main task with no subtasks). See 0058_category_material_lines.sql. */
  materialAssignments: TaskMaterialAssignment[];
  /** This category's own planned schedule — only meaningful (and only
   * ever shown/editable in the Gantt Chart) while it has no tasks yet;
   * once it does, its start/end is a rollup of theirs instead. See
   * 0044_category_schedule.sql's own comment. */
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  /** Always directly set, never a rollup of its tasks' own priorities
   * (unlike Start/End) — see 0046_category_priority.sql's own comment. */
  priority: TaskPriority;
  /** A task-less category marked as a milestone — a single-date diamond
   * on the Gantt chart, like a task's own isMilestone. Ignored once it
   * has tasks. See 0072_estimate_category_milestone.sql. */
  isMilestone: boolean;
  predecessorCategoryId?: number | null;
  predecessorTaskId?: number | null;
  /** This category's own direct labor cost — same "only meaningful
   * while it has no tasks yet" rule as plannedStartDate/plannedEndDate
   * above, one level up from CostTask's own laborEstimate. See
   * 0047_category_labor_estimate.sql's own comment. */
  categoryLaborEstimate: number;
  /** This category's own direct Equipment / Other cost — the same two
   * components a task has, one level up. See
   * 0056_category_equipment_other.sql. */
  categoryEquipmentEstimate: number;
  categoryOtherEstimate: number;
  otherCostItems?: OtherCostItem[];
  equipmentCostItems?: OtherCostItem[];
  /** This category's own tracked quantity/unit — same "only meaningful
   * while it has no tasks yet" rule as categoryLaborEstimate above, one
   * level up from CostTask's own estimatedQuantity/unit. See
   * 0048_category_progress_tracking.sql's own comment. */
  estimatedQuantity: number;
  unit: string | null;
  /** Same idea as CostTask's own percentComplete, one level up — live-
   * computed (Automatic Progress Completion, anchored by this category's
   * own latest Progress Tracking Override if one exists), only ever
   * meaningful while this category has no tasks yet; once it does, its
   * own percent complete is a rollup of theirs instead, same asymmetric
   * rule Start/End/Labor Percentage already use (see
   * percentCompleteByCategoryId's own doc comment in
   * gantt-chart-view.tsx). */
  percentComplete: number;
  /** Same as CostTask's own costsToDate, from this category's own Daily
   * Progress Updates — only meaningful while it has no tasks, like
   * percentComplete above; one with tasks spends through them. */
  costsToDate: CostAmounts;
};

export type CostEstimateSummary = {
  totalEstimatedCost: number;
  categoryCount: number;
  taskCount: number;
  /** Sum across every task, per cost column — powers the footer row. */
  totalsByColumn: {
    labor: number;
    material: number;
    equipment: number;
    other: number;
  };
  /** What's been spent so far, per cost column, from the Daily Progress
   * Updates — every task's cost to date, and every task-less phase's own:
   * its saved updates only (computeProgressBreakdown). The Overview's Actual
   * Expense. */
  costsToDate: CostAmounts;
};

export type CostEstimate = {
  categories: CostCategory[];
  summary: CostEstimateSummary;
  lifecycle: ProjectLifecycle;
};

/**
 * Fetches the full Category -> Task Item -> Other Cost Item breakdown
 * for a project. Categories, tasks, and other-cost-items are all
 * separate top-level resources (no single FK chain PostgREST could embed
 * through in one call), so all three are fetched in parallel and grouped
 * in JS.
 */
export async function getCostEstimate(projectId: number, strict = false): Promise<CostEstimate> {
  const supabase = await createClient();

  const [{ data: categoryRows, error: categoryError }, { data: taskRows, error: taskError }, { data: projectRow, error: projectError }] =
    await Promise.all([
      // "*" rather than a column list, so a DB that hasn't run
      // 0056_category_equipment_other.sql yet still loads (those two
      // costs just read as 0).
      supabase
        .from("estimate_categories")
        .select("*")
        .eq("project_id", projectId)
        .order("id", { ascending: true }),
      supabase
        .from("estimate_tasks")
        .select("*")
        .eq("project_id", projectId)
        .order("id", { ascending: true }),
      // "*" rather than naming holidays, so a DB that hasn't run
      // 0053_project_holidays.sql yet still reads its working days
      // instead of failing the whole query.
      supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .maybeSingle(),
    ]);

  if (strict && (categoryError || taskError || projectError || !projectRow)) {
    throw new Error("Could not verify the project's tasks and progress. Please try again.");
  }

  // Read from select("*") so older databases can still show their existing
  // ID order until 0107 is installed. New rows with no order append last.
  const bySavedOrder = (a: { id: number; sort_order?: number | null }, b: { id: number; sort_order?: number | null }) =>
    (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity) || a.id - b.id;
  categoryRows?.sort(bySavedOrder);
  taskRows?.sort(bySavedOrder);

  // Falls back to the same Mon-Sat default the DB column itself defaults
  // to — projectRow can come back null only if the project row itself
  // somehow doesn't exist, in which case there's nothing to compute
  // progress for anyway.
  const workingDays: readonly number[] = projectRow?.working_days ?? [
    1, 2, 3, 4, 5, 6,
  ];
  const holidays: readonly string[] = projectRow?.holidays ?? [];

  const taskIds = (taskRows ?? []).map((row) => row.id);
  const categoryIds = (categoryRows ?? []).map((row) => row.id);
  const [
    { data: otherCostRows, error: otherCostError },
    { data: materialAssignmentRows },
    progressAnchorsByTask,
    progressAnchorsByCategory,
    { data: categoryMaterialRows },
  ] = await Promise.all([
    taskIds.length > 0 || categoryIds.length > 0
      ? supabase
          .from("estimate_task_other_costs")
          .select("*")
          .or(`task_id.in.(${taskIds.join(",") || -1}),category_id.in.(${categoryIds.join(",") || -1})`)
          .order("id", { ascending: true })
      : Promise.resolve({ data: [] as never[], error: null }),
    taskIds.length > 0
      ? supabase
          .from("estimate_task_material_assignments")
          .select(
            "id, task_id, material_name, specification, planned_quantity, unit, unit_cost, amount"
          )
          .in("task_id", taskIds)
          .order("id", { ascending: true })
      : Promise.resolve({ data: [] as never[] }),
    // Every task's own Progress Tracking Override anchor (see
    // lib/task-progress/data.ts) — what computeProgressBreakdown below
    // projects each task's live percentComplete and cost to date
    // forward from.
    listTaskProgressAnchors(taskIds, strict),
    // Same idea, one level up, for a task-less category's own Progress
    // Tracking Override — see lib/category-progress/data.ts.
    listCategoryProgressAnchors(categoryIds, strict),
    // A standalone category's own itemized materials (0058) — empty, not
    // an error, until that migration has run.
    categoryIds.length > 0
      ? supabase
          .from("estimate_category_material_assignments")
          .select(
            "id, category_id, material_name, specification, planned_quantity, unit, unit_cost, amount"
          )
          .in("category_id", categoryIds)
          .order("id", { ascending: true })
      : Promise.resolve({ data: [] as never[] }),
  ]);

  if (otherCostError) {
    // Was previously swallowed — every task would silently render as
    // having zero other costs (no chevron) with no indication why,
    // which is exactly what a missing/misnamed table or an RLS denial
    // looks like from the UI. Logging it doesn't fix the underlying
    // cause, but it stops that cause from being invisible.
    //
    // Logged as explicit fields, not the raw PostgrestError object —
    // Next's dev console-error overlay renders that object as "{}" (its
    // message/code/details/hint live on the instance in a way the
    // overlay's inspector doesn't expand), so the object alone hides
    // exactly the info needed to diagnose this.
    console.error("[getCostEstimate] estimate_task_other_costs fetch failed", {
      message: otherCostError.message,
      code: otherCostError.code,
      details: otherCostError.details,
      hint: otherCostError.hint,
    });
  }

  const otherCostsByTask = new Map<number, OtherCostItem[]>();
  const otherCostsByCategory = new Map<number, OtherCostItem[]>();
  for (const row of otherCostRows ?? []) {
    const item: OtherCostItem = {
      id: row.id,
      costName: row.cost_name,
      amount: row.amount ?? 0,
      quantity: row.quantity ?? 1,
      unit: row.unit,
      unitCost: row.unit_cost ?? row.amount ?? 0,
      amountOverride: row.amount_override,
    };
    const ownerId = row.task_id ?? row.category_id;
    if (ownerId == null) continue;
    const target = row.task_id == null ? otherCostsByCategory : otherCostsByTask;
    const existing = target.get(ownerId) ?? [];
    existing.push(item);
    target.set(ownerId, existing);
  }

  function toMaterialAssignment(row: {
    id: number;
    material_name: string;
    specification: string | null;
    planned_quantity: number | null;
    unit: string | null;
    unit_cost: number | null;
    amount: number | null;
  }): TaskMaterialAssignment {
    return {
      id: row.id,
      materialName: row.material_name,
      specification: row.specification,
      plannedQuantity: row.planned_quantity ?? 0,
      unit: row.unit,
      unitCost: row.unit_cost ?? 0,
      amountOverride: row.amount,
    };
  }

  const materialAssignmentsByTask = new Map<number, TaskMaterialAssignment[]>();
  for (const row of materialAssignmentRows ?? []) {
    const existing = materialAssignmentsByTask.get(row.task_id) ?? [];
    existing.push(toMaterialAssignment(row));
    materialAssignmentsByTask.set(row.task_id, existing);
  }

  const materialAssignmentsByCategory = new Map<number, TaskMaterialAssignment[]>();
  for (const row of categoryMaterialRows ?? []) {
    const existing = materialAssignmentsByCategory.get(row.category_id) ?? [];
    existing.push(toMaterialAssignment(row));
    materialAssignmentsByCategory.set(row.category_id, existing);
  }

  const VALID_PRIORITIES: TaskPriority[] = ["low", "medium", "high"];
  function toTaskPriority(value: string | null): TaskPriority {
    return VALID_PRIORITIES.includes(value as TaskPriority)
      ? (value as TaskPriority)
      : "medium";
  }

  const tasksByCategory = new Map<number, CostTask[]>();
  const totalsByColumn = { labor: 0, material: 0, equipment: 0, other: 0 };
  // Spend to date, added up below — see CostEstimateSummary.costsToDate.
  const costsToDate: CostAmounts = { ...ZERO_COSTS };
  function addCosts(costs: CostAmounts) {
    costsToDate.labor += costs.labor;
    costsToDate.material += costs.material;
    costsToDate.equipment += costs.equipment;
    costsToDate.other += costs.other;
  }

  for (const row of taskRows ?? []) {
    // Where the task stands today from its Daily Progress Updates — its
    // percent complete, and its cost to date toward the project's.
    const progress = computeProgressBreakdown({
      plannedStartDate: row.planned_start_date,
      plannedEndDate: row.planned_end_date,
      estimatedQuantity: row.estimated_quantity ?? 0,
      plannedMaterials: groupPlannedMaterials(materialAssignmentsByTask.get(row.id) ?? []),
      plannedCosts: {
        labor: row.labor_estimate ?? 0,
        material: row.material_estimate ?? 0,
        equipment: row.equipment_estimate ?? 0,
        other: row.other_cost_estimate ?? 0,
      },
      workingDays,
      holidays,
      anchor: progressAnchorsByTask[row.id] ?? EMPTY_PROGRESS_ANCHOR,
      today: new Date(),
    });
    addCosts(progress.costsToDate);
    // Coalesce every numeric column to 0: the hand-built tables may not
    // actually enforce `not null default 0` at the DB level (a column
    // that already existed before a migration keeps its original
    // nullable definition — `add column if not exists` is a no-op for
    // it), so a freshly-inserted row can genuinely come back with nulls
    // here. Normalizing at this one boundary keeps every consumer
    // downstream able to trust the `number` types without re-checking.
    const task: CostTask = {
      id: row.id,
      categoryId: row.category_id,
      name: row.task_name,
      estimatedQuantity: row.estimated_quantity ?? 0,
      unit: row.unit,
      laborEstimate: row.labor_estimate ?? 0,
      materialEstimate: row.material_estimate ?? 0,
      materialDirectQuantity: row.material_direct_quantity ?? 0,
      materialDirectUnit: row.material_direct_unit,
      materialUnitCost: row.material_unit_cost ?? 0,
      materialDirectAmountOverride: row.material_direct_amount,
      equipmentEstimate: row.equipment_estimate ?? 0,
      otherCostEstimate: row.other_cost_estimate ?? 0,
      otherCostItems: otherCostsByTask.get(row.id) ?? [],
      equipmentCostItems: row.equipment_cost_items ?? [],
      totalEstimateCost: row.total_estimate_cost ?? 0,
      // Filled in below by computeWeights, once every cost is known.
      weight: 0,
      plannedStartDate: row.planned_start_date,
      plannedEndDate: row.planned_end_date,
      predecessorTaskId: row.predecessor_task_id,
      predecessorCategoryId: row.predecessor_category_id ?? null,
      isMilestone: row.is_milestone ?? false,
      priority: toTaskPriority(row.priority),
      // Computed from saved progress entries (see lib/task-progress/
      // calculate.ts), never elapsed time or the stored percent_complete
      // column, which this feature supersedes as the actual source of a
      // task's own percent complete (see 0040_task_progress_tracking.
      // sql's own comment on why that column is left in place but no
      // longer read/written).
      percentComplete: progress.percentComplete,
      costsToDate: progress.costsToDate,
      materialAssignments: materialAssignmentsByTask.get(row.id) ?? [],
    };
    const existing = tasksByCategory.get(row.category_id) ?? [];
    existing.push(task);
    tasksByCategory.set(row.category_id, existing);

    totalsByColumn.labor += task.laborEstimate;
    totalsByColumn.material += task.materialEstimate;
    totalsByColumn.equipment += task.equipmentEstimate;
    totalsByColumn.other += task.otherCostEstimate;
  }

  const categories: CostCategory[] = (categoryRows ?? []).map((row) => {
    const tasks = tasksByCategory.get(row.id) ?? [];
    const progress = computeProgressBreakdown({
      plannedStartDate: row.planned_start_date,
      plannedEndDate: row.planned_end_date,
      estimatedQuantity: row.estimated_quantity ?? 0,
      // A task-less category's own Material Breakdown lines (what its
      // progress form logs materials used against); its planned costs
      // are its own (material: its direct line plus its itemized lines).
      plannedMaterials: groupPlannedMaterials(materialAssignmentsByCategory.get(row.id) ?? []),
      plannedCosts: {
        labor: row.category_labor_estimate ?? 0,
        material: row.category_material_estimate ?? 0,
        equipment: row.category_equipment_estimate ?? 0,
        other: row.category_other_estimate ?? 0,
      },
      workingDays,
      holidays,
      anchor: progressAnchorsByCategory[row.id] ?? EMPTY_PROGRESS_ANCHOR,
      today: new Date(),
    });
    // A phase with tasks spends through them — its own updates count only
    // while it has none, the same as its own percent complete.
    if (tasks.length === 0) addCosts(progress.costsToDate);
    return {
      id: row.id,
      name: row.category_name,
      weight: 0,
      tasks,
      materialDirectQuantity: row.material_direct_quantity ?? 0,
      materialDirectUnit: row.material_direct_unit,
      materialUnitCost: row.material_unit_cost ?? 0,
      materialDirectAmountOverride: row.material_direct_amount,
      categoryMaterialEstimate: row.category_material_estimate ?? 0,
      materialAssignments: materialAssignmentsByCategory.get(row.id) ?? [],
      plannedStartDate: row.planned_start_date,
      plannedEndDate: row.planned_end_date,
      priority: toTaskPriority(row.priority),
      // Undefined until 0072 has run — then just not a milestone.
      isMilestone: row.is_milestone ?? false,
      predecessorCategoryId: row.predecessor_category_id ?? null,
      predecessorTaskId: row.predecessor_task_id ?? null,
      categoryLaborEstimate: row.category_labor_estimate ?? 0,
      categoryEquipmentEstimate: row.category_equipment_estimate ?? 0,
      categoryOtherEstimate: row.category_other_estimate ?? 0,
      otherCostItems: otherCostsByCategory.get(row.id) ?? [],
      equipmentCostItems: row.equipment_cost_items ?? [],
      estimatedQuantity: row.estimated_quantity ?? 0,
      unit: row.unit,
      percentComplete: progress.percentComplete,
      costsToDate: progress.costsToDate,
    };
  });

  const { taskWeights, categoryWeights } = computeWeights(categories);
  for (const category of categories) {
    category.weight = categoryWeights.get(category.id) ?? 0;
    for (const task of category.tasks) {
      task.weight = taskWeights.get(task.id) ?? 0;
    }
  }

  const categoryMaterialTotal = categories.reduce(
    (sum, c) => sum + c.categoryMaterialEstimate,
    0
  );
  totalsByColumn.material += categoryMaterialTotal;
  const categoryLaborTotal = categories.reduce(
    (sum, c) => sum + c.categoryLaborEstimate,
    0
  );
  totalsByColumn.labor += categoryLaborTotal;
  const categoryEquipmentTotal = categories.reduce(
    (sum, c) => sum + c.categoryEquipmentEstimate,
    0
  );
  totalsByColumn.equipment += categoryEquipmentTotal;
  const categoryOtherTotal = categories.reduce(
    (sum, c) => sum + c.categoryOtherEstimate,
    0
  );
  totalsByColumn.other += categoryOtherTotal;

  const taskCount = taskRows?.length ?? 0;
  const totalEstimatedCost =
    (taskRows ?? []).reduce(
      (sum, row) => sum + (row.total_estimate_cost ?? 0),
      0
    ) +
    categoryMaterialTotal +
    categoryLaborTotal +
    categoryEquipmentTotal +
    categoryOtherTotal;

  return {
    categories,
    lifecycle: projectLifecycle(categories, progressAnchorsByTask, progressAnchorsByCategory),
    summary: {
      totalEstimatedCost,
      categoryCount: categories.length,
      taskCount,
      totalsByColumn,
      costsToDate,
    },
  };
}
