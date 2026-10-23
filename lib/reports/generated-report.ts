import type { CloseoutReportData } from "./closeout-data";
import { dayVariance, isDateOnly } from "./closeout-model";
import { ISSUE_TYPE_LABELS, PUNCH_STATUS_LABELS } from "./punch-list-model";
import { QUALITY_AUTHORITY_TYPE_LABELS, QUALITY_INSPECTION_TYPE_LABELS, QUALITY_RESULT_LABELS } from "./quality-inspection-model";

export const REPORT_SECTIONS = [
  { id: "summary", label: "General information & lifecycle summary" },
  { id: "outcomes", label: "Project deliverables & final outcomes" },
  { id: "cost_baseline", label: "Cost (budget) baseline" },
  { id: "milestones", label: "Key milestones met" },
  { id: "wbs_schedule", label: "WBS schedule baseline" },
  { id: "performance", label: "Performance baseline & overall review" },
  { id: "scope_changes", label: "Scope changes & field adjustments" },
  { id: "resources_docs", label: "Equipment demobilization & document repository" },
  { id: "lessons", label: "Lessons learned" },
  { id: "approvals", label: "Formal approvals & sign-off" },
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
export type PunchListReportOptions = { title: string; from: string; to: string };
export type FinancialReportOptions = { title: string };
export type QualityReportOptions = { title: string; from: string; to: string };

export type GeneratedReportMetadata = {
  projectTitle: string;
  location: string;
  status: string;
  projectManager: string;
  foreman: string;
  startDate: string;
  targetEndDate: string;
  actualEndDate: string;
  preparedBy: string;
  controlNumber: string;
};

export type GeneratedReportSection = {
  title: string;
  subtitle?: string;
  paragraphs: string[];
  headers: string[];
  rows: (string | number)[][];
};

export type PunchReportItemDetail = {
  id: number;
  itemNumber: string;
  formNumber: string;
  trade: string;
  area: string;
  specificLocation: string;
  issueType: string;
  identifiedOn: string;
  description: string;
  photoUrl?: string;
  actionPerson: string;
  inspectorName: string;
  inspectorSignedAt: string;
  formCreatedAt: string;
  status: string;
};

export type GeneratedReport = {
  reportType?: "closeout" | "punch" | "as-built" | "financial" | "quality";
  title: string;
  project: string;
  asOf: string;
  metadata?: GeneratedReportMetadata;
  punchDetails?: PunchReportItemDetail[];
  sections: GeneratedReportSection[];
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
const PROJECT_STATUS_LABELS: Record<string, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  completed: "Completed",
  on_hold: "On Hold",
};
const formatVersionLabel = (revision: number) => (revision <= 1 ? "Original" : `Revision ${revision - 1}`);
const formatStageLabel = (stage: string) => (stage === "as_built" ? "As-built" : stage === "original" ? "Original" : "Revision");
function formatReportDate(value: string | null | undefined): string {
  if (!value || value === "Not recorded") return "Not recorded";
  const timestamp = new Date(value.length === 10 ? `${value}T00:00:00+08:00` : value);
  if (Number.isNaN(timestamp.getTime())) return value;
  return timestamp.toLocaleDateString("en-GB", {
    timeZone: "Asia/Manila",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
const fmtPhp = (amount: number) => `PHP ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtVariancePhp = (planned: number, actual: number) => {
  const diff = Math.round((planned - actual) * 100) / 100;
  if (Math.abs(diff) < 0.005) return "PHP 0.00 (On target)";
  return diff > 0
    ? `${fmtPhp(diff)} under planned`
    : `${fmtPhp(Math.abs(diff))} over planned`;
};
const costStatusLabel = (planned: number, actual: number) => {
  if (planned === 0 && actual === 0) return "No expenditure";
  const diff = Math.round((planned - actual) * 100) / 100;
  if (Math.abs(diff) < 0.005) return "On baseline";
  return diff > 0 ? "Favorable (Savings)" : "Unfavorable (Overrun)";
};

function buildReportMetadata(data: CloseoutReportData, prefix: string): GeneratedReportMetadata {
  const missing = "Not recorded";
  const rawStatus = data.project.status || "";
  return {
    projectTitle: data.project.name || missing,
    location: data.project.location || missing,
    status: PROJECT_STATUS_LABELS[rawStatus] || rawStatus || "Active",
    projectManager: data.project.projectManagerName || missing,
    foreman: data.project.foremanName || missing,
    startDate: data.project.startDate || missing,
    targetEndDate: data.project.targetEndDate || missing,
    actualEndDate: data.project.actualEndDate || missing,
    preparedBy: data.generatedBy || data.savedBy || data.project.projectManagerName || "Project Management Team",
    controlNumber: `${prefix}-${data.project.id || 1}-${data.asOf.replace(/-/g, "")}`,
  };
}

export function generateFinancialReport(
  data: CloseoutReportData,
  options: FinancialReportOptions
): GeneratedReport {
  if (!options.title.trim()) throw new Error("Enter a report title.");

  const fallbackPlanned = data.work.reduce((sum, item) => sum + item.planned, 0);
  const fallbackActual = data.work.reduce((sum, item) => sum + item.logged, 0);
  const costs = data.costBaseline ?? {
    allocatedBudget: data.project.allocatedBudget ?? null,
    planned: { material: 0, labor: 0, equipment: 0, other: 0, total: fallbackPlanned },
    actual: { material: 0, labor: 0, equipment: 0, other: 0, total: fallbackActual },
  };
  const totalVariance = costs.planned.total - costs.actual.total;
  const utilization = costs.planned.total > 0
    ? `${((costs.actual.total / costs.planned.total) * 100).toFixed(2)}%`
    : "Not applicable";
  const categoryRows = data.deliverables.map(category => [
    category.name,
    fmtPhp(category.planned),
    fmtPhp(category.logged),
    fmtVariancePhp(category.planned, category.logged),
    costStatusLabel(category.planned, category.logged),
  ]);
  const taskRows = data.work.map(item => [
    item.name,
    item.phase,
    fmtPhp(item.planned),
    fmtPhp(item.logged),
    fmtVariancePhp(item.planned, item.logged),
    costStatusLabel(item.planned, item.logged),
  ]);

  return {
    reportType: "financial",
    title: options.title.trim(),
    project: data.project.name,
    asOf: data.asOf,
    metadata: buildReportMetadata(data, "FJC"),
    sections: [
      {
        title: "A. Final cost summary",
        subtitle: "Financial figures are based on the project cost estimate and current saved project expenditure records.",
        paragraphs: [],
        headers: ["Financial measure", "Amount / Result", "Basis"],
        rows: [
          ...(costs.allocatedBudget == null
            ? []
            : [["Allocated project budget", fmtPhp(costs.allocatedBudget), "Project record"]]),
          ["Total planned job cost", fmtPhp(costs.planned.total), "Cost Estimate Breakdown"],
          ["Total actual expenditure", fmtPhp(costs.actual.total), "Current saved project cost entries"],
          ["Planned versus actual variance", fmtVariancePhp(costs.planned.total, costs.actual.total), totalVariance >= 0 ? "Within planned cost" : "Over planned cost"],
          ["Cost utilization", utilization, "Actual expenditure divided by planned job cost"],
        ],
      },
      {
        title: "B. Cost breakdown by type",
        paragraphs: [],
        headers: ["Cost type", "Planned", "Actual", "Variance", "Status"],
        rows: [
          ["Labor", fmtPhp(costs.planned.labor), fmtPhp(costs.actual.labor), fmtVariancePhp(costs.planned.labor, costs.actual.labor), costStatusLabel(costs.planned.labor, costs.actual.labor)],
          ["Materials", fmtPhp(costs.planned.material), fmtPhp(costs.actual.material), fmtVariancePhp(costs.planned.material, costs.actual.material), costStatusLabel(costs.planned.material, costs.actual.material)],
          ["Tools & Equipment", fmtPhp(costs.planned.equipment), fmtPhp(costs.actual.equipment), fmtVariancePhp(costs.planned.equipment, costs.actual.equipment), costStatusLabel(costs.planned.equipment, costs.actual.equipment)],
          ["Other Costs", fmtPhp(costs.planned.other), fmtPhp(costs.actual.other), fmtVariancePhp(costs.planned.other, costs.actual.other), costStatusLabel(costs.planned.other, costs.actual.other)],
          ["Total Job Cost", fmtPhp(costs.planned.total), fmtPhp(costs.actual.total), fmtVariancePhp(costs.planned.total, costs.actual.total), costStatusLabel(costs.planned.total, costs.actual.total)],
        ],
      },
      {
        title: "C. Job cost breakdown by category",
        paragraphs: categoryRows.length ? [] : ["No cost-estimate categories are recorded for this project."],
        headers: categoryRows.length ? ["Category", "Planned", "Actual", "Variance", "Status"] : [],
        rows: categoryRows,
      },
      {
        title: "D. Job cost breakdown by task",
        paragraphs: taskRows.length ? [] : ["No cost-estimate tasks are recorded for this project."],
        headers: taskRows.length ? ["Task", "Category", "Planned", "Actual", "Variance", "Status"] : [],
        rows: taskRows,
      },
    ],
  };
}

export function generateQualityReport(data: CloseoutReportData, options: QualityReportOptions): GeneratedReport {
  if (!options.title.trim()) throw new Error("Enter a report title.");
  if ((options.from && !isDateOnly(options.from)) || (options.to && !isDateOnly(options.to)) || (options.from && options.to && options.from > options.to)) {
    throw new Error("Enter a valid inspection date range.");
  }
  const items = data.qualityInspections.filter(item =>
    (!options.from || item.inspected_on >= options.from) && (!options.to || item.inspected_on <= options.to)
  );
  const sheetById = new Map((data.sheets ?? []).map(sheet => [sheet.id, sheet]));
  const punchById = new Map(data.punchItems.map(item => [item.id, item]));
  const missing = "Not recorded";
  const evidenceStanding = (sheetId: number | null) => {
    if (sheetId == null) return "Signed evidence not linked";
    const sheet = sheetById.get(sheetId);
    if (!sheet) return "Linked document unavailable";
    return sheet.status === "accepted" ? "Accepted signed evidence linked" : `Document: ${STATUS_LABELS[sheet.status] ?? sheet.status}`;
  };
  const inspectionRows = items.map(item => [
    `INS-${String(item.id).padStart(4, "0")}`,
    QUALITY_INSPECTION_TYPE_LABELS[item.inspection_type],
    item.inspection_scope || item.related_work_name || missing,
    item.area,
    formatReportDate(item.inspected_on),
    item.certificate_number || missing,
    item.issued_on ? formatReportDate(item.issued_on) : missing,
    `${QUALITY_AUTHORITY_TYPE_LABELS[item.authority_type]} — ${item.inspector_name}`,
    QUALITY_RESULT_LABELS[item.result],
    evidenceStanding(item.related_sheet_id),
  ]);
  const testItems = items.filter(item => item.test_name || item.acceptance_criteria || item.actual_result);
  const testRows = testItems.map(item => [
    `INS-${String(item.id).padStart(4, "0")}`,
    item.test_name || missing,
    item.inspection_scope || item.related_work_name || missing,
    item.standard_reference || missing,
    item.acceptance_criteria || missing,
    `${item.actual_result || missing}${item.actual_result && item.result_unit ? ` ${item.result_unit}` : ""}`,
    QUALITY_RESULT_LABELS[item.result],
    formatReportDate(item.inspected_on),
  ]);
  const evidenceItems = items.filter(item => item.related_sheet_id != null);
  const evidenceRows = evidenceItems.map(item => {
    const sheet = item.related_sheet_id == null ? undefined : sheetById.get(item.related_sheet_id);
    return [
      `INS-${String(item.id).padStart(4, "0")}`,
      sheet ? `${sheet.sheet_number} — ${sheet.title}` : "Linked document unavailable",
      sheet ? (DOC_TYPE_LABELS[sheet.document_type] ?? sheet.document_type) : missing,
      sheet ? (STATUS_LABELS[sheet.status] ?? sheet.status) : missing,
      item.inspector_name,
      QUALITY_AUTHORITY_TYPE_LABELS[item.authority_type],
      item.license_number || missing,
    ];
  });
  const correctiveItems = items.filter(item =>
    item.nonconformance_description || item.corrective_action_required || item.punch_item_id != null || item.reinspection_reference
  );
  const correctiveRows = correctiveItems.map(item => {
    const punchItem = item.punch_item_id == null ? undefined : punchById.get(item.punch_item_id);
    return [
      `INS-${String(item.id).padStart(4, "0")}`,
      item.nonconformance_description || missing,
      item.corrective_action_required || missing,
      punchItem ? `PL-${String(punchItem.id).padStart(4, "0")}` : "Not linked",
      punchItem?.assigned_to_name || punchItem?.responsible_trade || "Unassigned",
      punchItem ? punchItem.priority.charAt(0).toUpperCase() + punchItem.priority.slice(1) : missing,
      punchItem?.due_date ? formatReportDate(punchItem.due_date) : missing,
      punchItem ? PUNCH_STATUS_LABELS[punchItem.status] : missing,
      item.reinspection_reference || missing,
    ];
  });

  return {
    reportType: "quality",
    title: options.title.trim(),
    project: data.project.name,
    asOf: data.asOf,
    metadata: buildReportMetadata(data, "QAI"),
    sections: [
      {
        title: "A. Final inspection certificates",
        subtitle: "A technical decision is attributed to the named authority. Formal sign-off evidence is documented only when an accepted project document is linked.",
        paragraphs: inspectionRows.length ? [] : ["No quality inspection records match this selection."],
        headers: inspectionRows.length ? ["Reference", "Inspection type", "Scope / System", "Area", "Inspection date", "Certificate / Report No.", "Issue date", "Authority / Inspector", "Technical result", "Evidence"] : [],
        rows: inspectionRows,
      },
      {
        title: "B. Test results",
        paragraphs: testRows.length ? [] : ["No structured test results match this selection."],
        headers: testRows.length ? ["Inspection", "Test", "Scope / System", "Standard / Specification", "Acceptance criteria", "Actual result", "Technical decision", "Test date"] : [],
        rows: testRows,
      },
      {
        title: "C. Certificate and compliance documents",
        paragraphs: evidenceRows.length ? [] : ["No project document has been linked as inspection evidence."],
        headers: evidenceRows.length ? ["Inspection", "Document", "Document type", "Document record status", "Inspector", "Authority type", "License / Accreditation"] : [],
        rows: evidenceRows,
      },
      {
        title: "D. Code-compliance sign-offs",
        paragraphs: items.length ? ["Administrative inclusion records the supplied authority decision. It does not replace the signed certificate or make project staff the technical approver."] : [],
        headers: items.length ? ["Reference", "Scope / System", "Authority type", "Inspector", "Role / Organization", "Certificate / Report No.", "License / Accreditation", "Technical decision", "Issue date", "Signed evidence"] : [],
        rows: items.map(item => [
          `INS-${String(item.id).padStart(4, "0")}`,
          item.inspection_scope || item.related_work_name || missing,
          QUALITY_AUTHORITY_TYPE_LABELS[item.authority_type],
          item.inspector_name,
          [item.inspector_role, item.inspector_organization].filter(Boolean).join(" / ") || missing,
          item.certificate_number || missing,
          item.license_number || missing,
          QUALITY_RESULT_LABELS[item.result],
          item.issued_on ? formatReportDate(item.issued_on) : missing,
          evidenceStanding(item.related_sheet_id),
        ]),
      },
      {
        title: "E. Nonconformance and corrective-action traceability",
        paragraphs: correctiveRows.length ? [] : ["No nonconformance or corrective-action records match this selection."],
        headers: correctiveRows.length ? ["Inspection", "Nonconformance", "Corrective action", "Punch item", "Responsible person / trade", "Priority", "Due date", "Resolution status", "Reinspection reference"] : [],
        rows: correctiveRows,
      },
    ],
  };
}

export function generateReport(data: CloseoutReportData, options: ReportOptions): GeneratedReport {
  if (!options.title.trim()) throw new Error("Enter a report title.");
  if (!options.sections.length) throw new Error("Select at least one section.");
  const milestones = options.sections.includes("milestones");
  if (milestones && (!options.columns.length || options.columns.some(c => !MILESTONE_COLUMNS.includes(c as typeof MILESTONE_COLUMNS[number])))) throw new Error("Select at least one valid milestone column.");
  if (milestones && ((options.from && !isDateOnly(options.from)) || (options.to && !isDateOnly(options.to)) || (options.from && options.to && options.from > options.to))) throw new Error("Enter a valid milestone achievement date range.");
  const notes = data.record?.notes ?? {};
  const missing = "Not recorded";
  const variance = dayVariance(data.project.targetEndDate, data.project.actualEndDate);
  const completedCount = data.work.filter(w => w.percent >= 100).length;

  return {
    title: options.title.trim(),
    project: data.project.name,
    asOf: data.asOf,
    metadata: buildReportMetadata(data, "PCR"),
    sections: REPORT_SECTIONS.filter(s => options.sections.includes(s.id)).map((section, idx) => {
      const sectionLetter = String.fromCharCode(65 + idx);
      const sectionTitle = `${sectionLetter}. ${section.label}`;
      if (section.id === "summary") {
        const ownerDeveloper = notes.approver_client || missing;
        const projectArchitect = notes.approver_architect || missing;
        return {
          title: sectionTitle,
          paragraphs: [notes.summary || missing],
          headers: [],
          rows: [
            ["Project Name", data.project.name],
            ["Project Location", data.project.location || missing],
            ["Owner/Developer", ownerDeveloper],
            ["Project Architect", projectArchitect],
            ["Project start", formatReportDate(data.project.startDate)],
            ["Target completion", formatReportDate(data.project.targetEndDate)],
            ["Recorded actual completion", formatReportDate(data.project.actualEndDate)],
          ],
        };
      }

      if (section.id === "outcomes") {
        const deliverables = data.deliverables ?? [];
        const rows = deliverables.map(d => [
          d.name,
          d.endDate || missing,
          `${d.completedTasks} / ${d.taskCount} tasks`,
          `${d.percent.toFixed(1)}%`,
          d.percent >= 100
            ? "Accepted / 100% Complete"
            : d.percent > 0
              ? `In Progress (${d.percent.toFixed(1)}%)`
              : "Pending Execution",
        ]);
        return {
          title: sectionTitle,
          paragraphs: [notes.outcomes || missing],
          headers: rows.length ? ["Deliverable / Construction Phase", "Target Acceptance Date", "Tracked Work", "Completion (%)", "Acceptance Standing"] : [],
          rows,
        };
      }

      if (section.id === "cost_baseline") {
        const fallbackPlanned = data.work.reduce((s, w) => s + (w.planned || 0), 0);
        const fallbackActual = data.work.reduce((s, w) => s + (w.logged || 0), 0);
        const cb = data.costBaseline ?? {
          allocatedBudget: data.project.allocatedBudget ?? null,
          planned: { material: 0, labor: 0, equipment: 0, other: 0, total: fallbackPlanned },
          actual: { material: 0, labor: 0, equipment: 0, other: 0, total: fallbackActual },
        };
        const rows: (string | number)[][] = [
          ["Materials and Supplies", fmtPhp(cb.planned.material), fmtPhp(cb.actual.material), fmtVariancePhp(cb.planned.material, cb.actual.material), costStatusLabel(cb.planned.material, cb.actual.material)],
          ["Field & Site Labor", fmtPhp(cb.planned.labor), fmtPhp(cb.actual.labor), fmtVariancePhp(cb.planned.labor, cb.actual.labor), costStatusLabel(cb.planned.labor, cb.actual.labor)],
          ["Tools & Heavy Equipment", fmtPhp(cb.planned.equipment), fmtPhp(cb.actual.equipment), fmtVariancePhp(cb.planned.equipment, cb.actual.equipment), costStatusLabel(cb.planned.equipment, cb.actual.equipment)],
          ["Subcontracts & Other Direct Costs", fmtPhp(cb.planned.other), fmtPhp(cb.actual.other), fmtVariancePhp(cb.planned.other, cb.actual.other), costStatusLabel(cb.planned.other, cb.actual.other)],
          ["Total Construction Expenditures", fmtPhp(cb.planned.total), fmtPhp(cb.actual.total), fmtVariancePhp(cb.planned.total, cb.actual.total), costStatusLabel(cb.planned.total, cb.actual.total)],
        ];
        if (cb.allocatedBudget != null) {
          rows.push([
            "Allocated Project Budget Baseline",
            fmtPhp(cb.allocatedBudget),
            fmtPhp(cb.actual.total),
            fmtVariancePhp(cb.allocatedBudget, cb.actual.total),
            cb.actual.total <= cb.allocatedBudget ? "Within Allocated Budget" : "Exceeds Allocated Budget",
          ]);
        }
        return {
          title: sectionTitle,
          paragraphs: [notes.cost_explanation || "Planned costs reflect the project Cost Estimate baseline. Actual costs reflect recorded material purchases and saved task/category progress entries."],
          headers: ["Expenditures Category", "Planned", "Actual", "Variance", "Explanation / Status"],
          rows,
        };
      }

      if (section.id === "milestones") {
        const rows = data.work.filter(w => {
          const achieved = data.record?.milestone_dates[w.key];
          return w.milestone && achieved && (!options.from || achieved >= options.from) && (!options.to || achieved <= options.to);
        }).map(w => {
          const achieved = data.record!.milestone_dates[w.key];
          const values = [w.name, w.phase, w.end || missing, achieved, dayVariance(w.end, achieved) ?? missing];
          return options.columns.map(c => values[MILESTONE_COLUMNS.indexOf(c as typeof MILESTONE_COLUMNS[number])]);
        });
        return {
          title: sectionTitle,
          paragraphs: [
            ...(options.from || options.to ? [`Achievement dates: ${options.from || "Any"} to ${options.to || "Any"}`] : []),
            ...(!rows.length ? ["No recorded milestone achievements match this selection."] : []),
            "Positive variance means late; negative means early.",
          ],
          headers: options.columns,
          rows,
        };
      }

      if (section.id === "wbs_schedule") {
        const rows = data.work.map(w => {
          const achieved = data.record?.milestone_dates[w.key] ?? null;
          const vDays = achieved ? dayVariance(w.end, achieved) : null;
          const varianceText = vDays !== null
            ? (vDays === 0 ? "0 days (On time)" : vDays > 0 ? `+${vDays} day(s) late` : `${vDays} day(s) early`)
            : (w.percent >= 100 ? "Completed (100%)" : `${w.percent.toFixed(0)}% complete`);
          return [
            w.name,
            w.phase,
            w.start || missing,
            w.end || missing,
            achieved || (w.percent >= 100 ? (data.project.actualEndDate || "Completed") : "In progress"),
            `${w.percent.toFixed(0)}%`,
            varianceText,
          ];
        });
        return {
          title: sectionTitle,
          paragraphs: rows.length
            ? [`Schedule baseline across ${rows.length} tracked WBS activity/task item(s), including planned start and finish dates, completion progress, and schedule variance.`]
            : ["No WBS activities or tasks have been recorded for this project."],
          headers: ["WBS Elements Activity or Task", "Phase", "Planned Start Date", "Planned Finish Date", "Actual / Status Date", "Progress", "Variance / Status"],
          rows,
        };
      }

      if (section.id === "performance") {
        return {
          title: sectionTitle,
          paragraphs: [
            notes.performance || missing,
            "Completion follows the Gantt chart, including automatic progress. Milestones use recorded achievement dates.",
          ],
          headers: ["Gantt completion (%)", "Tracked work completed", "Total tracked work", "Completion variance (days)"],
          rows: [[Number(data.progressPercent.toFixed(2)), completedCount, data.work.length, variance ?? missing]],
        };
      }

      if (section.id === "scope_changes") {
        const revisedSheets = (data.sheets ?? []).filter(s => s.revision > 1 || s.stage === "as_built" || Boolean(s.change_notes?.trim()));
        const rows: (string | number)[][] = revisedSheets.map(s => [
          `${s.sheet_number} — ${s.title}`,
          s.document_type === "drawing" ? `Drawing (${s.discipline})` : (DOC_TYPE_LABELS[s.document_type] ?? s.document_type),
          `${formatVersionLabel(s.revision)} (${formatStageLabel(s.stage)})`,
          s.change_notes?.trim() || "Field adjustment / revision recorded.",
          STATUS_LABELS[s.status] ?? s.status,
        ]);
        return {
          title: sectionTitle,
          paragraphs: [notes.scope_changes || (rows.length ? "Recorded field revisions and as-built scope adjustments are listed below." : "No formal scope changes or baseline deviations have been recorded.")],
          headers: rows.length ? ["Scope Change / Reference", "Discipline / Category", "Version / Stage", "Impact of Scope Change / Notes", "Status"] : [],
          rows,
        };
      }

      if (section.id === "resources_docs") {
        const equipment = data.equipmentAssignments ?? [];
        const latestSheetsByRef = new Map<string, NonNullable<CloseoutReportData["sheets"]>[number]>();
        for (const s of data.sheets ?? []) {
          const prev = latestSheetsByRef.get(s.sheet_number);
          if (!prev || s.revision >= prev.revision) latestSheetsByRef.set(s.sheet_number, s);
        }
        const rows: (string | number)[][] = [
          ...equipment.map(eq => [
            `Equipment — ${eq.equipmentName} (${eq.equipmentAssetTag})`,
            eq.purpose || eq.currentTaskName || "Site construction operations",
            eq.returnedAt ? "Warehouse / Inventory Pool (Returned)" : (data.project.foremanName || "Active on Project Site"),
            eq.returnedAt ? eq.returnedAt.slice(0, 10) : `Assigned ${eq.assignedAt.slice(0, 10)} (Active)`,
          ]),
          ...[...latestSheetsByRef.values()].map(s => [
            `Document — ${s.sheet_number}: ${s.title}`,
            `${DOC_TYPE_LABELS[s.document_type] ?? s.document_type} (${formatVersionLabel(s.revision)})`,
            "Project Sheets Repository",
            `${(s.created_at || "").slice(0, 10) || missing} · ${STATUS_LABELS[s.status] ?? s.status}`,
          ]),
        ];
        return {
          title: sectionTitle,
          paragraphs: [
            notes.operations_maintenance
              ? `Operations & Maintenance Plan: ${notes.operations_maintenance}`
              : "Project equipment demobilization status and archived project documentation records are summarized below.",
          ],
          headers: rows.length ? ["Resource / Document Record", "Description / Role", "Recipient / Storage Location", "Turnover Date / Disposition"] : [],
          rows,
        };
      }

      if (section.id === "lessons") {
        return {
          title: sectionTitle,
          paragraphs: [notes.lessons || missing],
          headers: [],
          rows: [],
        };
      }

      // section.id === "approvals"
      const pmName = data.project.projectManagerName || data.savedBy || "Assigned Project Manager";
      const foremanName = data.project.foremanName || "Assigned Site Foreman";
      const archName = notes.approver_architect || "Project Architect / Lead Engineer";
      const clientName = notes.approver_client || "Project Sponsor / Client Representative";
      const reviewDate = data.record?.updated_at ? data.record.updated_at.slice(0, 10) : data.asOf;
      return {
        title: sectionTitle,
        paragraphs: ["By signing below, the project stakeholders confirm that the closeout baselines, deliverables, and turnover records have been reviewed."],
        headers: ["Position / Title", "Signature / Printed Name", "Verification Status", "Date"],
        rows: [
          ["Project Manager", pmName, data.record ? "Reviewed & Submitted" : "Signature: ______________________", reviewDate],
          ["Site Foreman / Field Lead", foremanName, "Field Progress Verified", data.asOf],
          ["Project Architect / Engineer", archName, notes.approver_architect ? "Signed & Verified" : "Signature: ______________________", data.asOf],
          ["Project Sponsor / Client Owner", clientName, notes.approver_client ? "Accepted for Handover" : "Signature: ______________________", data.project.actualEndDate || "____________"],
        ],
      };
    }),
  };
}

export function generatePunchListReport(data: CloseoutReportData, options: PunchListReportOptions): GeneratedReport {
  if (!options.title.trim()) throw new Error("Enter a report title.");
  if ((options.from && !isDateOnly(options.from)) || (options.to && !isDateOnly(options.to)) || (options.from && options.to && options.from > options.to)) {
    throw new Error("Enter a valid identification date range.");
  }
  const items = data.punchItems.filter(item =>
    (!options.from || item.identified_on >= options.from) && (!options.to || item.identified_on <= options.to)
  );
  const missing = "Not recorded";

  const punchDetails: PunchReportItemDetail[] = items.map(item => ({
    id: item.id,
    itemNumber: `PL-${String(item.id).padStart(4, "0")}`,
    formNumber: `IDR M&M - ${data.project.name} - DP-QUAL-${String(item.id).padStart(4, "0")}`,
    trade: item.responsible_trade || missing,
    area: item.area || missing,
    specificLocation: item.specific_location || missing,
    issueType: ISSUE_TYPE_LABELS[item.issue_type] || item.title,
    identifiedOn: item.identified_on,
    description: item.description || missing,
    photoUrl: item.before_photo_url || "",
    actionPerson: item.assigned_to_name || "Unassigned",
    inspectorName: item.verified_by_name || item.identified_by_name || data.project.foremanName || data.project.projectManagerName || "Authorized Inspector",
    inspectorSignedAt: item.verified_at ? item.verified_at.slice(0, 10) : item.identified_on,
    formCreatedAt: item.created_at,
    status: PUNCH_STATUS_LABELS[item.status] || "Open",
  }));

  return {
    reportType: "punch",
    title: options.title.trim(),
    project: data.project.name,
    asOf: data.asOf,
    metadata: buildReportMetadata(data, "PLR"),
    punchDetails,
    sections: items.length ? items.map(item => ({
      title: `Punch List · PL-${String(item.id).padStart(4, "0")}`,
      paragraphs: [
        `Description: ${item.description || missing}`,
        `Photo and video: ${item.before_photo_url || "Not attached"}`,
      ],
      headers: ["Field", "Details"],
      rows: [
        ["Type of issue", ISSUE_TYPE_LABELS[item.issue_type] || item.title],
        ["Trade and party responsible", item.responsible_trade || missing],
        ["Area", item.area || missing],
        ["Specific location", item.specific_location || missing],
        ["Date identified", item.identified_on],
        ["Action person", item.assigned_to_name || "Unassigned"],
        ["Inspected / reported by", item.identified_by_name || "Authorized project user"],
        ["Inspector signature", "____________________________    Date: ________________"],
        ["Resolution verified by", item.verified_at ? `${item.verified_by_name || "Authorized project user"}, ${item.verified_at.slice(0, 10)}` : "Pending"],
        ["Current status", PUNCH_STATUS_LABELS[item.status]],
      ],
    })) : [{
      title: "Punch List",
      paragraphs: ["No punch-list items match this selection."],
      headers: [],
      rows: [],
    }],
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
    metadata: buildReportMetadata(data, "ASB"),
    sections: AS_BUILT_SECTIONS.filter(s => options.sections.includes(s.id)).map((section, idx) => {
      const sectionLetter = String.fromCharCode(65 + idx);
      const sectionTitle = `${sectionLetter}. ${section.label}`;
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
          title: sectionTitle,
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
          title: sectionTitle,
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
          title: sectionTitle,
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
          title: sectionTitle,
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
        title: sectionTitle,
        paragraphs: !rows.length
          ? ["No external stakeholder approvals or administrator reviews have been recorded."]
          : ["Verification register of external technical stakeholder sign-offs (architects, engineers, and authorized verifiers) alongside internal administrator document review decisions."],
        headers: ["Reference", "Version", "Stage", "External stakeholder", "Professional role", "Approval date", "Review status", "Reviewed by", "Review date & comments"],
        rows,
      };
    }),
  };
}
