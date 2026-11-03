import { rowPredecessors } from "@/lib/cost-estimate/dependency-model";
import type { CostEstimate } from "@/lib/cost-estimate/data";
import { computeExpectedProgress, countWorkingDays, toLocalDate, sumCosts, scheduleStatusFor } from "@/lib/task-progress/calculate";
import { deriveProjectStatusFromProgress } from "@/lib/projects/status";
import { assessProjectSchedule } from "@/lib/projects/schedule-assessment";
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
    ? category.tasks.map(task => ({ key: `task-${task.id}`, name: clean(task.name), start: task.plannedStartDate, end: task.plannedEndDate, actual: task.percentComplete, weight: task.weight, milestone: task.isMilestone, predecessors: rowPredecessors(task).map(ref => `${ref.kind}-${ref.id}`) }))
    : [{ key: `category-${category.id}`, name: clean(category.name), start: category.plannedStartDate, end: category.plannedEndDate, actual: category.percentComplete, weight: category.weight, milestone: category.isMilestone, predecessors: rowPredecessors(category).map(ref => `${ref.kind}-${ref.id}`) }]);
  const byKey = new Map(items.map(item => [item.key, item]));
  for (const category of estimate.categories.filter(row => row.tasks.length > 0)) byKey.set(`category-${category.id}`, {
    key: `category-${category.id}`, name: clean(category.name), start: category.plannedStartDate, end: category.plannedEndDate,
    actual: category.percentComplete, weight: category.weight, milestone: false, predecessors: rowPredecessors(category).map(ref => `${ref.kind}-${ref.id}`),
  });
  const facts: InsightFact[] = [];
  const add = (destination: ProjectInsightDestination, id: string, title: string, evidence: string, recommendedAction?: string) => {
    if (facts.filter(fact => fact.destination === destination).length < 5) facts.push({ id, title, evidence, destination, ...(recommendedAction ? { recommendedAction } : {}) });
  };
  const inProgress = !project.archived_at && !estimate.lifecycle.allItemsComplete;
  const scheduled = items.filter(item => item.start && item.end && item.start <= item.end);
  const expected = new Map(scheduled.map(item => [item.key, computeExpectedProgress({ plannedStartDate: item.start, plannedEndDate: item.end, workingDays, holidays, today }).timePercent]));
  const validLogs = source.logs.filter(log => byKey.has(log.itemKey) && log.entryDate <= asOfDate);
  const loggedItems = new Set(validLogs.map(log => log.itemKey));
  const latestLogDate = validLogs.map(log => log.entryDate).sort().at(-1) ?? null;
  const records = (prefix: string) => Object.fromEntries(items.filter(item => item.key.startsWith(prefix)).map(item => [Number(item.key.slice(prefix.length)), {
    loggedDates: source.logs.filter(log => log.itemKey === item.key).map(log => log.entryDate),
  }]));
  const assessment = assessProjectSchedule({ project: { startDate: project.start_date, targetEndDate: project.target_end_date,
    actualEndDate: project.actual_end_date, workingDays, holidays }, categories: estimate.categories,
    taskRecords: records("task-"), categoryRecords: records("category-"), today: asOfDate });
  const schedule = { risk: assessment.risk, reason: assessment.reason, targetDate: project.target_end_date,
    forecastDate: assessment.forecastDate, differenceDays: assessment.differenceDays, delayedTasks: assessment.delayedTasks };
  const forecastEvidence = assessment.forecastDate
    ? `The system-calculated completion is ${assessment.forecastDate}, compared with the official target ${project.target_end_date}: ${Math.abs(assessment.differenceDays ?? 0)} calendar days ${(assessment.differenceDays ?? 0) > 0 ? "beyond" : (assessment.differenceDays ?? 0) < 0 ? "before" : "from"} the target. Delay risk is ${assessment.risk}.`
    : `The system cannot provide a completion forecast or delay-risk rating: ${assessment.reason}`;
  if (assessment.risk === "unassessed") add("schedule", "forecast-readiness", "Complete the records needed for forecasting", forecastEvidence,
    "Review the stated assessment limitation, confirm task dates and dependencies, and update verified daily accomplishments before relying on a forecast.");
  else if (assessment.risk === "high" || assessment.risk === "medium") {
    const affected = items.map(item => ({ item, forecast: assessment.taskForecasts[item.key.replace("task-", "task:").replace("category-", "category:")] }))
      .filter(row => row.forecast && row.forecast.differenceDays > 0).sort((a,b) => b.forecast.differenceDays - a.forecast.differenceDays).slice(0,3);
    add("schedule", "completion-forecast", "Review the projected finish and deadline", `${forecastEvidence} ${assessment.reason}${affected.length ? ` Tasks projected beyond their planned finish include ${affected.map(row => `${row.item.name} (${row.forecast.forecastDate}, ${row.forecast.differenceDays} calendar days behind its plan)`).join("; ")}. These are review candidates, not a verified critical-path ranking.` : ""}`,
      assessment.risk === "high" ? "Review the delayed task forecasts and their predecessor links with the foreman, confirm the remaining work and available resources, and agree on a recovery plan against the official deadline. Forecasts do not change planned dates."
        : "Verify the tasks behind their planned progress, review their remaining work and dependencies, and protect the remaining time before the official deadline. Do not treat available time as proof that no recovery action is needed.");
  }
  const examples = (rows: typeof items) => rows.slice(0, 3).map(item => item.name).join(", ");
  const undated = items.filter(item => !item.start || !item.end || item.start > item.end);
  // This is a review heuristic, not proof of an imported/default schedule.
  // One-day tasks and milestones are legitimate. Flag only a repeated pattern
  // affecting at least half the non-milestone schedule, without saved evidence.
  const ordinary = scheduled.filter(item => !item.milestone);
  const sameDay = ordinary.filter(item => item.start === project.start_date && item.end === project.start_date && item.actual === 0 && !loggedItems.has(item.key));
  const datesNeedReview = inProgress && sameDay.length >= 3 && sameDay.length >= ordinary.length / 2;
  const reviewKeys = new Set(datesNeedReview ? sameDay.map(item => item.key) : []);
  const dueWithoutLogs = scheduled.filter(item => item.actual < 100 && item.start! <= asOfDate && !loggedItems.has(item.key));

  if (inProgress) {
    if (undated.length) add("schedule", "missing-dates", "Complete the task schedules", `${undated.length} work items have missing or invalid planned dates, including ${examples(undated)}. These items cannot be compared reliably against the schedule.`,
      "Confirm the planned start and finish dates with the project manager before assessing schedule performance.");
    if (datesNeedReview) add("schedule", "schedule-readiness", "Review repeated single-day schedules", `${sameDay.length} work items share the project start date (${project.start_date}) as both start and finish, including ${examples(sameDay)}. These may be initial/default dates; they have not been verified. A 100% date-based comparison does not establish that site work is delayed.`,
      "Confirm whether these are intentional one-day activities. If they are initial dates, enter the agreed task durations and dates before using them to assess delays.");
    if (dueWithoutLogs.length) add("progress", "missing-progress", "Verify accomplishments and update missing logs", `${dueWithoutLogs.length} work items are scheduled to have started but have no saved progress log, including ${examples(dueWithoutLogs)}. Missing logs do not establish that work was or was not performed.`,
      "Check actual site accomplishments with the foreman and save the verified daily logs. Confirm task dates before deciding whether recovery work is needed.");

    const behind = scheduled.filter(item => !reviewKeys.has(item.key) && (loggedItems.has(item.key) || item.actual > 0) && item.actual < 100 && scheduleStatusFor(item.actual, expected.get(item.key) ?? 0) === "behind")
      .sort((a, b) => ((expected.get(b.key) ?? 0) - b.actual) - ((expected.get(a.key) ?? 0) - a.actual));
    if (behind.length) add("schedule", "recorded-progress-gap", "Recorded progress is below the planned schedule",
      `${behind.length} work items with saved accomplishment evidence are below their date-based comparison as of ${asOfDate}. ${behind.slice(0,3).map(item => `${item.name}: ${round(item.actual)}% saved versus ${round(expected.get(item.key) ?? 0)}% expected (${item.start} to ${item.end})`).join("; ")}.`,
      "Confirm the latest site accomplishments and planned dates with the foreman. Review the remaining work and dependency links before agreeing on recovery actions.");
    const dependency = items.find(item => item.predecessors.length > 0 && item.actual < 100 && !reviewKeys.has(item.key) &&
      (item.actual > 0 || (loggedItems.has(item.key) && !!item.start && item.start <= asOfDate)) && item.predecessors.some(key => (byKey.get(key)?.actual ?? 100) < 100));
    if (dependency) add("schedule", "unfinished-predecessor", "Review a task dependency", `${dependency.name} has saved accomplishment evidence and is scheduled to start by ${asOfDate} or has positive saved progress, while its recorded predecessor ${dependency.predecessors.map(key => byKey.get(key)).filter(row => row && row.actual < 100).map(row => row!.name).join(", ")} is still below 100% saved completion. Verify the records and dependency; this does not prove work is blocked or that the task is on a critical path.`);
  }

  const actualCosts = estimate.summary.costsToDate;
  const actualTotal = sumCosts(actualCosts);
  const plannedTotal = estimate.summary.totalEstimatedCost;
  if (project.allocated_budget !== null && actualTotal > project.allocated_budget) add("costs", "allocated-budget", "Recorded spending exceeds the allocated budget", `${money(actualTotal)} in saved actual costs exceeds the allocated project budget of ${money(project.allocated_budget)} by ${money(actualTotal - project.allocated_budget)}.`);
  if (plannedTotal > 0 && actualTotal > plannedTotal) add("costs", "planned-total", "Recorded spending exceeds Planned costs", `${money(actualTotal)} in saved actual costs exceeds the total Planned cost of ${money(plannedTotal)}. Planned costs and the allocated project budget are separate figures.`);
  for (const component of ["labor", "material", "equipment", "other"] as const) {
    const actual = actualCosts[component], planned = estimate.summary.totalsByColumn[component];
    if (plannedTotal > 0 && actual > planned) add("costs", `cost:${component}`, `${component[0].toUpperCase() + component.slice(1)} costs need review`, `Saved actual ${component} cost is ${money(actual)}, compared with ${money(planned)} Planned. Actual material cost already includes priced material usage; purchases must not be added to this figure again.`);
  }
  if (inProgress && items.length && plannedTotal <= 0) add("costs", "no-planned-cost", "Complete the Planned cost estimates", "Work items exist but total Planned cost is zero. Confirm whether estimates are incomplete or zero costs are intentional. Cost-weighted progress and comparisons against Planned costs are unavailable; this does not establish budget performance.",
    "Review and complete the applicable planned labor, material, equipment and other costs. Keep the allocated project budget separate from these estimates.");

  // Repeated management assignments are normal supervision, so the loader
  // includes only skilled workers/subcontractors in this overlap check.
  const overlapping = (left: string, right: string) => {
    const a = byKey.get(left), b = byKey.get(right);
    if (!a || !b || a.key === b.key || a.actual >= 100 || b.actual >= 100 || a.milestone || b.milestone || reviewKeys.has(a.key) || reviewKeys.has(b.key) || !a.start || !a.end || !b.start || !b.end) return false;
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

  // Record setup issues appear first; verified spending and project reviews follow.
  const readinessOrder: Record<string,number> = { "missing-dates": 0, "schedule-readiness": 1, "no-planned-cost": 2, "missing-progress": 3, "forecast-readiness": 4, "completion-forecast": 4 };
  facts.sort((a,b) => (readinessOrder[a.id] ?? 10) - (readinessOrder[b.id] ?? 10));
  const status = deriveProjectStatusFromProgress(estimate.lifecycle);
  const completedCount = items.filter(item => item.actual >= 100).length;
  const executiveSummary = [
    `${clean(project.project_name)} is ${project.archived_at ? "archived with recorded status" : "marked"} ${status}, with ${items.length} work items and ${completedCount} at 100% saved completion.`,
    validLogs.length ? `${validLogs.length} saved progress ${validLogs.length === 1 ? "entry is" : "entries are"} available, most recently dated ${latestLogDate}.` : "No saved progress logs are available; confirm site accomplishments before drawing conclusions about work performed.",
    datesNeedReview ? `${sameDay.length} work items share single-day dates at the project start and need schedule verification.` : undated.length ? `${undated.length} work items need complete planned dates.` : "",
    plannedTotal > 0 ? `Planned cost is ${money(plannedTotal)} and saved actual cost is ${money(actualTotal)}.` : `Total Planned cost is zero; complete or confirm the estimates before using cost-weighted progress or cost comparisons. Saved actual cost is ${money(actualTotal)}.`,
    forecastEvidence,
  ].filter(Boolean).join(" ");

  return {
    projectId: project.id,
    asOfDate,
    executiveSummary,
    schedule,
    readiness: { datesNeedReview, undatedWorkItemCount: undated.length, startedWithoutLogsCount: dueWithoutLogs.length, hasSavedLogs: validLogs.length > 0, hasPlannedCosts: plannedTotal > 0 },
    project: { name: clean(project.project_name), status, archived: !!project.archived_at, startDate: project.start_date, targetEndDate: project.target_end_date, recordedEndDate: project.actual_end_date },
    summary: {
      workItemCount: items.length,
      milestoneCount: items.filter(item => item.milestone).length,
      completedWorkItemCount: completedCount,
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
