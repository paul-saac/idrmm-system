import type { CostEstimate } from "@/lib/cost-estimate/data";
import type { ProgressEquipmentCost } from "@/lib/equipment/data";

/** Where a task's equipment spend stands against its budget and its work
 * done. */
export type EquipmentCostStatus =
  | "within_budget"
  | "spending_ahead"
  | "over_budget"
  | "not_budgeted";

/** One task's (or task-less phase's) equipment cost — the Equipment
 * record's Equipment cost view, a row each. */
export type EquipmentCostRecord = {
  /** task-<id> or category-<id>. */
  key: string;
  /** A task under its phase: "PAINTING WORKS - Wall & Ceiling Painting";
   * a task-less phase, its own name. */
  name: string;
  /** The task's own name — or the task-less phase's. */
  title: string;
  /** The phase a task is under — null for a task-less phase itself. */
  phase: string | null;
  /** The estimate's equipment cost for it. */
  budget: number;
  /** Spent so far, from equipment costs explicitly saved in Progress
   * Tracking Overrides. This stays an auditable cost record, not a
   * schedule-based planned-share projection. */
  spent: number;
  /** How much of its work is done, in percent. */
  percentDone: number;
  /** How much of its budget is spent, in percent — null without one. */
  percentUsed: number | null;
  status: EquipmentCostStatus;
  /** Its newest day with an equipment cost typed (YYYY-MM-DD). */
  lastLogged: string | null;
  /** Its days with an equipment cost typed, newest first. */
  entries: ProgressEquipmentCost[];
};

// How far budget used may run ahead of work done, in percentage points,
// before it reads as spending ahead.
const AHEAD_TOLERANCE = 10;

/**
 * Spend against budget and work done: over budget once past it; spending
 * ahead while the budget's going more than AHEAD_TOLERANCE points faster
 * than the work (62% used, 48% done); not budgeted when there's no budget
 * to measure against.
 */
export function equipmentCostStatus(
  budget: number,
  spent: number,
  percentDone: number
): EquipmentCostStatus {
  if (budget <= 0) return "not_budgeted";
  if (spent > budget + 0.5) return "over_budget";
  if ((spent / budget) * 100 - percentDone > AHEAD_TOLERANCE) return "spending_ahead";
  return "within_budget";
}

/**
 * Every task — and every phase without tasks, which logs its own progress
 * — with an equipment budget or a saved equipment-cost override, phase by
 * phase in the estimate's order. Projected daily planned shares never
 * create a cost record or affect its balance.
 */
export function buildEquipmentCostRecords(
  estimate: CostEstimate,
  costs: ProgressEquipmentCost[]
): EquipmentCostRecord[] {
  // Already newest first.
  const entriesByKey = new Map<string, ProgressEquipmentCost[]>();
  for (const cost of costs) {
    const list = entriesByKey.get(cost.itemKey) ?? [];
    list.push(cost);
    entriesByKey.set(cost.itemKey, list);
  }

  const records: EquipmentCostRecord[] = [];
  function add(
    key: string,
    title: string,
    phase: string | null,
    budget: number,
    percentDone: number
  ) {
    const entries = entriesByKey.get(key) ?? [];
    const spent = entries.reduce((sum, entry) => sum + entry.amount, 0);
    if (budget <= 0 && spent <= 0.005) return;
    records.push({
      key,
      name: phase ? `${phase} - ${title}` : title,
      title,
      phase,
      budget,
      spent,
      percentDone,
      percentUsed: budget > 0 ? (spent / budget) * 100 : null,
      status: equipmentCostStatus(budget, spent, percentDone),
      lastLogged: entries[0]?.entryDate ?? null,
      entries,
    });
  }

  for (const category of estimate.categories) {
    if (category.tasks.length === 0) {
      add(
        `category-${category.id}`,
        category.name,
        null,
        category.categoryEquipmentEstimate,
        category.percentComplete
      );
      continue;
    }
    for (const task of category.tasks) {
      add(
        `task-${task.id}`,
        task.name,
        category.name,
        task.equipmentEstimate,
        task.percentComplete
      );
    }
  }
  return records;
}

/** The whole project's equipment cost, for the Equipment overview's cards:
 * its budget, spent and remaining, and the same status as a row's — work
 * done weighted by each one's budget. */
export function summarizeEquipmentCost(records: EquipmentCostRecord[]) {
  const budget = records.reduce((sum, record) => sum + record.budget, 0);
  const spent = records.reduce((sum, record) => sum + record.spent, 0);
  const percentDone =
    budget > 0
      ? records.reduce((sum, record) => sum + record.budget * record.percentDone, 0) / budget
      : 0;
  return {
    budget,
    spent,
    remaining: budget - spent,
    percentUsed: budget > 0 ? (spent / budget) * 100 : null,
    percentDone,
    status: equipmentCostStatus(budget, spent, percentDone),
  };
}
