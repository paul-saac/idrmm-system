import type { CostCategory } from "@/lib/cost-estimate/data";
import type { ProjectRow } from "@/lib/projects/data";

type Records = Record<number, { loggedDates: readonly string[] }>;
export type ScheduleAssessment = {
  risk: "low" | "medium" | "high" | "unassessed" | "completed";
  reason: string;
  forecastDate: string | null;
  differenceDays: number | null;
  delayedTasks: number;
  lastRecordedDate: string | null;
  method: string;
};
type Node = {
  key: string; name: string; start: string; end: string; percent: number;
  milestone: boolean; virtual: boolean; dependencies: string[]; dates: string[];
};
const DAY = 86_400_000;
const ordinal = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY;
const iso = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);
function validDate(value: string | null | undefined): value is string {
  return !!value && value >= "1980-01-01" && value <= "2100-12-31" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(ordinal(value)) && iso(ordinal(value)) === value;
}

/** Read-only, dependency-aware remaining-duration projection. Never writes dates,
 * progress, or project status. The risk bands are rules, not probabilities.
 */
export function assessProjectSchedule({ project, categories, taskRecords, categoryRecords, today }: {
  project: Pick<ProjectRow, "startDate" | "targetEndDate" | "actualEndDate" | "workingDays" | "holidays">;
  categories: CostCategory[]; taskRecords: Records; categoryRecords: Records; today: string;
}): ScheduleAssessment {
  const result: ScheduleAssessment = { risk: "unassessed", reason: "Add a project schedule and task dates.", forecastDate: null,
    differenceDays: null, delayedTasks: 0, lastRecordedDate: null,
    method: "Recorded progress per elapsed working day; unstarted work uses its planned duration. Finish-to-start dependencies and the project work calendar apply. Dates are estimates; the official schedule is unchanged." };
  if (!validDate(today) || !validDate(project.startDate) || !validDate(project.targetEndDate)
    || project.targetEndDate < project.startDate) return result;
  const weekdays = new Set(project.workingDays.filter(day => Number.isInteger(day) && day >= 1 && day <= 7));
  const holidays = new Set(project.holidays);
  const working = (day: number) => weekdays.has(new Date(day * DAY).getUTCDay() || 7) && !holidays.has(iso(day));
  if (!weekdays.size) return { ...result, reason: "Set at least one project working day." };
  const counts = new Map<string, number>();
  const count = (start: string, end: string) => {
    const key = `${start}/${end}`;
    if (!counts.has(key)) {
      let total = 0;
      for (let day = ordinal(start); day <= ordinal(end); day++) if (working(day)) total++;
      counts.set(key, total);
    }
    return counts.get(key)!;
  };
  const nextWorking = (date: string, after = false) => {
    let day = ordinal(date) + Number(after);
    for (let i = 0; i <= 3660; i++, day++) if (working(day)) return iso(day);
    throw new Error("Calendar has no available working days.");
  };
  const finishAfter = (start: string, duration: number) => {
    let day = ordinal(start), remaining = duration;
    for (let i = 0; i <= 3660; i++, day++) {
      if (working(day) && --remaining <= 0) return iso(day);
    }
    throw new Error("The recorded pace projects more than ten years of remaining work.");
  };
  const nodes = new Map<string, Node>();
  let invalid = false;
  const dependency = (row: { predecessorTaskId?: number | null; predecessorCategoryId?: number | null }) =>
    row.predecessorTaskId != null ? [`task:${row.predecessorTaskId}`]
      : row.predecessorCategoryId != null ? [`category:${row.predecessorCategoryId}`] : [];
  function leaf(key: string, row: CostCategory | CostCategory["tasks"][number], records: Records, extra: string[] = []) {
    if (!validDate(row.plannedStartDate) || !validDate(row.plannedEndDate) || row.plannedEndDate < row.plannedStartDate
      || !Number.isFinite(row.percentComplete) || row.percentComplete < 0 || row.percentComplete > 100) { invalid = true; return; }
    const dates = [...new Set(records[row.id]?.loggedDates ?? [])].filter(validDate).sort();
    if (dates.some(date => date > today)) invalid = true;
    nodes.set(key, { key, name: row.name, start: row.plannedStartDate, end: row.plannedEndDate, percent: row.percentComplete,
      milestone: row.isMilestone, virtual: false, dependencies: [...dependency(row), ...extra], dates });
  }
  for (const category of categories) {
    const key = `category:${category.id}`;
    if (!category.tasks.length) leaf(key, category, categoryRecords);
    else {
      // Separate start/finish gates keep summary tasks out of progress totals,
      // while successors correctly wait for the whole group's completion.
      const start = `${key}:start`;
      const gate = { name: category.name, start: project.startDate, end: project.startDate, percent: 0,
        milestone: true, virtual: true, dates: [] };
      nodes.set(start, { ...gate, key: start, dependencies: dependency(category) });
      for (const task of category.tasks) leaf(`task:${task.id}`, task, taskRecords, [start]);
      nodes.set(key, { ...gate, key, dependencies: category.tasks.map(task => `task:${task.id}`) });
    }
  }
  if (invalid) return { ...result, reason: "Review missing/invalid task dates or future-dated progress records." };
  const leaves = [...nodes.values()].filter(node => !node.virtual);
  if (!leaves.length) return { ...result, reason: "Add scheduled tasks before assessing the project." };
  if (leaves.some(node => !node.milestone && count(node.start, node.end) === 0)) return { ...result, reason: "A task has no working days within its planned dates." };
  // Kahn's traversal also validates cycles and missing references in O(V+E).
  const remaining = new Map<string, number>(), successors = new Map<string, string[]>();
  for (const node of nodes.values()) {
    node.dependencies = [...new Set(node.dependencies)];
    remaining.set(node.key, node.dependencies.length);
    for (const predecessor of node.dependencies) {
      if (!nodes.has(predecessor)) return { ...result, reason: "A task dependency is missing. Review the task links." };
      const following = successors.get(predecessor) ?? [];
      following.push(node.key); successors.set(predecessor, following);
    }
  }
  const ready = [...nodes.keys()].filter(key => remaining.get(key) === 0), order: Node[] = [];
  for (let i = 0; i < ready.length; i++) {
    const node = nodes.get(ready[i])!; order.push(node);
    for (const next of successors.get(node.key) ?? []) {
      remaining.set(next, remaining.get(next)! - 1);
      if (!remaining.get(next)) ready.push(next);
    }
  }
  if (order.length !== nodes.size) return { ...result, reason: "A circular dependency prevents a reliable forecast." };
  const loggedDates = leaves.flatMap(node => node.dates).sort();
  result.lastRecordedDate = loggedDates.at(-1) ?? null;
  if (!result.lastRecordedDate) return { ...result, reason: "Insufficient data — save a progress log first." };
  if (leaves.some(node => node.percent > 0 && !node.dates.length)) return { ...result, reason: "Recorded progress needs dated logs for each started task." };
  const allCompleted = leaves.every(node => node.percent >= 100);
  if (allCompleted) {
    if (leaves.some(node => !node.dates.length)) return { ...result, reason: "Completion needs saved progress records for every task." };
    const finish = validDate(project.actualEndDate) && project.actualEndDate <= today ? project.actualEndDate : result.lastRecordedDate;
    return { ...result, risk: "completed", reason: "All tasks are complete based on saved progress.", forecastDate: finish,
      differenceDays: ordinal(finish) - ordinal(project.targetEndDate) };
  }
  if (count(result.lastRecordedDate, today) - Number(working(ordinal(result.lastRecordedDate))) > 2)
    return { ...result, reason: "Progress records are more than two working days old. Update the logs." };
  for (const node of leaves) {
    if (node.percent >= 100 || today < node.start) continue;
    const duration = count(node.start, node.end);
    if (!node.milestone && !duration) return { ...result, reason: "A task has no working days within its planned dates." };
    const expected = today >= node.end ? 100 : node.milestone ? 0 : Math.min(100, count(node.start, today) / duration * 100);
    if (expected - node.percent > 5) result.delayedTasks++;
  }
  const finishes = new Map<string, string>();
  try {
    for (const node of order) {
      const predecessorFinish = node.dependencies.map(key => finishes.get(key)!).sort().at(-1);
      if (node.virtual) {
        finishes.set(node.key, node.key.endsWith(":start") && predecessorFinish ? nextWorking(predecessorFinish, true)
          : predecessorFinish ?? project.startDate); continue;
      }
      const lastLog = node.dates.at(-1);
      if (node.percent >= 100) {
        if (!lastLog) return { ...result, reason: "A completed task has no dated progress record." };
        finishes.set(node.key, lastLog); continue;
      }
      const duration = count(node.start, node.end);
      const elapsed = lastLog ? Math.max(1, count([node.start, node.dates[0]].sort()[0], lastLog)) : 0;
      const remainingDays = node.percent > 0 && elapsed > 0
        ? Math.max(1, Math.ceil((100 - node.percent) / (node.percent / elapsed)))
        : Math.max(1, duration);
      if (node.milestone) {
        finishes.set(node.key, [node.end, today, predecessorFinish ?? node.start].sort().at(-1)!);
      } else {
        const afterLog = lastLog === today ? nextWorking(today, true) : nextWorking(today);
        const dependencyStart = node.dependencies.map(key => key.endsWith(":start")
          ? finishes.get(key)! : nextWorking(finishes.get(key)!, true)).sort().at(-1) ?? node.start;
        const start = nextWorking([node.start, afterLog, dependencyStart].sort().at(-1)!);
        finishes.set(node.key, finishAfter(start, remainingDays));
      }
    }
  } catch (error) {
    return { ...result, reason: error instanceof Error ? error.message : "The schedule cannot be projected reliably." };
  }
  const finish = leaves.map(node => finishes.get(node.key)!).sort().at(-1)!;
  const difference = ordinal(finish) - ordinal(project.targetEndDate);
  const risk = difference > 0 ? "high" : result.delayedTasks ? "medium" : "low";
  return { ...result, risk, forecastDate: finish, differenceDays: difference,
    reason: risk === "high" ? "The current projection extends beyond the official target."
      : risk === "medium" ? "Some tasks are behind; the projected finish still fits the target."
        : "Recorded progress and remaining work fit within the target." };
}
