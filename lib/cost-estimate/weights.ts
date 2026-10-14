/**
 * Task weights — each task's share of the project, in percent (all of
 * them together make 100). Pure, no DB access: getCostEstimate
 * (lib/cost-estimate/data.ts) computes every weight with it, and the
 * Weight Breakdown modal reruns it on the same data to show its work.
 *
 * The formula is the DPWH S-curve method, a task's share of the total
 * estimated cost:
 *
 *   weight = task cost / total project cost * 100
 *
 * Never typed by hand — a weight that looks wrong means the task's cost
 * is wrong, so the cost is what gets fixed.
 *
 * What gets a weight is whatever progress is tracked on: every task,
 * and every task-less category (e.g. a standalone "MOBILIZATION" line).
 * A category with tasks is just the sum of its tasks' weights. If that
 * category also carries a direct cost line of its own, that cost is
 * shared among its tasks by their cost, so the category's weight still
 * equals its Total Estimated Cost's share of the project.
 */

/** The fields weights are computed from — a CostCategory fits as-is. */
export type WeightSourceCategory = {
  id: number;
  /** The category's own direct lines (not its tasks'). */
  categoryMaterialEstimate: number;
  categoryLaborEstimate: number;
  categoryEquipmentEstimate: number;
  categoryOtherEstimate: number;
  tasks: { id: number; totalEstimateCost: number }[];
};

export type ComputedWeights = {
  projectCost: number;
  taskWeights: Map<number, number>;
  categoryWeights: Map<number, number>;
  /** Each task's cost as weighed: its own total plus its share of its
   * category's own direct cost, if the category has one. */
  taskCosts: Map<number, number>;
  categoryCosts: Map<number, number>;
};

export function categoryDirectCost(category: WeightSourceCategory): number {
  return Math.max(
    0,
    category.categoryMaterialEstimate +
      category.categoryLaborEstimate +
      category.categoryEquipmentEstimate +
      category.categoryOtherEstimate
  );
}

export function computeWeights(categories: WeightSourceCategory[]): ComputedWeights {
  const taskCosts = new Map<number, number>();
  const categoryCosts = new Map<number, number>();

  for (const category of categories) {
    const directCost = categoryDirectCost(category);
    const ownTotal = category.tasks.reduce(
      (sum, t) => sum + Math.max(0, t.totalEstimateCost),
      0
    );
    for (const task of category.tasks) {
      const own = Math.max(0, task.totalEstimateCost);
      const shareOfDirect =
        ownTotal > 0 ? (directCost * own) / ownTotal : directCost / category.tasks.length;
      taskCosts.set(task.id, own + shareOfDirect);
    }
    categoryCosts.set(category.id, directCost + ownTotal);
  }

  const projectCost = Array.from(categoryCosts.values()).reduce((sum, c) => sum + c, 0);
  const share = (cost: number) => (projectCost > 0 ? (cost / projectCost) * 100 : 0);

  const taskWeights = new Map<number, number>();
  for (const [taskId, cost] of taskCosts) taskWeights.set(taskId, share(cost));
  const categoryWeights = new Map<number, number>();
  for (const [categoryId, cost] of categoryCosts) categoryWeights.set(categoryId, share(cost));

  return { projectCost, taskWeights, categoryWeights, taskCosts, categoryCosts };
}
