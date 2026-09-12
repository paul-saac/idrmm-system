import { getProjectById, type ProjectRow } from "@/lib/projects/data";
import { getCostEstimate } from "@/lib/cost-estimate/data";
import { getProjectProgress } from "@/lib/progress/data";
import {
  listLaborExpenses,
  listMaterialExpenses,
  listEquipmentExpenses,
  listOtherExpenses,
  summarizeExpenses,
  type LaborExpenseGroup,
  type MaterialExpenseGroup,
  type EquipmentExpenseGroup,
  type ExpenseOverview,
} from "@/lib/expenses/data";

export type DateRange = { from: string | null; to: string | null };

function inRange(logDate: string, range: DateRange) {
  if (range.from && logDate < range.from) return false;
  if (range.to && logDate > range.to) return false;
  return true;
}

export type MonthlyExpensePoint = {
  /** "2026-04" style key, used for sorting — the label is derived from it. */
  monthKey: string;
  label: string;
  material: number;
  labor: number;
  equipment: number;
};

/**
 * Buckets every approved log's labor/material/equipment totals by
 * calendar month across the project's *entire* history — deliberately
 * not scoped to the report's date-range filter (that filter only
 * narrows the three ledger tables below it), so this chart always shows
 * the full spend trend regardless of which window someone is currently
 * drilling into.
 */
function buildMonthlySeries(
  labor: LaborExpenseGroup[],
  material: MaterialExpenseGroup[],
  equipment: EquipmentExpenseGroup[]
): MonthlyExpensePoint[] {
  const byMonth = new Map<string, MonthlyExpensePoint>();

  function bucket(monthKey: string): MonthlyExpensePoint {
    let point = byMonth.get(monthKey);
    if (!point) {
      const [year, month] = monthKey.split("-").map(Number);
      const label = new Date(year, month - 1, 1).toLocaleDateString("en-US", {
        month: "short",
      });
      point = { monthKey, label, material: 0, labor: 0, equipment: 0 };
      byMonth.set(monthKey, point);
    }
    return point;
  }

  for (const group of labor) {
    bucket(group.logDate.slice(0, 7)).labor += group.groupTotal;
  }
  for (const group of material) {
    bucket(group.logDate.slice(0, 7)).material += group.groupTotal;
  }
  for (const group of equipment) {
    bucket(group.logDate.slice(0, 7)).equipment += group.groupTotal;
  }

  return Array.from(byMonth.values()).sort((a, b) =>
    a.monthKey.localeCompare(b.monthKey)
  );
}

export type TopMaterial = { name: string; cost: number };

function buildTopMaterials(material: MaterialExpenseGroup[], limit = 5): TopMaterial[] {
  const costByName = new Map<string, number>();
  for (const group of material) {
    for (const procurement of group.procurements) {
      for (const item of procurement.items) {
        costByName.set(
          item.materialName,
          (costByName.get(item.materialName) ?? 0) + item.subTotal
        );
      }
    }
  }
  return Array.from(costByName.entries())
    .map(([name, cost]) => ({ name, cost }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, limit);
}

export type ReportData = {
  project: ProjectRow;
  totalEstimatedCost: number;
  overview: ExpenseOverview;
  progressPercent: number;
  monthlySeries: MonthlyExpensePoint[];
  topMaterials: TopMaterial[];
  /** The three ledgers named in scope, already filtered to the report's
   * date range for the summary tables — Other Expenses isn't one of the
   * three and is only folded into the Cost Breakdown/Budget donuts. */
  laborRows: LaborExpenseGroup[];
  materialRows: MaterialExpenseGroup[];
  equipmentRows: EquipmentExpenseGroup[];
};

export async function getReportData(
  projectId: number,
  range: DateRange = { from: null, to: null }
): Promise<ReportData | null> {
  const project = await getProjectById(projectId);
  if (!project) return null;

  const [costEstimate, labor, material, equipment, other] = await Promise.all([
    getCostEstimate(projectId),
    listLaborExpenses(projectId),
    listMaterialExpenses(projectId),
    listEquipmentExpenses(projectId),
    listOtherExpenses(projectId),
  ]);

  const progress = await getProjectProgress(projectId, costEstimate.categories);

  const overview = summarizeExpenses(labor, material, equipment, other, {
    labor: costEstimate.summary.totalsByColumn.labor,
    material: costEstimate.summary.totalsByColumn.material,
    equipment: costEstimate.summary.totalsByColumn.equipment,
    other: costEstimate.summary.totalsByColumn.other,
  });

  return {
    project,
    totalEstimatedCost: costEstimate.summary.totalEstimatedCost,
    overview,
    progressPercent: progress.overallPercent,
    monthlySeries: buildMonthlySeries(labor, material, equipment),
    topMaterials: buildTopMaterials(material),
    laborRows: labor.filter((g) => inRange(g.logDate, range)),
    materialRows: material.filter((g) => inRange(g.logDate, range)),
    equipmentRows: equipment.filter((g) => inRange(g.logDate, range)),
  };
}
