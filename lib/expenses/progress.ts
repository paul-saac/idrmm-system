import type { CostAmounts } from "@/lib/task-progress/calculate";

export type ProgressExpense = {
  id: string;
  entryDate: string;
  itemName: string;
  itemKey: string;
  savedByName: string | null;
  supplier?: string;
  invoiceNumber?: string;
  costs: CostAmounts;
  equipmentItems?: {
    name: string;
    amount: number;
    unplanned: boolean;
  }[];
  isUnplanned?: boolean;
  equipmentName?: string;
};

export const EXPENSE_CATEGORIES = ["material", "equipment", "labor", "other"] as const;

/** Current saved entries only, never the append-only override audit history. */
export function summarizeProgressExpenses(entries: ProgressExpense[]) {
  const cents: CostAmounts = { material: 0, equipment: 0, labor: 0, other: 0 };
  const days = new Map<string, number>();
  for (const entry of entries) {
    let daily = 0;
    for (const category of EXPENSE_CATEGORIES) {
      const amount = Math.round(entry.costs[category] * 100);
      cents[category] += amount;
      daily += amount;
    }
    days.set(entry.entryDate, (days.get(entry.entryDate) ?? 0) + daily);
  }
  const actual = { ...cents };
  for (const category of EXPENSE_CATEGORIES) actual[category] /= 100;
  let cumulative = 0;
  const trend = [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => {
    cumulative += amount;
    return { date, daily: amount / 100, cumulative: cumulative / 100 };
  });
  return { actual, total: Object.values(cents).reduce((a, b) => a + b, 0) / 100, trend };
}
