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
export function selectedBarChanges(selected: ReadonlySet<string>, rows: Task[], categories: CostCategory[], days: number): ScheduleDateChange[] {
  if (!Number.isInteger(days) || days === 0) return [];
  const wanted = new Set(selected);
  for (const row of rows) {
    if (row.project && selected.has(row.project)) wanted.add(row.id);
  }
  const changes: ScheduleDateChange[] = [];
  for (const row of rows) {
    if (!wanted.has(row.id) || row.type === "project" || row.isDisabled) continue;
    const category = categories.find(c => `phase-${c.id}` === row.id && c.tasks.length === 0);
    const task = category ? undefined : categories.flatMap(c => c.tasks).find(t => String(t.id) === row.id);
    const source = category ?? task;
    if (!source || source.id <= 0) continue;
    const start = shiftScheduleDate(day(row.start), days);
    const end = shiftScheduleDate(day(row.end), days - (row.type === "milestone" ? 0 : 1));
    if (!isScheduleDate(start) || !isScheduleDate(end)) throw new Error("Selected schedules must stay between 1980 and 2100.");
    changes.push({ kind: category ? "category" : "task", id: source.id, start, end,
      previousStart: source.plannedStartDate, previousEnd: source.plannedEndDate });
  }
  return changes;
}
