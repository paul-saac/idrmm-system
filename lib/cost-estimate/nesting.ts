import type { CostCategory, CostTask } from "./data";

export type NestMove = { kind: "category" | "task"; id: number; categoryId: number; beforeTaskId: number | null };
export type PendingNest = { token: number; move: NestMove; taskId: number; pending: boolean };

export function canNest(categories: CostCategory[], move: NestMove) {
  const target = categories.find(row => row.id === move.categoryId);
  if (!target || target.isMilestone || target.id <= 0) return false;
  if (move.beforeTaskId != null && !target.tasks.some(row => row.id === move.beforeTaskId)) return false;
  if (move.kind === "category") return move.id !== target.id && !!categories.find(row => row.id === move.id && !row.tasks.length);
  return move.id !== move.beforeTaskId && categories.some(row => row.tasks.some(task => task.id === move.id));
}
function categoryAsTask(row: CostCategory, categoryId: number, id: number): CostTask {
  return { ...row, id, categoryId, otherCostItems: row.otherCostItems ?? [], laborEstimate: row.categoryLaborEstimate,
    materialEstimate: row.categoryMaterialEstimate, equipmentEstimate: row.categoryEquipmentEstimate,
    otherCostEstimate: row.categoryOtherEstimate,
    totalEstimateCost: row.categoryLaborEstimate + row.categoryMaterialEstimate + row.categoryEquipmentEstimate + row.categoryOtherEstimate,
    predecessorTaskId: row.predecessorTaskId ?? null,
  };
}
/** One hierarchy level only. Groups stay at the top; leaf tasks and milestones may move. */
export function applyNest(categories: CostCategory[], entry: PendingNest): CostCategory[] {
  const { move, taskId } = entry;
  const sourceCategory = move.kind === "category" ? categories.find(row => row.id === move.id) : undefined;
  const sourceTask = move.kind === "task" ? categories.flatMap(row => row.tasks).find(row => row.id === move.id)
    : categories.flatMap(row => row.tasks).find(row => row.id === taskId);
  const task = sourceCategory ? categoryAsTask(sourceCategory, move.categoryId, taskId) : sourceTask ? { ...sourceTask, categoryId: move.categoryId } : undefined;
  if (!task || !categories.some(row => row.id === move.categoryId)) return categories;
  const rewire = <T extends { predecessorCategoryId?: number | null; predecessorTaskId?: number | null }>(row: T): T =>
    move.kind === "category" && row.predecessorCategoryId === move.id ? { ...row, predecessorCategoryId: null, predecessorTaskId: taskId } : row;
  return categories.filter(row => move.kind !== "category" || row.id !== move.id).map(row => {
    const tasks = row.tasks.filter(item => item.id !== taskId && !(move.kind === "task" && item.id === move.id)).map(rewire);
    if (row.id === move.categoryId) {
      const index = move.beforeTaskId == null ? tasks.length : tasks.findIndex(item => item.id === move.beforeTaskId);
      tasks.splice(index < 0 ? tasks.length : index, 0, rewire(task));
    }
    return { ...rewire(row), tasks };
  });
}
export function applyPendingNests(categories: CostCategory[], entries: PendingNest[]) {
  return entries.reduce(applyNest, categories);
}
export function unconfirmedNests(categories: CostCategory[], entries: PendingNest[]) {
  return entries.filter(entry => {
    if (entry.pending) return true;
    const target = categories.find(row => row.id === entry.move.categoryId);
    const index = target?.tasks.findIndex(row => row.id === entry.taskId) ?? -1;
    if (index < 0 || (entry.move.kind === "category" && categories.some(row => row.id === entry.move.id))) return true;
    return entry.move.beforeTaskId == null ? index !== target!.tasks.length - 1 : target!.tasks[index + 1]?.id !== entry.move.beforeTaskId;
  });
}

export type OutdentMove = { id: number; targetCategoryId: number; after: boolean };
export type PendingOutdent = { token: number; move: OutdentMove; categoryId: number; pending: boolean };
export function canOutdent(categories: CostCategory[], move: OutdentMove) {
  return categories.some(row => row.id === move.targetCategoryId && row.id > 0) &&
    categories.some(row => row.tasks.some(task => task.id === move.id && task.id > 0));
}
/** Convert a leaf into a standalone row, keeping its planned values and links. */
export function applyOutdent(categories: CostCategory[], entry: PendingOutdent): CostCategory[] {
  const { move, categoryId } = entry;
  const task = categories.flatMap(row => row.tasks).find(row => row.id === move.id);
  const existing = categories.find(row => row.id === categoryId);
  if ((!task && !existing) || !categories.some(row => row.id === move.targetCategoryId)) return categories;
  const standalone: CostCategory = existing ?? { ...task!, id: categoryId, tasks: [],
    categoryLaborEstimate: task!.laborEstimate, categoryMaterialEstimate: task!.materialEstimate,
    categoryEquipmentEstimate: task!.equipmentEstimate, categoryOtherEstimate: task!.otherCostEstimate };
  const rewire = <T extends { predecessorTaskId?: number | null; predecessorCategoryId?: number | null }>(row: T): T =>
    row.predecessorTaskId === move.id ? { ...row, predecessorTaskId: null, predecessorCategoryId: categoryId } : row;
  const result = categories.filter(row => row.id !== categoryId).map(row => ({ ...rewire(row),
    tasks: row.tasks.filter(child => child.id !== move.id).map(rewire) }));
  const index = result.findIndex(row => row.id === move.targetCategoryId);
  result.splice(index + (move.after ? 1 : 0), 0, rewire(standalone));
  return result;
}
export function applyPendingOutdents(categories: CostCategory[], entries: PendingOutdent[]) {
  return entries.reduce(applyOutdent, categories);
}
export function unconfirmedOutdents(categories: CostCategory[], entries: PendingOutdent[]) {
  return entries.filter(entry => {
    if (entry.pending || categories.some(row => row.tasks.some(task => task.id === entry.move.id))) return true;
    // A concurrent reorder may change adjacency after our save. Its new identity
    // and the removed source confirm the conversion without pinning stale order.
    return !categories.some(row => row.id === entry.categoryId);
  });
}
