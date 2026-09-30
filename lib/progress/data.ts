import type { CostCategory } from "@/lib/cost-estimate/data";

export type TaskStatus = "completed" | "in_progress" | "not_started";

export type TaskProgress = {
  id: number;
  name: string;
  categoryId: number;
  weight: number;
  percentComplete: number;
  status: TaskStatus;
};

export type CategoryProgress = {
  id: number;
  name: string;
  weight: number;
  percentComplete: number;
  status: TaskStatus;
  tasks: TaskProgress[];
};

export type ProjectProgress = {
  overallPercent: number;
  totalTasks: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  categories: CategoryProgress[];
};

function statusFor(percent: number): TaskStatus {
  if (percent >= 100) return "completed";
  if (percent > 0) return "in_progress";
  return "not_started";
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Rolls each task/category's own live percentComplete (Automatic
 * Progress Completion — computeAutoPercentComplete, already computed
 * server-side in getCostEstimate for every CostTask/CostCategory, see
 * lib/cost-estimate/data.ts) up into category and project-wide
 * progress: Earned Value Management. A task/category's own contribution
 * to the project's overall percent is its own weight (0-100, PM-
 * assigned effort — see updateTaskWeight's own doc comment, lib/cost-
 * estimate/actions.ts) times its own percentComplete.
 *
 * Deliberately does NOT re-derive percentComplete from daily logs the
 * way this function used to (summing daily_log_work_items' own
 * quantity per task, divided by estimated_quantity) — that was a
 * second, competing definition of "done" that ignored a task's own
 * Progress Tracking Override entirely, per an explicit request to stop
 * computing progress from quantity/daily logs. `categories` already
 * carries the correct, single source of truth for both fields (the
 * same one the Gantt Chart itself reads), so this just reads it back
 * instead of re-querying daily_logs/daily_log_work_items at all.
 *
 * A task-less category (see CostCategory.percentComplete's own doc
 * comment) contributes its own percentComplete/weight directly to the
 * project total — same asymmetric "task-less category gets its own
 * direct value" rule already used everywhere else in this app (its own
 * material line, its own priority, ...). The previous version of this
 * function silently excluded a task-less category from overallPercent
 * entirely (its weightedSum contribution only ever accumulated inside
 * the per-task loop, which a category with zero tasks never runs) — a
 * standalone category's own Progress Tracking Override never moved the
 * project-wide number at all. Fixed here as part of the same rollup
 * work, not a separate change.
 *
 * A category's own effective weight is the live sum of its tasks' own
 * weights while it has any — never its own stored estimate_categories.
 * weight column in that case, since nothing keeps that column in sync
 * anymore now that weight is assigned by hand per task instead of
 * recomputed from cost (see updateCategoryWeight's own doc comment) —
 * or its own stored value while task-less. Same "has tasks -> live
 * rollup, no tasks -> own value" split gantt-chart-view.tsx's own
 * categoryById already uses for the identical cell.
 */
export async function getProjectProgress(
  projectId: number,
  categories: CostCategory[]
): Promise<ProjectProgress> {
  let totalTasks = 0;
  let completed = 0;
  let inProgress = 0;
  let notStarted = 0;
  let weightedSum = 0;

  const categoryProgress: CategoryProgress[] = categories.map((category) => {
    if (category.tasks.length === 0) {
      const percentComplete = round2(category.percentComplete);
      weightedSum += (category.percentComplete * category.weight) / 100;
      return {
        id: category.id,
        name: category.name,
        weight: category.weight,
        percentComplete,
        status: statusFor(percentComplete),
        tasks: [],
      };
    }

    const tasks: TaskProgress[] = category.tasks.map((task) => {
      const percentComplete = round2(task.percentComplete);
      const status = statusFor(percentComplete);

      totalTasks += 1;
      if (status === "completed") completed += 1;
      else if (status === "in_progress") inProgress += 1;
      else notStarted += 1;
      weightedSum += (task.percentComplete * task.weight) / 100;

      return {
        id: task.id,
        name: task.name,
        categoryId: task.categoryId,
        weight: task.weight,
        percentComplete,
        status,
      };
    });

    const categoryWeight = tasks.reduce((sum, task) => sum + task.weight, 0);
    const categoryPercent =
      categoryWeight > 0
        ? tasks.reduce(
            (sum, task) =>
              sum + (task.percentComplete * task.weight) / categoryWeight,
            0
          )
        : tasks.reduce((sum, task) => sum + task.percentComplete, 0) /
          tasks.length;

    return {
      id: category.id,
      name: category.name,
      weight: categoryWeight,
      percentComplete: round2(categoryPercent),
      status: statusFor(categoryPercent),
      tasks,
    };
  });

  return {
    overallPercent: round2(weightedSum),
    totalTasks,
    completed,
    inProgress,
    notStarted,
    categories: categoryProgress,
  };
}
