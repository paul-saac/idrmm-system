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

/** Rolls saved task completion into the project total using estimate weights.
 * Standalone phases contribute directly; phases with tasks roll up their children.
 * Expected schedule progress is calculated separately and never counts as work. */
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
