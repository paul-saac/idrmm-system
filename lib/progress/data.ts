import { createClient } from "@/lib/supabase/server";
import type { CostCategory } from "@/lib/cost-estimate/data";
import { listFlaggedEntryIds } from "@/lib/daily-logs/data";

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

/**
 * Computes each task's current completion % and rolls it up into
 * category and project-wide progress. Takes the Cost Estimate
 * Breakdown's categories/tasks (already fetched by the caller for the
 * Overview tab — no need to re-query estimate_categories/estimate_tasks
 * here) and layers actual progress data on top.
 *
 * A task's percent_complete is the sum of "Quantity Completed" logged
 * against it across every APPROVED daily log's Work Log entries,
 * divided by the task's estimated_quantity from the Cost Estimate
 * Breakdown — e.g. 30 of 50 m² logged across two approved days is 60%.
 * This reads daily_log_work_items (what the Add Daily Log modal's Work
 * Log form actually writes), not the separate daily_log_progress table
 * — that table was part of an earlier progress-tracking design that
 * predates Work Logs and nothing ever wrote to it, so it stayed at 0%
 * forever regardless of approvals. On a project with no approved logs
 * yet this correctly comes back as 0% / not started for every task, not
 * an error.
 *
 * Project-wide % is the weighted sum of every task's percentComplete by
 * its estimate_tasks.weight (already a % of the project total, see
 * lib/cost-estimate/actions.ts). Category % re-normalizes each task's
 * weight against just that category's total weight, so it reads 0-100
 * relative to the category rather than the whole project.
 */
export async function getProjectProgress(
  projectId: number,
  categories: CostCategory[]
): Promise<ProjectProgress> {
  const supabase = await createClient();

  const { data: approvedLogs } = await supabase
    .from("daily_logs")
    .select("id")
    .eq("project_id", projectId)
    .eq("status", "approved");

  const approvedLogIds = (approvedLogs ?? []).map((log) => log.id);

  const [{ data: workItemRows }, flaggedWorkItemIds] = await Promise.all([
    approvedLogIds.length > 0
      ? supabase
          .from("daily_log_work_items")
          .select("id, task_id, quantity_completed")
          .in("daily_log_id", approvedLogIds)
      : Promise.resolve({ data: [] as never[] }),
    listFlaggedEntryIds(supabase, "work_item", approvedLogIds),
  ]);

  // Sum every approved Work Log entry's quantity per task — a task
  // logged on several different days accumulates toward its estimate,
  // it isn't just whichever entry happened most recently. An entry an
  // admin flagged as wrong during review doesn't count, even though its
  // log was still approved as a whole (see lib/daily-logs/actions.ts's
  // flagDailyLogEntry).
  const quantityDoneByTask = new Map<number, number>();
  for (const row of workItemRows ?? []) {
    if (flaggedWorkItemIds.has(row.id)) continue;
    quantityDoneByTask.set(
      row.task_id,
      (quantityDoneByTask.get(row.task_id) ?? 0) + (row.quantity_completed ?? 0)
    );
  }

  let totalTasks = 0;
  let completed = 0;
  let inProgress = 0;
  let notStarted = 0;
  let weightedSum = 0;

  const categoryProgress: CategoryProgress[] = categories.map((category) => {
    const tasks: TaskProgress[] = category.tasks.map((task) => {
      const quantityDone = quantityDoneByTask.get(task.id) ?? 0;
      const percentComplete =
        task.estimatedQuantity > 0
          ? Math.min(
              100,
              Math.round((quantityDone / task.estimatedQuantity) * 10000) / 100
            )
          : 0;
      const status = statusFor(percentComplete);

      totalTasks += 1;
      if (status === "completed") completed += 1;
      else if (status === "in_progress") inProgress += 1;
      else notStarted += 1;
      weightedSum += (percentComplete * task.weight) / 100;

      return {
        id: task.id,
        name: task.name,
        categoryId: task.categoryId,
        weight: task.weight,
        percentComplete,
        status,
      };
    });

    const categoryPercent =
      category.weight > 0
        ? tasks.reduce(
            (sum, task) => sum + (task.percentComplete * task.weight) / category.weight,
            0
          )
        : tasks.length > 0
          ? tasks.reduce((sum, task) => sum + task.percentComplete, 0) / tasks.length
          : 0;

    return {
      id: category.id,
      name: category.name,
      weight: category.weight,
      percentComplete: Math.round(categoryPercent * 100) / 100,
      status: statusFor(categoryPercent),
      tasks,
    };
  });

  return {
    overallPercent: Math.round(weightedSum * 100) / 100,
    totalTasks,
    completed,
    inProgress,
    notStarted,
    categories: categoryProgress,
  };
}
