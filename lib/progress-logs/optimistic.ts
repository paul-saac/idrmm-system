import type { OverrideLog } from "./types";
import type { ProgressDayEntry, TaskProgressToday } from "@/lib/task-progress/data";
import { COST_COMPONENTS, EMPTY_PROGRESS_ANCHOR, materialKey, otherCostKey } from "@/lib/task-progress/calculate";

export function latestDailyLogs(logs: readonly OverrideLog[]) {
  const byDate = new Map<string, OverrideLog>();
  for (const log of [...logs].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || Number(a.id >= 0) - Number(b.id >= 0) || b.id - a.id)) {
    if (log.action === "saved" && !byDate.has(log.entryDate)) byDate.set(log.entryDate, log);
  }
  return byDate;
}
export function dayEntry(log: OverrideLog): ProgressDayEntry {
  const materialUsage: Record<string, number> = {};
  for (const row of log.materialsUsed.filter(row => row.unitCost == null)) {
    const key = materialKey(row.name, row.unit);
    materialUsage[key] = (materialUsage[key] ?? 0) + row.quantity;
  }
  const spend = (rows: { name: string; amount: number; unplanned?: boolean }[] = []) => Object.fromEntries(
    rows.filter(row => !row.unplanned).map(row => [otherCostKey(row.name), row.amount]));
  return { quantityCompleted: log.quantityCompleted, costs: log.costs, materialUsage,
    // Unit costs identify the unplanned lines in override history.
    unplannedMaterials: log.materialsUsed.filter(row => row.unitCost != null).map(row => ({ ...row, unitCost: row.unitCost! })),
    equipmentCostSpend: spend(log.equipmentCosts), otherCostSpend: spend(log.otherCosts),
    unplannedEquipmentCosts: log.equipmentCosts?.filter(row => row.unplanned),
    unplannedOtherCosts: log.otherCosts?.filter(row => row.unplanned),
  };
}
/** Replace a single daily entry, never add repeated saves twice. */
export function projectProgressLog(before: TaskProgressToday | undefined, logs: OverrideLog[], date: string, next: OverrideLog | null, today: string) {
  const current: TaskProgressToday = before ?? { ...EMPTY_PROGRESS_ANCHOR, today: null, latest: null, todayAttendance: [] };
  const previous = latestDailyLogs(logs).get(date);
  const old = date === today ? current.today : previous ? dayEntry(previous) : null;
  const added = next ? dayEntry(next) : null;
  const deltaMap = (base: Record<string, number> = {}, removed: Record<string, number> = {}, added: Record<string, number> = {}) => {
    const result = { ...base };
    for (const key of new Set([...Object.keys(removed), ...Object.keys(added)])) result[key] = Math.max(0, (base[key] ?? 0) - (removed[key] ?? 0) + (added[key] ?? 0));
    return result;
  };
  const history = next ? [next, ...logs] : logs.filter(log => log.entryDate !== date);
  const latest = [...latestDailyLogs(history).values()].sort((a, b) => b.entryDate.localeCompare(a.entryDate))[0];
  const costs = { ...current.cumulativeCosts };
  for (const key of COST_COMPONENTS) costs[key] = Math.max(0, costs[key] - (old?.costs[key] ?? 0) + (added?.costs[key] ?? 0));
  const progress: TaskProgressToday = { ...current,
    cumulativeQuantityCompleted: Math.max(0, current.cumulativeQuantityCompleted - (old?.quantityCompleted ?? 0) + (added?.quantityCompleted ?? 0)),
    cumulativeCosts: costs,
    cumulativeUnplannedMaterialCost: Math.max(0, (current.cumulativeUnplannedMaterialCost ?? 0)
      - (old?.unplannedMaterials ?? []).reduce((sum, row) => sum + row.quantity * row.unitCost, 0)
      + (added?.unplannedMaterials ?? []).reduce((sum, row) => sum + row.quantity * row.unitCost, 0)),
    cumulativeMaterialUsage: deltaMap(current.cumulativeMaterialUsage, old?.materialUsage, added?.materialUsage),
    cumulativeEquipmentCostSpend: deltaMap(current.cumulativeEquipmentCostSpend, old?.equipmentCostSpend, added?.equipmentCostSpend),
    cumulativeOtherCostSpend: deltaMap(current.cumulativeOtherCostSpend, old?.otherCostSpend, added?.otherCostSpend),
    loggedDates: [...new Set([...current.loggedDates.filter(day => day !== date), ...(next ? [date] : [])])].sort(),
    today: date === today ? added : current.today,
    todayAttendance: date === today ? (next?.attendance.map(row => ({ workerId: row.workerId ?? null, workerName: row.name, hours: row.hours })) ?? []) : current.todayAttendance,
    latest: latest ? { ...dayEntry(latest), entryDate: latest.entryDate, savedByName: latest.savedByName } : null,
  };
  return { progress, history };
}
