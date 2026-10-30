import type { CostEstimate } from "@/lib/cost-estimate/data";
import { computeExpectedProgress, countWorkingDays, toLocalDate, sumCosts, scheduleStatusFor } from "@/lib/task-progress/calculate";
import { deriveProjectStatusFromProgress } from "@/lib/projects/status";
import type { InsightFact, ProjectInsightDestination } from "./types";

export type InsightProject = {
  id: number;
  project_name: string;
  start_date: string | null;
  target_end_date: string | null;
  actual_end_date: string | null;
  allocated_budget: number | null;
  archived_at: string | null;
  working_days: number[] | null;
  holidays: string[] | null;
};

export type InsightSources = {
  project: InsightProject;
  estimate: CostEstimate;
  logs: { itemKey: string; entryDate: string }[];
  workers: { itemKey: string; workerId: number }[];
  equipment: { itemKey: string; equipmentId: number; name: string }[];
  documents: { sheet_number: string; document_type: string; revision: number; status: string; id: number }[];
};

const clean = (text: string) => text.replace(/[\u0000-\u001f]/g, " ").slice(0, 140);
const round = (value: number) => Math.round(value * 100) / 100;
const money = (value: number) => `PHP ${round(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Matches the workspace's leaf items: a parent with subtasks is never counted twice. */
export function buildInsightContext(source: InsightSources, now = new Date()) {
  const { project, estimate } = source;
  const asOfDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const today = toLocalDate(asOfDate);
  const workingDays = project.working_days ?? [1, 2, 3, 4, 5, 6];
  const holidays = project.holidays ?? [];
  const items = estimate.categories.flatMap(category => category.tasks.length
    ? category.tasks.map(task => ({ key: `task-${task.id}`, name: clean(task.name), start: task.plannedStartDate, end: task.plannedEndDate, actual: task.percentComplete, weight: task.weight, milestone: task.isMilestone, predecessor: task.predecessorTaskId ? `task-${task.predecessorTaskId}` : null }))
    : [{ key: `category-${category.id}`, name: clean(category.name), start: category.plannedStartDate, end: category.plannedEndDate, actual: category.percentComplete, weight: category.weight, milestone: category.isMilestone, predecessor: category.predecessorCategoryId ? `category-${category.predecessorCategoryId}` : null }]);
  const byKey = new Map(items.map(item => [item.key, item]));
  const facts: InsightFact[] = [];
  const add = (destination: ProjectInsightDestination, id: string, title: string, evidence: string) => {
    if (facts.filter(fact => fact.destination === destination).length < 5) facts.push({ id, title, evidence, destination });
  };
  const inProgress = !project.archived_at && !estimate.lifecycle.allItemsComplete;
  const scheduled = items.filter(item => item.start && item.end && item.start <= item.end);
  const expected = new Map(scheduled.map(item => [item.key, computeExpectedProgress({ plannedStartDate: item.start, plannedEndDate: item.end, workingDays, holidays, today }).timePercent]));

  if (inProgress) {
    const behind = scheduled.filter(item => item.actual < 100 && scheduleStatusFor(item.actual,expected.get(item.key) ?? 0) === "behind")
      .sort((a,b) => ((expected.get(b.key) ?? 0) - b.actual) - ((expected.get(a.key) ?? 0) - a.actual));
    for (const item of behind.slice(0, 3)) add("schedule", `behind:${item.key}`, `${item.name}: progress below schedule`,
      `Saved actual progress is ${round(item.actual)}%; the date-based comparison is ${round(expected.get(item.key) ?? 0)}% as of ${asOfDate}. Planned dates: ${item.start} to ${item.end}. The comparison is a read-only baseline, not recorded work or a completion forecast.`);
    const undated = items.filter(item => !item.start || !item.end || item.start > item.end);
    if (undated.length) add("schedule", "missing-dates", "Incomplete task schedules", `${undated.length} work items have missing or invalid planned dates, including ${undated.slice(0,3).map(item => item.name).join(", ")}. Their schedule position cannot be assessed reliably.`);
    const dependency = items.find(item => item.predecessor && item.actual < 100 && (item.actual > 0 || !!item.start && item.start <= asOfDate) && (byKey.get(item.predecessor)?.actual ?? 100) < 100);
    if (dependency) add("schedule", "unfinished-predecessor", "Review a task dependency", `${dependency.name} has started in saved progress or is scheduled to start by ${asOfDate}, while its recorded predecessor ${byKey.get(dependency.predecessor!)!.name} is still below 100% saved completion. This is a dependency to review, not proof that work is blocked.`);
  }

  const validLogs = source.logs.filter(log => byKey.has(log.itemKey) && log.entryDate <= asOfDate);
  const loggedItems = new Set(validLogs.map(log => log.itemKey));
  const latestLogDate = validLogs.map(log => log.entryDate).sort().at(-1) ?? null;
  const dueWithoutLogs = scheduled.filter(item => item.actual < 100 && item.start! <= asOfDate && !loggedItems.has(item.key));
  if (inProgress && dueWithoutLogs.length) add("progress", "missing-progress", "Work items without saved progress logs", `${dueWithoutLogs.length} work items are scheduled to have started but have no saved progress log, including ${dueWithoutLogs.slice(0,3).map(item => item.name).join(", ")}. Missing logs do not establish that work was or was not performed.`);

  const actualCosts = estimate.summary.costsToDate;
  const actualTotal = sumCosts(actualCosts);
  const plannedTotal = estimate.summary.totalEstimatedCost;
  if (project.allocated_budget !== null && actualTotal > project.allocated_budget) add("costs", "allocated-budget", "Recorded spending exceeds the allocated budget", `${money(actualTotal)} in saved actual costs exceeds the allocated project budget of ${money(project.allocated_budget)} by ${money(actualTotal - project.allocated_budget)}.`);
  if (plannedTotal > 0 && actualTotal > plannedTotal) add("costs", "planned-total", "Recorded spending exceeds Planned costs", `${money(actualTotal)} in saved actual costs exceeds the total Planned cost of ${money(plannedTotal)}. Planned costs and the allocated project budget are separate figures.`);
  for (const component of ["labor", "material", "equipment", "other"] as const) {
    const actual = actualCosts[component], planned = estimate.summary.totalsByColumn[component];
    if (actual > planned) add("costs", `cost:${component}`, `${component[0].toUpperCase() + component.slice(1)} costs need review`, `Saved actual ${component} cost is ${money(actual)}, compared with ${money(planned)} Planned. Actual material cost already includes priced material usage; purchases must not be added to this figure again.`);
  }
  if (items.length && plannedTotal <= 0) add("costs", "no-planned-cost", "Planned costs have not been recorded", "Work items exist but total Planned cost is zero. Cost-weighted project progress and comparisons against Planned costs need complete estimates.");

  // Repeated management assignments are normal supervision, so the loader
  // includes only skilled workers/subcontractors in this overlap check.
  const overlapping = (left: string, right: string) => {
    const a = byKey.get(left), b = byKey.get(right);
    if (!a || !b || a.key === b.key || a.actual >= 100 || b.actual >= 100 || a.milestone || b.milestone || !a.start || !a.end || !b.start || !b.end) return false;
    const start = [a.start, b.start, asOfDate].sort().at(-1)!;
    const end = a.end < b.end ? a.end : b.end;
    return start <= end && countWorkingDays(toLocalDate(start), toLocalDate(end), workingDays, new Set(holidays)) > 0;
  };
  if (inProgress) {
    const equipment = source.equipment.filter(row => byKey.has(row.itemKey));
    const workers = source.workers.filter(row => byKey.has(row.itemKey));
    const groups = [
      { rows: equipment.map(row => ({ id: row.equipmentId, key: row.itemKey, label: clean(row.name) })), kind: "equipment" },
      { rows: workers.map(row => ({ id: row.workerId, key: row.itemKey, label: "A skilled worker or subcontractor" })), kind: "worker" },
    ];
    for (const group of groups) {
      const seen = new Set<number>();
      for (let i=0;i<group.rows.length;i++) {
        const a = group.rows[i];
        if (seen.has(a.id)) continue;
        const b = group.rows.slice(i+1).find(b => a.id === b.id && overlapping(a.key,b.key));
        if (!b) continue;
        seen.add(a.id);
        add(group.kind === "equipment" ? "resources" : "schedule", `${group.kind}-overlap:${seen.size}`, "Overlapping planned resource assignments", `${a.label} is assigned to ${byKey.get(a.key)!.name} and ${byKey.get(b.key)!.name} on overlapping future/current working dates. This is a possible scheduling conflict; shifts and actual availability have not been verified.`);
      }
    }
  }

  // Review the latest version of each document, not superseded rejections.
  const latestDocuments = new Map<string, InsightSources["documents"][number]>();
  for (const document of source.documents) {
    const key = `${document.document_type}:${document.sheet_number}`;
    const previous = latestDocuments.get(key);
    if (!previous || document.revision > previous.revision || document.revision === previous.revision && document.id > previous.id) latestDocuments.set(key, document);
  }
  const documents = [...latestDocuments.values()];
  const submitted = documents.filter(document => document.status === "submitted").length;
  const changes = documents.filter(document => ["changes_requested", "rejected"].includes(document.status)).length;
  if (submitted) add("documents", "document-review", "Documents awaiting review", `${submitted} current project documents are submitted and awaiting review. This status does not establish authority approval or code compliance.`);
  if (changes) add("documents", "document-changes", "Documents need changes", `${changes} current project documents have changes requested or were rejected. Superseded document versions are excluded.`);

  return {
    projectId: project.id,
    asOfDate,
    project: { name: clean(project.project_name), status: deriveProjectStatusFromProgress(estimate.lifecycle), archived: !!project.archived_at, startDate: project.start_date, targetEndDate: project.target_end_date, recordedEndDate: project.actual_end_date },
    summary: {
      workItemCount: items.length,
      milestoneCount: items.filter(item => item.milestone).length,
      completedWorkItemCount: items.filter(item => item.actual >= 100).length,
      savedLogCount: validLogs.length,
      latestLogDate,
      costWeightedActualProgress: plannedTotal > 0 ? round(Math.min(100, items.reduce((sum,item) => sum + item.weight * item.actual / 100, 0))) : null,
      allocatedBudget: project.allocated_budget,
      plannedTotal: round(plannedTotal),
      savedActualTotal: round(actualTotal),
      plannedCosts: estimate.summary.totalsByColumn,
      savedActualCosts: actualCosts,
      currentDocumentCount: documents.length,
    },
    facts,
  };
}

export type InsightContext = ReturnType<typeof buildInsightContext>;
