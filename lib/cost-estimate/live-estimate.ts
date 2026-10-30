import type { CostCategory, CostEstimate, CostTask } from "./data";
import { computeWeights } from "./weights";
import { computeProgressBreakdown, EMPTY_PROGRESS_ANCHOR, groupPlannedMaterials, type ProgressAnchor } from "@/lib/task-progress/calculate";

export type SavedEstimateProgress = {
  task: Record<number, ProgressAnchor>;
  category: Record<number, ProgressAnchor>;
  workingDays: number[];
  holidays: string[];
};

export function withSavedEstimateProgress(categories: CostCategory[], progress: SavedEstimateProgress): CostCategory[] {
  const percent = (row: CostCategory | CostTask, kind: "task" | "category") => computeProgressBreakdown({
    plannedStartDate: row.plannedStartDate, plannedEndDate: row.plannedEndDate,
    estimatedQuantity: row.estimatedQuantity, plannedMaterials: groupPlannedMaterials(row.materialAssignments),
    plannedCosts: "laborEstimate" in row
      ? { labor: row.laborEstimate, material: row.materialEstimate, equipment: row.equipmentEstimate, other: row.otherCostEstimate }
      : { labor: row.categoryLaborEstimate, material: row.categoryMaterialEstimate, equipment: row.categoryEquipmentEstimate, other: row.categoryOtherEstimate },
    anchor: progress[kind][row.id] ?? EMPTY_PROGRESS_ANCHOR, workingDays: progress.workingDays, holidays: progress.holidays, today: new Date(),
  }).percentComplete;
  return categories.map(category => ({ ...category, percentComplete: percent(category, "category"),
    tasks: category.tasks.map(task => ({ ...task, percentComplete: percent(task, "task") })),
  }));
}

export type EstimateRowPatch =
  | { kind: "category"; id: number; values: Partial<Omit<CostCategory, "id" | "tasks">> }
  | { kind: "task"; id: number; values: Partial<Omit<CostTask, "id" | "categoryId">> };

export type EstimateChange = { token: number; patches: EstimateRowPatch[]; pending: boolean };

function taskWithPatch(task: CostTask, values: Partial<CostTask>): CostTask {
  const updated = { ...task, ...values };
  if (["laborEstimate", "materialEstimate", "equipmentEstimate", "otherCostEstimate"].some(key => key in values)) {
    updated.totalEstimateCost = updated.laborEstimate + updated.materialEstimate + updated.equipmentEstimate + updated.otherCostEstimate;
  }
  return updated;
}

/** Patches own fields only, so unrelated concurrent edits cannot overwrite each other. */
export function applyEstimatePatches(categories: CostCategory[], patches: EstimateRowPatch[]): CostCategory[] {
  return patches.reduce((result, patch) => result.map(category => {
    if (patch.kind === "category") return category.id === patch.id ? { ...category, ...patch.values } : category;
    if (!category.tasks.some(task => task.id === patch.id)) return category;
    return { ...category, tasks: category.tasks.map(task => task.id === patch.id ? taskWithPatch(task, patch.values) : task) };
  }), categories);
}

export function applyEstimateChanges(categories: CostCategory[], changes: EstimateChange[]): CostCategory[] {
  return applyEstimatePatches(categories, changes.flatMap(change => change.patches));
}

// Database-generated line IDs can change on save. Compare the actual material/
// expense content when deciding whether server data confirms an optimistic edit.
function matchesValue(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((value, index) => matchesValue(actual[index], value));
  if (expected && typeof expected === "object") return !!actual && typeof actual === "object" && Object.entries(expected).every(([key, value]) =>
    key === "id" || matchesValue((actual as Record<string, unknown>)[key], value));
  if (typeof actual === "number" && typeof expected === "number") return Math.abs(actual - expected) <= 1e-8;
  return actual === expected;
}

export function unconfirmedEstimateChanges(categories: CostCategory[], changes: EstimateChange[]): EstimateChange[] {
  let count = 0;
  const expected = new Map<string, EstimateRowPatch>();
  for (const change of changes) {
    if (change.pending) break;
    count++;
    for (const patch of change.patches) {
      const key = `${patch.kind}:${patch.id}`;
      const previous = expected.get(key);
      expected.set(key, { ...patch, values: { ...previous?.values, ...patch.values } } as EstimateRowPatch);
    }
  }
  if (!count) return changes;
  for (const patch of expected.values()) {
    const row = patch.kind === "category" ? categories.find(category => category.id === patch.id)
      : categories.flatMap(category => category.tasks).find(task => task.id === patch.id);
    if (!row) return changes;
    for (const [field, value] of Object.entries(patch.values)) {
      if (!matchesValue(row[field as keyof typeof row], value)) return changes;
    }
  }
  return changes.slice(count);
}

/** Same planned-cost/weight formulas as getCostEstimate. Actual spend remains
 * saved work only; expected progress never creates an actual expenditure. */
export function liveCostEstimate(source: CostEstimate, categories: CostCategory[], progress?: SavedEstimateProgress): CostEstimate {
  if (progress) categories = withSavedEstimateProgress(categories, progress);
  const weights = computeWeights(categories);
  const totals = { labor: 0, material: 0, equipment: 0, other: 0 };
  const actual = { labor: 0, material: 0, equipment: 0, other: 0 };
  let taskCount = 0;
  const result = categories.map(category => {
    totals.labor += category.categoryLaborEstimate;
    totals.material += category.categoryMaterialEstimate;
    totals.equipment += category.categoryEquipmentEstimate;
    totals.other += category.categoryOtherEstimate;
    if (!category.tasks.length) {
      for (const key of ["labor", "material", "equipment", "other"] as const) actual[key] += category.costsToDate[key];
    }
    const tasks = category.tasks.map(task => {
      taskCount++;
      totals.labor += task.laborEstimate;
      totals.material += task.materialEstimate;
      totals.equipment += task.equipmentEstimate;
      totals.other += task.otherCostEstimate;
      for (const key of ["labor", "material", "equipment", "other"] as const) actual[key] += task.costsToDate[key];
      return { ...task, weight: weights.taskWeights.get(task.id) ?? 0 };
    });
    return { ...category, tasks, weight: weights.categoryWeights.get(category.id) ?? 0 };
  });
  return { ...source, categories: result, summary: {
    categoryCount: result.length, taskCount, totalEstimatedCost: weights.projectCost,
    totalsByColumn: totals, costsToDate: actual,
  } };
}
