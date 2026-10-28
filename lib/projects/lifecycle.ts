import type { ProgressAnchor } from "../task-progress/calculate";

export type ProjectLifecycle = {
  hasRecordedWork: boolean;
  allItemsComplete: boolean;
  itemCount: number;
};

type Item = { id: number; percentComplete: number };
type Category = Item & { tasks: Item[] };

function hasWork(anchor: ProgressAnchor | undefined): boolean {
  if (!anchor) return false;
  return anchor.cumulativeQuantityCompleted > 0 || [
    ...Object.values(anchor.cumulativeCosts),
    ...Object.values(anchor.cumulativeMaterialUsage),
    ...Object.values(anchor.cumulativeEquipmentCostSpend ?? {}),
    ...Object.values(anchor.cumulativeOtherCostSpend ?? {}),
  ].some((value) => value > 0);
}

/** Check each leaf independently, including zero-weight tasks and standalone phases. */
export function projectLifecycle(
  categories: Category[],
  taskAnchors: Record<number, ProgressAnchor>,
  categoryAnchors: Record<number, ProgressAnchor>,
): ProjectLifecycle {
  const items = categories.flatMap((category) => category.tasks.length
    ? category.tasks.map((task) => ({ item: task, anchor: taskAnchors[task.id] }))
    : [{ item: category, anchor: categoryAnchors[category.id] }]);
  return {
    itemCount: items.length,
    hasRecordedWork: items.some(({ anchor }) => hasWork(anchor)),
    allItemsComplete: items.length > 0 && items.every(({ item, anchor }) =>
      hasWork(anchor) && Number.isFinite(item.percentComplete) && item.percentComplete >= 100),
  };
}
