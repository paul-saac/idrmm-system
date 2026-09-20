import { createClient } from "@/lib/supabase/server";

export type OtherCostItem = {
  id: number;
  costName: string;
  amount: number;
};

export type TaskPriority = "low" | "medium" | "high";

/** Materials planned for a task ahead of time, from the Gantt Chart
 * Schedule's own task form (see 0035_estimate_task_priority_and_
 * assignments.sql) — distinct from daily_log_material_usage_items /
 * daily_log_material_procurement_items, which record what was actually
 * used/procured after the fact. Free-text material name/spec, same
 * reasoning as daily_log_material_procurement_items: the material may
 * not exist in the project's material catalog yet at planning time. */
export type TaskMaterialAssignment = {
  id: number;
  materialName: string;
  specification: string | null;
  plannedQuantity: number;
  unit: string | null;
};

/** Manpower planned for a task ahead of time — same relationship to
 * daily_log_labor_items as TaskMaterialAssignment has to the material
 * tables above. */
export type TaskLaborAssignment = {
  id: number;
  workerRole: string;
  plannedWorkerCount: number;
};

export type CostTask = {
  id: number;
  categoryId: number;
  name: string;
  estimatedQuantity: number;
  unit: string | null;
  laborEstimate: number;
  materialEstimate: number;
  equipmentEstimate: number;
  otherCostEstimate: number;
  otherCostItems: OtherCostItem[];
  totalEstimateCost: number;
  weight: number;
  /** The task's baseline schedule — null on any task nobody's dated yet
   * (nothing requires these; see 0027_estimate_task_schedule.sql). Used
   * by the Gantt Chart view and by Planned Value in the delay-risk/
   * forecasting calculation. */
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  /** The task this one starts after (Finish-to-Start; see
   * 0029_estimate_task_predecessor.sql) — draws as a dependency arrow
   * in the Gantt Chart. Null means no predecessor set. */
  predecessorTaskId: number | null;
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
  /** 0-100, directly user-editable from the Gantt Chart's own task list
   * (see 0039_estimate_task_percent_complete.sql) — deliberately
   * independent of lib/progress/data.ts's own ProjectProgress (still
   * derived from approved Daily Log work items, for the separate
   * Progress Overview tab), per an explicit request to keep the Gantt
   * Chart's own progress tracking self-contained. A phase's own percent
   * complete is never stored — always a plain average of its tasks'
   * own percentComplete, computed in gantt-chart-view.tsx itself. */
  percentComplete: number;
  materialAssignments: TaskMaterialAssignment[];
  laborAssignments: TaskLaborAssignment[];
};

export type CostCategory = {
  id: number;
  name: string;
  weight: number;
  tasks: CostTask[];
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
};

export type CostEstimate = {
  categories: CostCategory[];
  summary: CostEstimateSummary;
};

/**
 * Fetches the full Category -> Task Item -> Other Cost Item breakdown
 * for a project. Categories, tasks, and other-cost-items are all
 * separate top-level resources (no single FK chain PostgREST could embed
 * through in one call), so all three are fetched in parallel and grouped
 * in JS.
 */
export async function getCostEstimate(projectId: number): Promise<CostEstimate> {
  const supabase = await createClient();

  const [{ data: categoryRows }, { data: taskRows }] = await Promise.all([
    supabase
      .from("estimate_categories")
      .select("id, category_name, weight")
      .eq("project_id", projectId)
      .order("id", { ascending: true }),
    supabase
      .from("estimate_tasks")
      .select("*")
      .eq("project_id", projectId)
      .order("id", { ascending: true }),
  ]);

  const taskIds = (taskRows ?? []).map((row) => row.id);
  const [
    { data: otherCostRows, error: otherCostError },
    { data: materialAssignmentRows },
    { data: laborAssignmentRows },
  ] = await Promise.all([
    taskIds.length > 0
      ? supabase
          .from("estimate_task_other_costs")
          .select("id, task_id, cost_name, amount")
          .in("task_id", taskIds)
          .order("id", { ascending: true })
      : Promise.resolve({ data: [] as never[], error: null }),
    taskIds.length > 0
      ? supabase
          .from("estimate_task_material_assignments")
          .select("id, task_id, material_name, specification, planned_quantity, unit")
          .in("task_id", taskIds)
          .order("id", { ascending: true })
      : Promise.resolve({ data: [] as never[] }),
    taskIds.length > 0
      ? supabase
          .from("estimate_task_labor_assignments")
          .select("id, task_id, worker_role, planned_worker_count")
          .in("task_id", taskIds)
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
  for (const row of otherCostRows ?? []) {
    const item: OtherCostItem = {
      id: row.id,
      costName: row.cost_name,
      amount: row.amount ?? 0,
    };
    const existing = otherCostsByTask.get(row.task_id) ?? [];
    existing.push(item);
    otherCostsByTask.set(row.task_id, existing);
  }

  const materialAssignmentsByTask = new Map<number, TaskMaterialAssignment[]>();
  for (const row of materialAssignmentRows ?? []) {
    const item: TaskMaterialAssignment = {
      id: row.id,
      materialName: row.material_name,
      specification: row.specification,
      plannedQuantity: row.planned_quantity ?? 0,
      unit: row.unit,
    };
    const existing = materialAssignmentsByTask.get(row.task_id) ?? [];
    existing.push(item);
    materialAssignmentsByTask.set(row.task_id, existing);
  }

  const laborAssignmentsByTask = new Map<number, TaskLaborAssignment[]>();
  for (const row of laborAssignmentRows ?? []) {
    const item: TaskLaborAssignment = {
      id: row.id,
      workerRole: row.worker_role,
      plannedWorkerCount: row.planned_worker_count ?? 0,
    };
    const existing = laborAssignmentsByTask.get(row.task_id) ?? [];
    existing.push(item);
    laborAssignmentsByTask.set(row.task_id, existing);
  }

  const VALID_PRIORITIES: TaskPriority[] = ["low", "medium", "high"];
  function toTaskPriority(value: string | null): TaskPriority {
    return VALID_PRIORITIES.includes(value as TaskPriority)
      ? (value as TaskPriority)
      : "medium";
  }

  const tasksByCategory = new Map<number, CostTask[]>();
  const totalsByColumn = { labor: 0, material: 0, equipment: 0, other: 0 };

  for (const row of taskRows ?? []) {
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
      equipmentEstimate: row.equipment_estimate ?? 0,
      otherCostEstimate: row.other_cost_estimate ?? 0,
      otherCostItems: otherCostsByTask.get(row.id) ?? [],
      totalEstimateCost: row.total_estimate_cost ?? 0,
      weight: row.weight ?? 0,
      plannedStartDate: row.planned_start_date,
      plannedEndDate: row.planned_end_date,
      predecessorTaskId: row.predecessor_task_id,
      isMilestone: row.is_milestone ?? false,
      priority: toTaskPriority(row.priority),
      percentComplete: Math.min(100, Math.max(0, row.percent_complete ?? 0)),
      materialAssignments: materialAssignmentsByTask.get(row.id) ?? [],
      laborAssignments: laborAssignmentsByTask.get(row.id) ?? [],
    };
    const existing = tasksByCategory.get(row.category_id) ?? [];
    existing.push(task);
    tasksByCategory.set(row.category_id, existing);

    totalsByColumn.labor += task.laborEstimate;
    totalsByColumn.material += task.materialEstimate;
    totalsByColumn.equipment += task.equipmentEstimate;
    totalsByColumn.other += task.otherCostEstimate;
  }

  const categories: CostCategory[] = (categoryRows ?? []).map((row) => ({
    id: row.id,
    name: row.category_name,
    weight: row.weight ?? 0,
    tasks: tasksByCategory.get(row.id) ?? [],
  }));

  const taskCount = taskRows?.length ?? 0;
  const totalEstimatedCost = (taskRows ?? []).reduce(
    (sum, row) => sum + (row.total_estimate_cost ?? 0),
    0
  );

  return {
    categories,
    summary: {
      totalEstimatedCost,
      categoryCount: categories.length,
      taskCount,
      totalsByColumn,
    },
  };
}
