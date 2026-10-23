import type { CostCategory } from "@/lib/cost-estimate/data";
import type { ProgressExpense } from "@/lib/expenses/progress";

export const CLOSEOUT_FIELDS = [
  { key: "summary", label: "Project lifecycle summary", section: "A. General information & lifecycle summary" },
  { key: "outcomes", label: "Final outcomes & deliverable acceptance", section: "B. Project deliverables & final outcomes" },
  { key: "cost_explanation", label: "Cost & budget variance explanation", section: "C. Cost (budget) baseline" },
  { key: "performance", label: "Overall performance review", section: "F. Performance baseline & overall review" },
  { key: "scope_changes", label: "Scope changes & impact on baselines", section: "G. Scope changes & field adjustments" },
  { key: "operations_maintenance", label: "Operations, maintenance & turnover plan", section: "H. Equipment demobilization & document repository" },
  { key: "lessons", label: "Lessons learned", section: "I. Lessons learned" },
  { key: "approver_architect", label: "Project Architect / Lead Engineer (name & title)", section: "J. Formal approvals & sign-off" },
  { key: "approver_client", label: "Project Sponsor / Client Owner (name & title)", section: "J. Formal approvals & sign-off" },
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

export type CloseoutDeliverable = {
  id: number;
  name: string;
  taskCount: number;
  completedTasks: number;
  startDate: string | null;
  endDate: string | null;
  percent: number;
  planned: number;
  logged: number;
};

export type CloseoutCostBaseline = {
  allocatedBudget: number | null;
  planned: { material: number; labor: number; equipment: number; other: number; total: number };
  actual: { material: number; labor: number; equipment: number; other: number; total: number };
};

export type CloseoutEquipmentSummary = {
  id: number;
  equipmentName: string;
  equipmentAssetTag: string;
  purpose: string | null;
  assignedAt: string;
  returnedAt: string | null;
  currentTaskName: string | null;
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

export function buildCloseoutDeliverables(categories: CostCategory[], expenses: ProgressExpense[]): CloseoutDeliverable[] {
  const centsByItem = new Map<string, number>();
  for (const entry of expenses) {
    const cents = Object.values(entry.costs).reduce((sum, value) => sum + Math.round(value * 100), 0);
    centsByItem.set(entry.itemKey, (centsByItem.get(entry.itemKey) ?? 0) + cents);
  }
  return categories.map((category) => {
    if (category.tasks.length > 0) {
      const starts = category.tasks.map((t) => t.plannedStartDate).filter((d): d is string => Boolean(d)).sort();
      const ends = category.tasks.map((t) => t.plannedEndDate).filter((d): d is string => Boolean(d)).sort();
      const plannedCents = category.tasks.reduce((sum, t) => sum + Math.round((t.totalEstimateCost || 0) * 100), 0);
      const loggedCents = category.tasks.reduce((sum, t) => sum + (centsByItem.get(`task-${t.id}`) ?? 0), 0) + (centsByItem.get(`category-${category.id}`) ?? 0);
      const completedTasks = category.tasks.filter((t) => t.percentComplete >= 100).length;
      const avgPercent = category.tasks.reduce((sum, t) => sum + (t.percentComplete || 0), 0) / category.tasks.length;
      return {
        id: category.id,
        name: category.name,
        taskCount: category.tasks.length,
        completedTasks,
        startDate: starts[0] ?? null,
        endDate: ends[ends.length - 1] ?? null,
        percent: Number(avgPercent.toFixed(1)),
        planned: plannedCents / 100,
        logged: loggedCents / 100,
      };
    }
    const planned = (category.categoryLaborEstimate || 0) + (category.categoryMaterialEstimate || 0) + (category.categoryEquipmentEstimate || 0) + (category.categoryOtherEstimate || 0);
    const logged = (centsByItem.get(`category-${category.id}`) ?? 0) / 100;
    return {
      id: category.id,
      name: category.name,
      taskCount: 1,
      completedTasks: category.percentComplete >= 100 ? 1 : 0,
      startDate: category.plannedStartDate,
      endDate: category.plannedEndDate,
      percent: Number((category.percentComplete || 0).toFixed(1)),
      planned: Math.round(planned * 100) / 100,
      logged,
    };
  });
}

export function buildCloseoutCostBaseline(
  plannedByColumn: { material: number; labor: number; equipment: number; other: number },
  expenses: ProgressExpense[],
  allocatedBudget: number | null = null
): CloseoutCostBaseline {
  const actualCents = { material: 0, labor: 0, equipment: 0, other: 0 };
  for (const entry of expenses) {
    for (const key of ["material", "labor", "equipment", "other"] as const) {
      actualCents[key] += Math.round((entry.costs[key] || 0) * 100);
    }
  }
  const planned = {
    material: Math.round((plannedByColumn.material || 0) * 100) / 100,
    labor: Math.round((plannedByColumn.labor || 0) * 100) / 100,
    equipment: Math.round((plannedByColumn.equipment || 0) * 100) / 100,
    other: Math.round((plannedByColumn.other || 0) * 100) / 100,
    total: Math.round(((plannedByColumn.material || 0) + (plannedByColumn.labor || 0) + (plannedByColumn.equipment || 0) + (plannedByColumn.other || 0)) * 100) / 100,
  };
  const actual = {
    material: actualCents.material / 100,
    labor: actualCents.labor / 100,
    equipment: actualCents.equipment / 100,
    other: actualCents.other / 100,
    total: (actualCents.material + actualCents.labor + actualCents.equipment + actualCents.other) / 100,
  };
  return { allocatedBudget, planned, actual };
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
