import type { Task } from "gantt-task-react";
import type { CostCategory } from "@/lib/cost-estimate/data";
import { isScheduleDate, shiftScheduleDate, type ScheduleDateChange } from "@/lib/cost-estimate/schedule-dates";

const day = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Same calendar-day snap as gantt-task-react, including its first month/year interval. */
export function barDragDays(pixels: number, columnWidth: number, view: string, first: Date) {
  let days = 1;
  if (view === "week") days = 7;
  if (view === "month") days = new Date(first.getFullYear(), first.getMonth(), 0).getDate();
  if (view === "year") {
    const year = first.getFullYear() - 1;
    days = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86_400_000;
  }
  return Math.round(pixels * days / columnWidth);
}

/** Summary bars move their children; overlapping selections move each saved row once. */
export function selectedBarChanges(selected: ReadonlySet<string>, rows: Task[], categories: CostCategory[], days: number,
  previousDates: ReadonlyMap<string, { start: string; end: string }> = new Map()): ScheduleDateChange[] {
  if (!Number.isInteger(days) || days === 0) return [];
  const wanted = new Set(selected);
  for (const row of rows) {
    if (row.project && selected.has(row.project)) wanted.add(row.id);
  }
  const changes: ScheduleDateChange[] = [];
  const sources = new Map<string, { kind: "category" | "task"; source: Pick<CostCategory, "id" | "plannedStartDate" | "plannedEndDate"> }>();
  for (const category of categories) {
    if (category.tasks.length === 0) sources.set(`phase-${category.id}`, { kind: "category", source: category });
    for (const task of category.tasks) sources.set(String(task.id), { kind: "task", source: task });
  }
  for (const row of rows) {
    if (!wanted.has(row.id) || row.type === "project" || row.isDisabled) continue;
    const entry = sources.get(row.id);
    const source = entry?.source;
    if (!source || source.id <= 0) continue;
    const start = shiftScheduleDate(day(row.start), days);
    const end = shiftScheduleDate(day(row.end), days - (row.type === "milestone" ? 0 : 1));
    if (!isScheduleDate(start) || !isScheduleDate(end)) throw new Error("Selected schedules must stay between 1980 and 2100.");
    const previous = previousDates.get(row.id);
    changes.push({ kind: entry!.kind, id: source.id, start, end,
      previousStart: previous?.start ?? source.plannedStartDate, previousEnd: previous?.end ?? source.plannedEndDate });
  }
  return changes;
}
