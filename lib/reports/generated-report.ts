import type { CloseoutReportData } from "./closeout-data";
import { dayVariance, isDateOnly } from "./closeout-model";

export const REPORT_SECTIONS = [
  { id: "summary", label: "Project lifecycle summary" },
  { id: "outcomes", label: "Final outcomes" },
  { id: "milestones", label: "Key milestones met" },
  { id: "lessons", label: "Lessons learned" },
  { id: "performance", label: "Overall performance" },
] as const;
export type ReportSectionId = typeof REPORT_SECTIONS[number]["id"];
export const MILESTONE_COLUMNS = ["Milestone", "Phase", "Planned date", "Recorded achievement", "Variance (days)"] as const;
export type ReportOptions = { title: string; sections: ReportSectionId[]; columns: string[]; from: string; to: string };
export type GeneratedReport = {
  title: string; project: string; asOf: string;
  sections: { title: string; paragraphs: string[]; headers: string[]; rows: (string | number)[][] }[];
};

export function generateReport(data: CloseoutReportData, options: ReportOptions): GeneratedReport {
  if (!options.title.trim()) throw new Error("Enter a report title.");
  if (!options.sections.length) throw new Error("Select at least one section.");
  const milestones = options.sections.includes("milestones");
  if (milestones && (!options.columns.length || options.columns.some(c => !MILESTONE_COLUMNS.includes(c as typeof MILESTONE_COLUMNS[number])))) throw new Error("Select at least one valid milestone column.");
  if (milestones && ((options.from && !isDateOnly(options.from)) || (options.to && !isDateOnly(options.to)) || (options.from && options.to && options.from > options.to))) throw new Error("Enter a valid milestone achievement date range.");
  const notes = data.record?.notes ?? {};
  const missing = "Not recorded";
  const variance = dayVariance(data.project.targetEndDate, data.project.actualEndDate);
  return {
    title: options.title.trim(), project: data.project.name, asOf: data.asOf,
    sections: REPORT_SECTIONS.filter(s => options.sections.includes(s.id)).map(section => {
      if (section.id === "summary") return { title: section.label, paragraphs: [notes.summary || missing], headers: ["Project start", "Target completion", "Recorded actual completion"], rows: [[data.project.startDate || missing, data.project.targetEndDate || missing, data.project.actualEndDate || missing]] };
      if (section.id === "outcomes" || section.id === "lessons") return { title: section.label, paragraphs: [notes[section.id] || missing], headers: [], rows: [] };
      if (section.id === "performance") return { title: section.label, paragraphs: [notes.performance || missing, "Completion follows the Gantt chart, including automatic progress. Milestones use recorded achievement dates."], headers: ["Gantt completion (%)", "Tracked work completed", "Total tracked work", "Completion variance (days)"], rows: [[Number(data.progressPercent.toFixed(2)), data.work.filter(w => w.percent >= 100).length, data.work.length, variance ?? missing]] };
      const rows = data.work.filter(w => {
        const achieved = data.record?.milestone_dates[w.key];
        return w.milestone && achieved && (!options.from || achieved >= options.from) && (!options.to || achieved <= options.to);
      }).map(w => {
        const achieved = data.record!.milestone_dates[w.key];
        const values = [w.name, w.phase, w.end || missing, achieved, dayVariance(w.end, achieved) ?? missing];
        return options.columns.map(c => values[MILESTONE_COLUMNS.indexOf(c as typeof MILESTONE_COLUMNS[number])]);
      });
      return { title: section.label, paragraphs: [...(options.from || options.to ? [`Achievement dates: ${options.from || "Any"} to ${options.to || "Any"}`] : []), ...(!rows.length ? ["No recorded milestone achievements match this selection."] : []), "Positive variance means late; negative means early."], headers: options.columns, rows };
    }),
  };
}
