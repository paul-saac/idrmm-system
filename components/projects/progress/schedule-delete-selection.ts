import type { CostCategory } from "@/lib/cost-estimate/data";

/** Deleting every child also deletes its selected, now-empty work heading. */
export function scheduleDeleteSelection(categories: CostCategory[], selected: ReadonlySet<string>) {
  const taskIds: number[] = [], categoryIds: number[] = [];
  for (const category of categories) {
    if (category.id <= 0) continue;
    const children = category.tasks;
    const selectedChildren = children.filter(task => task.id > 0 && selected.has(String(task.id)));
    const wholeGroup = children.length > 0 && selectedChildren.length === children.length;
    if (selected.has(`phase-${category.id}`) || wholeGroup) categoryIds.push(category.id);
    taskIds.push(...selectedChildren.map(task => task.id));
  }
  return { taskIds, categoryIds };
}
