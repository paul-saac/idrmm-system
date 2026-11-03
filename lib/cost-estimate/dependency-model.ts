import type { CostCategory } from "./data";
export type DependencyRef = { kind: "category" | "task"; id: number };
export type DependencyFields = { predecessors?: DependencyRef[]; predecessorTaskId?: number | null; predecessorCategoryId?: number | null };
export const dependencyKey = (row: DependencyRef) => `${row.kind}:${row.id}`;
export function rowPredecessors(row: DependencyFields): DependencyRef[] {
  return row.predecessors ?? (row.predecessorTaskId != null ? [{ kind: "task", id: row.predecessorTaskId }]
    : row.predecessorCategoryId != null ? [{ kind: "category", id: row.predecessorCategoryId }] : []);
}
export function parseDependencyKey(value: string): DependencyRef {
  const match = /^(category|task):([1-9][0-9]*)$/.exec(value);
  if (!match || !Number.isSafeInteger(Number(match[2]))) throw new Error("Choose valid task dependencies.");
  return { kind: match[1] as DependencyRef["kind"], id: Number(match[2]) };
}
export function dependencyRows(categories: CostCategory[]) {
  return categories.flatMap(category => [
    { ...category, kind: "category" as const, grouped: category.tasks.length > 0, label: category.name, phase: category.tasks.length > 0 ? category.name : "", colorId: category.id },
    ...category.tasks.map(task => ({ ...task, kind: "task" as const, grouped: false, label: task.name, phase: category.name, colorId: category.id })),
  ]);
}
export function dependencySelection(categories: CostCategory[], source: DependencyRef) {
  const key = dependencyKey(source), rows = dependencyRows(categories);
  return { predecessors: rowPredecessors(rows.find(row => dependencyKey(row) === key) ?? {}).map(dependencyKey),
    successors: rows.filter(row => row.kind === "task" && rowPredecessors(row).some(ref => dependencyKey(ref) === key)).map(dependencyKey) };
}
export function withPredecessors<T extends DependencyFields>(row: T, refs: DependencyRef[]): T {
  const predecessors = [...new Map(refs.map(ref => [dependencyKey(ref), ref])).values()].sort((a,b) => dependencyKey(a).localeCompare(dependencyKey(b)));
  const first = predecessors[0];
  return { ...row, predecessors, predecessorTaskId: first?.kind === "task" ? first.id : null,
    predecessorCategoryId: first?.kind === "category" ? first.id : null };
}
/** Replace only this node's incoming and editable outgoing links, preserving other predecessors. */
export function applyDependencySelection(categories: CostCategory[], source: DependencyRef, incoming: string[], outgoing: string[]): CostCategory[] {
  const key = dependencyKey(source), wanted = new Set(outgoing);
  function patch<T extends DependencyFields & { id: number }>(row: T, kind: DependencyRef["kind"]): T {
    if (dependencyKey({ kind, id: row.id }) === key) return withPredecessors(row, incoming.map(parseDependencyKey));
    if (kind === "category") return row; // Category incoming links are managed on their own form.
    const refs = rowPredecessors(row).filter(ref => dependencyKey(ref) !== key);
    if (wanted.has(dependencyKey({ kind, id: row.id }))) refs.push(source);
    return withPredecessors(row, refs);
  }
  return categories.map(category => ({ ...patch(category, "category"),
    tasks: category.tasks.map(task => patch(task, "task")) }));
}
/** Group start/finish gates prevent child-to-parent and indirect summary cycles. */
export function hasDependencyCycle(categories: CostCategory[]): boolean {
  const rows = dependencyRows(categories), nodes = new Map(rows.map(row => [dependencyKey(row), row]));
  const edges = new Map<string, Set<string>>();
  const add = (from: string, to: string) => { const targets = edges.get(from) ?? new Set<string>(); targets.add(to); edges.set(from, targets); };
  for (const row of rows) {
    const key = dependencyKey(row), target = row.grouped ? `${key}:start` : key;
    for (const ref of rowPredecessors(row)) if (nodes.has(dependencyKey(ref))) add(dependencyKey(ref), target);
  }
  for (const category of categories) for (const task of category.tasks) {
    add(`category:${category.id}:start`, `task:${task.id}`); add(`task:${task.id}`, `category:${category.id}`);
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  function visit(key: string): boolean {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    for (const next of edges.get(key) ?? []) if (visit(next)) return true;
    visiting.delete(key); visited.add(key); return false;
  }
  return [...edges.keys()].some(visit);
}
