import type { CostCategory } from "@/lib/cost-estimate/data";
import type { ProgressExpense } from "@/lib/expenses/progress";

export const CLOSEOUT_FIELDS = [
  { key: "summary", label: "Project lifecycle summary", section: "Project lifecycle summary" },
  { key: "outcomes", label: "Final outcomes", section: "Final outcomes" },
  { key: "lessons", label: "Lessons learned", section: "Lessons learned" },
  { key: "performance", label: "Overall performance review", section: "Overall performance" },
] as const;

export type CloseoutNotes = Partial<Record<(typeof CLOSEOUT_FIELDS)[number]["key"], string>>;
export type CloseoutRecord = {
  project_id: number;
  notes: CloseoutNotes;
  milestone_dates: Record<string, string>;
  version: number;
  updated_at: string;
  updated_by: string | null;
};

export type CloseoutWorkItem = {
  key: string;
  name: string;
  phase: string;
  start: string | null;
  end: string | null;
  milestone: boolean;
  percent: number;
  planned: number;
  logged: number;
};

/** Leaf tasks and standalone phases only: never count a parent twice. */
export function buildCloseoutWork(categories: CostCategory[], expenses: ProgressExpense[]): CloseoutWorkItem[] {
  const centsByItem = new Map<string, number>();
  for (const entry of expenses) {
    const cents = Object.values(entry.costs).reduce((sum, value) => sum + Math.round(value * 100), 0);
    centsByItem.set(entry.itemKey, (centsByItem.get(entry.itemKey) ?? 0) + cents);
  }
  return categories.flatMap((category) => category.tasks.length
    ? category.tasks.map((task) => ({
        key: `task-${task.id}`, name: task.name, phase: category.name,
        start: task.plannedStartDate, end: task.plannedEndDate,
        milestone: task.isMilestone, percent: task.percentComplete,
        planned: task.totalEstimateCost, logged: (centsByItem.get(`task-${task.id}`) ?? 0) / 100,
      }))
    : [{
        key: `category-${category.id}`, name: category.name, phase: "Standalone phase",
        start: category.plannedStartDate, end: category.plannedEndDate,
        milestone: category.isMilestone, percent: category.percentComplete,
        planned: category.categoryLaborEstimate + category.categoryMaterialEstimate + category.categoryEquipmentEstimate + category.categoryOtherEstimate,
        logged: (centsByItem.get(`category-${category.id}`) ?? 0) / 100,
      }]);
}

export function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Calendar-day variance, independent of the browser/server timezone. */
export function dayVariance(planned: string | null, actual: string | null): number | null {
  if (!planned || !actual || !isDateOnly(planned) || !isDateOnly(actual)) return null;
  return Math.round((Date.parse(`${actual}T00:00:00Z`) - Date.parse(`${planned}T00:00:00Z`)) / 86_400_000);
}

export function buildCloseoutMonths(entries: ProgressExpense[]) {
  const months = new Map<string, { monthKey: string; label: string; material: number; labor: number; equipment: number; other: number }>();
  for (const entry of entries) {
    const key = entry.entryDate.slice(0, 7);
    const month = months.get(key) ?? { monthKey: key, label: new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }), material: 0, labor: 0, equipment: 0, other: 0 };
    for (const category of ["material", "labor", "equipment", "other"] as const) month[category] += Math.round(entry.costs[category] * 100);
    months.set(key, month);
  }
  return [...months.values()].sort((a, b) => a.monthKey.localeCompare(b.monthKey)).map((month) => ({ ...month, material: month.material / 100, labor: month.labor / 100, equipment: month.equipment / 100, other: month.other / 100 }));
}
