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

export const AS_BUILT_SECTIONS = [
  { id: "as_built_summary", label: "Drawing & document summary" },
  { id: "as_built_register", label: "Master drawing & document register" },
  { id: "as_built_comparison", label: "Original vs. final as-built comparison" },
  { id: "as_built_changes", label: "Field changes & revision log" },
  { id: "as_built_approvals", label: "External stakeholder & admin sign-off" },
] as const;
export type AsBuiltSectionId = typeof AS_BUILT_SECTIONS[number]["id"];
export const AS_BUILT_COLUMNS = [
  "Reference",
  "Title",
  "Category / Discipline",
  "Baseline date",
  "Latest version",
  "Stage",
  "Revisions",
  "Status",
  "Stakeholder sign-off",
  "Submitted by",
] as const;
export type AsBuiltReportOptions = { title: string; sections: AsBuiltSectionId[]; columns: string[]; from: string; to: string };

export type GeneratedReport = {
  title: string; project: string; asOf: string;
  sections: { title: string; paragraphs: string[]; headers: string[]; rows: (string | number)[][] }[];
};

const DOC_TYPE_LABELS: Record<string, string> = {
  drawing: "Construction Drawings",
  bom: "Bill of Materials (BOM)",
  cost_estimate: "Cost Estimate",
  specifications: "Technical Specifications",
  other: "Other Supporting Documents",
};
const STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted for review",
  accepted: "Accepted for project records",
  changes_requested: "Changes requested",
  rejected: "Rejected",
};
const formatVersionLabel = (revision: number) => (revision <= 1 ? "Original" : `Revision ${revision - 1}`);
const formatStageLabel = (stage: string) => (stage === "as_built" ? "As-built" : stage === "original" ? "Original" : "Revision");

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

export function generateAsBuiltReport(data: CloseoutReportData, options: AsBuiltReportOptions): GeneratedReport {
  if (!options.title.trim()) throw new Error("Enter a report title.");
  if (!options.sections.length) throw new Error("Select at least one section.");
  const register = options.sections.includes("as_built_register");
  if (register && (!options.columns.length || options.columns.some(c => !AS_BUILT_COLUMNS.includes(c as typeof AS_BUILT_COLUMNS[number])))) {
    throw new Error("Select at least one valid register column.");
  }
  if ((options.from && !isDateOnly(options.from)) || (options.to && !isDateOnly(options.to)) || (options.from && options.to && options.from > options.to)) {
    throw new Error("Enter a valid submission date range.");
  }
  const missing = "Not recorded";
  const allSheets = [...(data.sheets ?? [])].sort((a, b) => a.sheet_number.localeCompare(b.sheet_number) || a.revision - b.revision);
  const sheets = allSheets.filter(s => {
    const submittedDate = (s.created_at || "").slice(0, 10);
    return (!options.from || submittedDate >= options.from) && (!options.to || submittedDate <= options.to);
  });

  const byReference = new Map<string, typeof sheets>();
  for (const sheet of sheets) {
    const list = byReference.get(sheet.sheet_number) ?? [];
    list.push(sheet);
    byReference.set(sheet.sheet_number, list);
  }
  const groups = [...byReference.entries()].map(([sheetNumber, versions]) => {
    const sorted = [...versions].sort((a, b) => a.revision - b.revision);
    return {
      sheetNumber,
      versions: sorted,
      baseline: sorted[0],
      latest: sorted[sorted.length - 1],
    };
  });

  return {
    title: options.title.trim(),
    project: data.project.name,
    asOf: data.asOf,
    sections: AS_BUILT_SECTIONS.filter(s => options.sections.includes(s.id)).map(section => {
      if (section.id === "as_built_summary") {
        const totalReferences = groups.length;
        const totalVersions = sheets.length;
        const drawingGroups = groups.filter(g => g.latest.document_type === "drawing");
        const documentGroups = groups.filter(g => g.latest.document_type !== "drawing");
        const revisedGroups = groups.filter(g => g.versions.length > 1);
        const asBuiltGroups = groups.filter(g => g.latest.stage === "as_built");
        const acceptedGroups = groups.filter(g => g.latest.status === "accepted");
        const pendingGroups = groups.filter(g => g.latest.status === "submitted");
        const changesRequestedGroups = groups.filter(g => g.latest.status === "changes_requested");
        const rejectedGroups = groups.filter(g => g.latest.status === "rejected");
        const stakeholderSignedVersions = sheets.filter(s => !!(s.external_name || s.approval_date)).length;

        const disciplineCounts = new Map<string, number>();
        for (const g of drawingGroups) {
          disciplineCounts.set(g.latest.discipline, (disciplineCounts.get(g.latest.discipline) ?? 0) + 1);
        }
        const categoryCounts = new Map<string, number>();
        for (const g of documentGroups) {
          const label = DOC_TYPE_LABELS[g.latest.document_type] ?? g.latest.document_type;
          categoryCounts.set(label, (categoryCounts.get(label) ?? 0) + 1);
        }

        const rangeNote = options.from || options.to
          ? `Scoped to submission dates from ${options.from || "project start"} to ${options.to || data.asOf}. `
          : "";
        const paragraphs = totalReferences === 0
          ? [`${rangeNote}No construction drawings or supporting project documents match this period as of ${data.asOf}.`]
          : [
              `${rangeNote}This report documents ${totalReferences} unique drawing and document reference(s) across ${totalVersions} total uploaded version(s) for ${data.project.name} as of ${data.asOf}. Initial uploads are recorded as Original baselines, and subsequent field or design updates are tracked sequentially starting from Revision 1.`,
              `Of the ${totalReferences} active reference(s), ${drawingGroups.length} are Construction Drawings and ${documentGroups.length} are supporting Project Documents. ${revisedGroups.length} reference(s) have recorded revisions beyond the Original baseline, ${asBuiltGroups.length} drawing(s) are designated at the final As-built stage, and ${acceptedGroups.length} latest record(s) have been formally accepted into project records.`,
            ];

        const rows: (string | number)[][] = [
          ["Unique references tracked", totalReferences, `${drawingGroups.length} Construction Drawings, ${documentGroups.length} Project Documents`],
          ["Total versions uploaded", totalVersions, `${groups.length} Original baselines, ${Math.max(0, totalVersions - groups.length)} subsequent revision(s)`],
          ["References with field revisions", revisedGroups.length, `${totalReferences - revisedGroups.length} remained unchanged from Original baseline`],
          ["Final as-built stage drawings", asBuiltGroups.length, "Construction drawings verified as final as-built records"],
          ["Accepted for project records (latest)", acceptedGroups.length, `${pendingGroups.length} submitted for review, ${changesRequestedGroups.length} changes requested, ${rejectedGroups.length} rejected`],
          ["Stakeholder-verified submissions", stakeholderSignedVersions, `Out of ${totalVersions} total version(s) uploaded`],
          ...[...disciplineCounts.entries()].map(([disc, count]) => [`Drawing discipline — ${disc}`, count, "Active construction drawing reference(s)"] as [string, number, string]),
          ...[...categoryCounts.entries()].map(([cat, count]) => [`Document category — ${cat}`, count, "Active supporting project document(s)"] as [string, number, string]),
        ];

        return {
          title: section.label,
          paragraphs,
          headers: ["Metric", "Count", "Details"],
          rows,
        };
      }

      if (section.id === "as_built_register") {
        const rows = groups.map(({ baseline, latest, versions }) => {
          const categoryOrDiscipline = latest.document_type === "drawing"
            ? `Drawing (${latest.discipline})`
            : (DOC_TYPE_LABELS[latest.document_type] ?? latest.document_type);
          const stakeholder = latest.external_name
            ? `${latest.external_name}${latest.external_role ? ` (${latest.external_role})` : ""}${latest.approval_date ? ` · ${latest.approval_date}` : ""}`
            : (latest.approval_date ? `Authorized Stakeholder · ${latest.approval_date}` : "Authorized Stakeholder (Signed & Verified)");
          const values = [
            latest.sheet_number,
            latest.title,
            categoryOrDiscipline,
            (baseline.created_at || "").slice(0, 10) || missing,
            formatVersionLabel(latest.revision),
            formatStageLabel(latest.stage),
            Math.max(0, versions.length - 1),
            STATUS_LABELS[latest.status] ?? latest.status,
            stakeholder,
            `${latest.submitted_name} (${(latest.created_at || "").slice(0, 10) || missing})`,
          ];
          return options.columns.map(c => values[AS_BUILT_COLUMNS.indexOf(c as typeof AS_BUILT_COLUMNS[number])]);
        });
        return {
          title: section.label,
          paragraphs: [
            ...(options.from || options.to ? [`Submission dates: ${options.from || "Any"} to ${options.to || "Any"}`] : []),
            ...(!rows.length
              ? ["No drawing or document records match this selection."]
              : [`Master index of the latest version for each of the ${groups.length} recorded reference(s), comparing the Original baseline date against the current active version and review status.`]),
          ],
          headers: options.columns,
          rows,
        };
      }

      if (section.id === "as_built_comparison") {
        const rows = groups.map(({ baseline, latest, versions }) => {
          const categoryOrDiscipline = latest.document_type === "drawing"
            ? latest.discipline
            : (DOC_TYPE_LABELS[latest.document_type] ?? latest.document_type);
          const revisionNotes = versions
            .filter(v => v.revision > 1 || v.change_notes.trim())
            .map(v => `${formatVersionLabel(v.revision)} (${formatStageLabel(v.stage)}): ${v.change_notes.trim() || "No field changes noted."}`);
          const summaryNotes = revisionNotes.length
            ? revisionNotes.join(" | ")
            : "Unchanged from Original baseline.";
          return [
            latest.sheet_number,
            latest.title,
            categoryOrDiscipline,
            `${formatVersionLabel(baseline.revision)} (${(baseline.created_at || "").slice(0, 10) || missing})`,
            `${formatVersionLabel(latest.revision)} (${(latest.created_at || "").slice(0, 10) || missing})`,
            formatStageLabel(latest.stage),
            Math.max(0, versions.length - 1),
            summaryNotes,
          ];
        });
        return {
          title: section.label,
          paragraphs: !rows.length
            ? ["No baseline or as-built records are available to compare."]
            : ["Side-by-side comparison of each reference's Original baseline against its latest/final record, including total revisions and cumulative field changes recorded across all versions."],
          headers: ["Reference", "Title", "Discipline / Category", "Original baseline", "Latest / final version", "Final stage", "Revisions", "Cumulative field changes & comparison notes"],
          rows,
        };
      }

      if (section.id === "as_built_changes") {
        const rows = sheets.map(s => [
          s.sheet_number,
          s.title,
          formatVersionLabel(s.revision),
          formatStageLabel(s.stage),
          s.change_notes.trim() || (s.revision <= 1 ? "Initial baseline submission." : "No change notes recorded."),
          s.submitted_name,
          (s.created_at || "").slice(0, 10) || missing,
          STATUS_LABELS[s.status] ?? s.status,
        ]);
        return {
          title: section.label,
          paragraphs: !rows.length
            ? ["No field changes or revisions have been recorded."]
            : ["Chronological audit log of every uploaded version (Original, Revision 1, Revision 2, and As-built) with full field change descriptions and submission metadata."],
          headers: ["Reference", "Title", "Version", "Stage", "Field changes / revision notes", "Submitted by", "Submitted date", "Status"],
          rows,
        };
      }

      const rows = sheets.map(s => {
        const reviewSummary = s.reviewed_at
          ? `${s.reviewed_at.slice(0, 10)}${s.review_notes ? ` — ${s.review_notes}` : ""}`
          : (s.review_notes || "Awaiting admin review");
        return [
          s.sheet_number,
          formatVersionLabel(s.revision),
          formatStageLabel(s.stage),
          s.external_name || "Authorized Stakeholder",
          s.external_role || "Signed & Verified",
          s.approval_date || (s.created_at || "").slice(0, 10) || missing,
          STATUS_LABELS[s.status] ?? s.status,
          s.reviewed_name || "Pending review",
          reviewSummary,
        ];
      });
      return {
        title: section.label,
        paragraphs: !rows.length
          ? ["No external stakeholder approvals or administrator reviews have been recorded."]
          : ["Verification register of external technical stakeholder sign-offs (architects, engineers, and authorized verifiers) alongside internal administrator document review decisions."],
        headers: ["Reference", "Version", "Stage", "External stakeholder", "Professional role", "Approval date", "Review status", "Reviewed by", "Review date & comments"],
        rows,
      };
    }),
  };
}
