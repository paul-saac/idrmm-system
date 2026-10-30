import type { CostCategory } from "./data";

export type ScheduleRowMove = {
  kind: "category" | "task";
  id: number;
  targetId: number;
  after: boolean;
};

export type ScheduleRowOrder = {
  kind: "category" | "task";
  categoryId: number | null;
  ids: number[];
};

export type PendingScheduleMove = {
  token: number;
  move: ScheduleRowMove;
  pending: boolean;
  savedOrder?: ScheduleRowOrder;
};

function moveRow<T extends { id: number }>(rows: T[], move: ScheduleRowMove): T[] {
  const source = rows.find(row => row.id === move.id);
  if (!source || move.id === move.targetId || !rows.some(row => row.id === move.targetId)) return rows;
  const result = rows.filter(row => row.id !== move.id);
  const index = result.findIndex(row => row.id === move.targetId) + (move.after ? 1 : 0);
  result.splice(index, 0, source);
  return result;
}

/** Main tasks move as a whole; subtasks stay with their existing main task. */
export function applyScheduleMove(categories: CostCategory[], move: ScheduleRowMove): CostCategory[] {
  if (move.kind === "category") return moveRow(categories, move);
  return categories.map(category => {
    const tasks = moveRow(category.tasks, move);
    return tasks === category.tasks ? category : { ...category, tasks };
  });
}

export function scheduleOrderForMove(categories: CostCategory[], move: ScheduleRowMove): ScheduleRowOrder | null {
  const parent = move.kind === "task"
    ? categories.find(category => category.tasks.some(task => task.id === move.id))
    : null;
  const rows = move.kind === "category" ? categories : parent?.tasks;
  if (!rows || move.id === move.targetId || !rows.some(row => row.id === move.id) || !rows.some(row => row.id === move.targetId)) return null;
  const ids = moveRow(rows as { id: number }[], move).map(row => row.id);
  if (ids.every((id, index) => rows[index].id === id)) return null;
  return { kind: move.kind, categoryId: parent?.id ?? null, ids };
}

function orderRows<T extends { id: number }>(rows: T[], ids: number[]): T[] {
  const positions = new Map(ids.map((id, index) => [id, index]));
  return [...rows].sort((a, b) =>
    (positions.get(a.id) ?? ids.length) - (positions.get(b.id) ?? ids.length));
}

export function applyPendingScheduleMoves(categories: CostCategory[], entries: PendingScheduleMove[]): CostCategory[] {
  return entries.reduce((result, entry) => {
    const order = entry.savedOrder;
    if (!order) return applyScheduleMove(result, entry.move);
    return order.kind === "category" ? orderRows(result, order.ids) : result.map(category =>
      category.id === order.categoryId ? { ...category, tasks: orderRows(category.tasks, order.ids) } : category);
  }, categories);
}

/** Retain optimistic order through stale refreshes and rapid consecutive drops. */
export function unconfirmedScheduleMoves(categories: CostCategory[], entries: PendingScheduleMove[]): PendingScheduleMove[] {
  let settled = 0;
  const latestOrders = new Map<string, ScheduleRowOrder>();
  for (const entry of entries) {
    if (entry.pending || !entry.savedOrder) break;
    latestOrders.set(`${entry.savedOrder.kind}:${entry.savedOrder.categoryId}`, entry.savedOrder);
    settled++;
  }
  if (!settled) return entries;
  for (const order of latestOrders.values()) {
    const rows = order.kind === "category" ? categories : categories.find(category => category.id === order.categoryId)?.tasks ?? [];
    const known = new Set(order.ids);
    const actual = rows.filter(row => known.has(row.id)).map(row => row.id);
    const existing = new Set(actual);
    const expected = order.ids.filter(id => existing.has(id));
    if (actual.some((id, index) => id !== expected[index])) return entries;
  }
  return entries.slice(settled);
}
