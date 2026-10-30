import type { CostCategory } from "./data";

export type ScheduleRow = { kind: "category" | "task"; id: number };
export type SuccessorOption = ScheduleRow & { name: string };
export function scheduleRowKey(row: ScheduleRow): string { return `${row.kind}:${row.id}`; }

export function projectSuccessorOptions(categories: CostCategory[], source: ScheduleRow, milestone: boolean): SuccessorOption[] {
  const parent = categories.find(category => category.tasks.some(task => source.kind === "task" && task.id === source.id));
  return categories.flatMap<SuccessorOption>(category => [
    ...(milestone || (source.kind === "category" && category.tasks.length === 0)
      ? [{ kind: "category" as const, id: category.id, name: category.name }] : []),
    ...(milestone || (source.kind === "task" && category.id === parent?.id)
      ? category.tasks.map(task => ({ kind: "task" as const, id: task.id, name: milestone ? `${category.name} / ${task.name}` : task.name })) : []),
  ]).filter(row => row.id > 0 && !(row.kind === source.kind && row.id === source.id));
}

export function currentProjectSuccessor(categories: CostCategory[], source: ScheduleRow): string {
  for (const category of categories) {
    if ((source.kind === "category" ? category.predecessorCategoryId : category.predecessorTaskId) === source.id) {
      return scheduleRowKey({ kind: "category", id: category.id });
    }
    for (const task of category.tasks) {
      if ((source.kind === "task" ? task.predecessorTaskId : task.predecessorCategoryId) === source.id) {
        return scheduleRowKey({ kind: "task", id: task.id });
      }
    }
  }
  return "";
}
