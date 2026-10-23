"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { usePortal } from "@/components/portal/portal-context";
import { ChevronDown, ClipboardCheck, ClipboardList, Eye, FileDown, FileSpreadsheet, Pencil } from "lucide-react";
import { Modal, ModalFooter } from "@/components/ui/modal";
import type { CloseoutReportData } from "@/lib/reports/closeout-data";
import {
  generateReport,
  generateAsBuiltReport,
  generatePunchListReport,
  generateFinancialReport,
  generateQualityReport,
  generateSafetyReport,
  REPORT_SECTIONS,
  MILESTONE_COLUMNS,
  AS_BUILT_SECTIONS,
  AS_BUILT_COLUMNS,
  FINANCIAL_REPORT_SECTIONS,
  type GeneratedReport,
  type ReportSectionId,
  type AsBuiltSectionId,
  type FinancialSectionId,
} from "@/lib/reports/generated-report";
import { exportGeneratedReport } from "@/lib/reports/generated-report-export";
import { CloseoutEditor, ReportDocumentSheet } from "./closeout-report";
import { PunchListManager } from "./punch-list-manager";
import { QualityInspectionManager } from "./quality-inspection-manager";
import type { ProjectOption } from "./project-picker";

const input = "w-full rounded border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500";
const button = "inline-flex items-center justify-center gap-2 rounded border border-zinc-200 bg-white px-4 py-2 text-sm font-medium disabled:opacity-50 transition hover:bg-zinc-50";
const types = [
  { id: "full", label: "Project closeout report", description: "Master summary of the project lifecycle, final outcomes, key milestones met, lessons learned, and overall performance." },
  { id: "punch", label: "Punch list report", description: "Remaining, incomplete, or defective items to resolve before final payment and sign-off.", requires: "A recorded punch list with item status and sign-off details." },
  { id: "as-built", label: "As-built drawing & record report", description: "Final construction records compared with the original design, including field changes." },
  { id: "financial", label: "Final financial & job cost report", description: "Final planned-versus-actual job costs using the project estimate and recorded expenditures." },
  { id: "quality", label: "Quality assurance and inspection sign-off reports", description: "Recorded inspections, test results, linked certificates, and external inspector decisions." },
  { id: "safety", label: "Safety and incident closeout report", description: "Overall safety performance and recorded accident or incident reviews during the project.", requires: "Verified safety and incident records. Missing records cannot establish zero accidents." },
] as const;

export function ReportBuilder({ data, projects }: { data: CloseoutReportData; projects: ProjectOption[] }) {
  const router = useRouter();
  const { basePath } = usePortal();
  const [switchingProject, startProjectTransition] = useTransition();
  const [type, setType] = useState<string>("full");
  const selectedType = types.find(item => item.id === type) ?? types[0];
  const available = type === "full" || type === "as-built" || type === "financial" || (type === "quality" && data.qualityInspectionsAvailable) || (type === "punch" && data.punchListAvailable) || (type === "safety" && data.safetyIncidentsAvailable);
  const [title, setTitle] = useState("Project closeout report");
  const [sections, setSections] = useState<ReportSectionId[]>(REPORT_SECTIONS.map(s => s.id));
  const [columns, setColumns] = useState<string[]>([...MILESTONE_COLUMNS]);
  const [asBuiltSections, setAsBuiltSections] = useState<AsBuiltSectionId[]>(AS_BUILT_SECTIONS.map(s => s.id));
  const [asBuiltColumns, setAsBuiltColumns] = useState<string[]>([...AS_BUILT_COLUMNS]);
  const [financialSections, setFinancialSections] = useState<FinancialSectionId[]>(FINANCIAL_REPORT_SECTIONS.map(s => s.id));
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [generating, setBusy] = useState(false);
  const busy = generating || switchingProject;
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [punchEditing, setPunchEditing] = useState(false);
  const [qualityEditing, setQualityEditing] = useState(false);
  const [ready, setReady] = useState<{ report: GeneratedReport; url?: string; filename?: string } | null>(null);
  const [preview, setPreview] = useState<GeneratedReport | null>(null);
  const downloadUrl = useRef<string | null>(null);

  useEffect(() => () => { if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current); }, []);
  const uniqueSheetCount = new Set((data.sheets ?? []).map(s => s.sheet_number)).size;
  const hasRightColumn =
    (type === "full" && sections.includes("milestones")) ||
    (type === "as-built" && asBuiltSections.includes("as_built_register"));

  function closeReady() {
    setReady(null);
    if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
    downloadUrl.current = null;
  }

  async function generate(format: "view" | "pdf" | "xlsx") {
    if (!available) return;
    setError(""); setBusy(true);
    try {
      const report = type === "as-built"
        ? generateAsBuiltReport(data, { title: title.trim() || "As-built drawing & record report", sections: asBuiltSections, columns: asBuiltColumns, from, to })
        : type === "punch"
          ? generatePunchListReport(data, { title: title.trim() || "Punch list report", from: "", to: "" })
        : type === "financial"
          ? generateFinancialReport(data, { title: title.trim() || "Final financial & job cost report", sections: financialSections, from, to })
        : type === "quality"
          ? generateQualityReport(data, { title: title.trim() || "Quality assurance and inspection sign-off report", from, to })
        : type === "safety"
          ? generateSafetyReport(data, { title: title.trim() || "Safety and incident closeout report", from, to })
        : generateReport(data, { title: title.trim() || "Project closeout report", sections, columns, from, to });

      if (format === "view") {
        setPreview(report);
      } else {
        const blob = await exportGeneratedReport(report, format);
        const url = URL.createObjectURL(blob);
        if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
        downloadUrl.current = url;
        const filename = `${report.title} - ${report.project}`.replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").slice(0, 160);
        setReady({ report, url, filename: `${filename}.${format}` });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not generate the report. Please try again.");
    } finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-white md:flex-row">
      <nav aria-label="Report types" className="border-b border-zinc-200 py-5 md:w-64 md:shrink-0 md:border-r md:border-b-0">
        <h2 className="border-b border-zinc-200 px-6 pb-4 text-base font-semibold">Report type</h2>
        {types.map(item => (
          <button
            key={item.id}
            disabled={busy}
            aria-current={type === item.id ? "page" : undefined}
            onClick={() => {
              setType(item.id);
              setTitle(item.label);
              if (item.id === "full") setSections(REPORT_SECTIONS.map(s => s.id));
              if (item.id === "as-built") setAsBuiltSections(AS_BUILT_SECTIONS.map(s => s.id));
              if (item.id === "financial") setFinancialSections(FINANCIAL_REPORT_SECTIONS.map(s => s.id));
              setError("");
            }}
            className={`block w-full px-6 py-3 text-left text-sm ${type === item.id ? "bg-zinc-100 font-medium text-zinc-900" : "text-zinc-500 hover:bg-zinc-50"}`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-zinc-200 px-6 py-5 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{types.find(t => t.id === type)?.label}</h2>
            {type === "full" && (
              <button className={button} disabled={busy || !data.storageAvailable} onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" />Edit closeout details
              </button>
            )}
            {type === "punch" && (
              <button className={button} disabled={busy || !data.punchListAvailable} onClick={() => setPunchEditing(true)}>
                <ClipboardList className="size-3.5" />Manage punch list
              </button>
            )}
            {type === "quality" && (
              <button className={button} disabled={busy || !data.qualityInspectionsAvailable} onClick={() => setQualityEditing(true)}>
                <ClipboardCheck className="size-3.5" />Manage inspections
              </button>
            )}
          </div>
          <p className="mt-1 text-sm text-zinc-500">{selectedType.description}</p>

          {!available && (
            <div role="status" className="mt-4 rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <p className="font-medium">Report generation not connected yet</p>
              <p className="mt-1">Required: {"requires" in selectedType ? selectedType.requires : ""}</p>
            </div>
          )}

          {type === "full" && !data.storageAvailable && (
            <p className="mt-3 text-sm text-amber-700">
              Closeout detail saving is not available yet. Project figures can still be reported; missing details are marked as not recorded.
            </p>
          )}
          {type === "as-built" && !data.sheetsAvailable && (
            <p className="mt-3 text-sm text-amber-700">
              Sheets storage is not enabled yet. Apply migration 0077 in Supabase to load project drawing and document records.
            </p>
          )}
          {type === "punch" && !data.punchListAvailable && (
            <p className="mt-3 text-sm text-amber-700">
              Punch-list storage is not enabled yet. Apply migration 0092 in Supabase to record and generate punch-list reports.
            </p>
          )}
          {type === "quality" && !data.qualityInspectionsAvailable && (
            <p className="mt-3 text-sm text-amber-700">
              Quality inspection storage is not enabled yet. Apply migration 0093 in Supabase to record and generate inspection reports.
            </p>
          )}
          {type === "safety" && !data.safetyIncidentsAvailable && (
            <p className="mt-3 text-sm text-amber-700">
              Incident storage is not enabled yet. Apply migration 0096 in Supabase to record and generate safety closeout reports.
            </p>
          )}
        </div>

        <fieldset disabled={busy} className="grid disabled:opacity-60 xl:grid-cols-2">
          <div className={`space-y-5 p-6 sm:p-8 ${hasRightColumn ? "" : "xl:col-span-2"}`}>
            <label className="flex items-center gap-3 text-sm text-zinc-500">
              <span className="w-14 shrink-0">Title</span>
              <input value={title} maxLength={120} onChange={e => setTitle(e.target.value)} className={`${input} max-w-sm`} />
            </label>
            <label className="flex items-center gap-3 text-sm text-zinc-500">
              <span className="w-14 shrink-0">Project</span>
              <span className="relative w-full max-w-sm">
                <select
                  value={data.project.id}
                  className={`${input} cursor-pointer appearance-none pr-9 text-zinc-900`}
                  onChange={event => {
                    const projectId = event.target.value;
                    startProjectTransition(() => router.push(`${basePath}/reports?projectId=${projectId}`));
                  }}
                >
                  {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
                <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
              </span>
            </label>

            {available && type !== "punch" && (
              <div className="flex items-center gap-3 text-sm text-zinc-500">
                <span className="w-14 shrink-0">Dates</span>
                <div className="flex w-full max-w-sm items-center gap-2">
                  <input
                    type="date"
                    aria-label="From date"
                    value={from}
                    max={to || undefined}
                    onChange={e => setFrom(e.target.value)}
                    className={`${input} text-zinc-900`}
                  />
                  <span className="shrink-0 text-xs text-zinc-400">to</span>
                  <input
                    type="date"
                    aria-label="To date"
                    value={to}
                    min={from || undefined}
                    onChange={e => setTo(e.target.value)}
                    className={`${input} text-zinc-900`}
                  />
                  {(from || to) && (
                    <button
                      type="button"
                      onClick={() => { setFrom(""); setTo(""); }}
                      className="shrink-0 cursor-pointer text-xs font-medium text-zinc-400 transition hover:text-zinc-700"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            )}

            {type === "full" && (
              <fieldset>
                <legend className="mb-3 text-sm text-zinc-500">Include sections</legend>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {REPORT_SECTIONS.map(s => (
                    <label key={s.id} className="flex items-center gap-2 text-xs sm:text-sm text-zinc-800">
                      <span className="relative inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center">
                        <input
                          type="checkbox"
                          className="peer m-0 block h-[14px] w-[14px] shrink-0 cursor-pointer appearance-none rounded-[2px] border border-zinc-300 bg-white p-0 transition-colors checked:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-200 focus-visible:outline-none"
                          checked={sections.includes(s.id)}
                          onChange={e => setSections(current => e.target.checked ? [...current, s.id] : current.filter(id => id !== s.id))}
                        />
                        <span className="pointer-events-none absolute left-[4px] top-[4px] block h-[6px] w-[6px] rounded-[1px] bg-zinc-900 opacity-0 peer-checked:opacity-100" />
                      </span>
                      <span className="truncate">{s.label.replace(/^[A-Z]\.\s*/, "")}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {type === "as-built" && (
              <fieldset>
                <legend className="mb-3 text-sm text-zinc-500">Include sections</legend>
                <div className="space-y-3">
                  {AS_BUILT_SECTIONS.map(s => (
                    <label key={s.id} className="flex items-center gap-2 text-sm">
                      <span className="relative inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center">
                        <input
                          type="checkbox"
                          className="peer m-0 block h-[14px] w-[14px] shrink-0 cursor-pointer appearance-none rounded-[2px] border border-zinc-300 bg-white p-0 transition-colors checked:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-200 focus-visible:outline-none"
                          checked={asBuiltSections.includes(s.id)}
                          onChange={e => setAsBuiltSections(current => e.target.checked ? [...current, s.id] : current.filter(id => id !== s.id))}
                        />
                        <span className="pointer-events-none absolute left-[4px] top-[4px] block h-[6px] w-[6px] rounded-[1px] bg-zinc-900 opacity-0 peer-checked:opacity-100" />
                      </span>
                      {s.label.replace(/^[A-Z]\.\s*/, "")}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {type === "financial" && (
              <fieldset>
                <legend className="mb-3 text-sm text-zinc-500">Include sections</legend>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {FINANCIAL_REPORT_SECTIONS.map(section => (
                    <label key={section.id} className="flex items-center gap-2 text-xs text-zinc-800 sm:text-sm">
                      <span className="relative inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center">
                        <input
                          type="checkbox"
                          className="peer m-0 block h-[14px] w-[14px] shrink-0 cursor-pointer appearance-none rounded-[2px] border border-zinc-300 bg-white p-0 transition-colors checked:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-200 focus-visible:outline-none"
                          checked={financialSections.includes(section.id)}
                          onChange={event => setFinancialSections(current => event.target.checked
                            ? [...current, section.id]
                            : current.filter(id => id !== section.id))}
                        />
                        <span className="pointer-events-none absolute left-[4px] top-[4px] block h-[6px] w-[6px] rounded-[1px] bg-zinc-900 opacity-0 peer-checked:opacity-100" />
                      </span>
                      <span>{section.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            <p className="text-xs text-zinc-400">
              {type === "as-built"
                ? `Connected to project Sheets (${uniqueSheetCount} reference${uniqueSheetCount === 1 ? "" : "s"}, ${(data.sheets ?? []).length} total version${(data.sheets ?? []).length === 1 ? "" : "s"} as of ${data.asOf}).`
                : type === "punch"
                  ? `${data.punchItems.length} punch-list item${data.punchItems.length === 1 ? "" : "s"} recorded for this project as of ${data.asOf}.`
                : type === "financial"
                  ? `Uses the Cost Estimate Breakdown and current saved project expenditures as of ${data.asOf}. Billing, revenue, profit, and subcontractor payout figures are not included because they are not recorded by the system.`
                : type === "quality"
                  ? `${data.qualityInspections.length} inspection record${data.qualityInspections.length === 1 ? "" : "s"} stored for this project. Only recorded inspector decisions and linked project documents are reported.`
                : type === "safety"
                  ? `${data.safetyIncidents.length} incident record${data.safetyIncidents.length === 1 ? "" : "s"} stored for this project. The report summarizes submitted incidents and does not assume unrecorded closure or corrective-action details.`
                : `Project snapshot as of ${data.asOf}. Baseline and logged figures are reconciled directly from project data.`}
            </p>
          </div>

          {type === "full" && sections.includes("milestones") && (
            <div className="space-y-6 border-t border-zinc-200 p-6 sm:p-8 xl:border-t-0 xl:border-l xl:border-zinc-200">
              <fieldset>
                <legend className="mb-3 text-sm text-zinc-500">Milestone columns</legend>
                <label className="mb-3 flex items-center gap-2 text-sm">
                  <span className="relative inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center">
                    <input
                      type="checkbox"
                      className="peer m-0 block h-[14px] w-[14px] shrink-0 cursor-pointer appearance-none rounded-[2px] border border-zinc-300 bg-white p-0 transition-colors checked:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-200 focus-visible:outline-none"
                      checked={columns.length === MILESTONE_COLUMNS.length}
                      onChange={e => setColumns(e.target.checked ? [...MILESTONE_COLUMNS] : [])}
                    />
                    <span className="pointer-events-none absolute left-[4px] top-[4px] block h-[6px] w-[6px] rounded-[1px] bg-zinc-900 opacity-0 peer-checked:opacity-100" />
                  </span>
                  All columns
                </label>
                <div className="space-y-3 pl-5">
                  {MILESTONE_COLUMNS.map(c => (
                    <label key={c} className="flex items-center gap-2 text-sm">
                      <span className="relative inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center">
                        <input
                          type="checkbox"
                          className="peer m-0 block h-[14px] w-[14px] shrink-0 cursor-pointer appearance-none rounded-[2px] border border-zinc-300 bg-white p-0 transition-colors checked:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-200 focus-visible:outline-none"
                          checked={columns.includes(c)}
                          onChange={e => setColumns(current => MILESTONE_COLUMNS.filter(col => col === c ? e.target.checked : current.includes(col)))}
                        />
                        <span className="pointer-events-none absolute left-[4px] top-[4px] block h-[6px] w-[6px] rounded-[1px] bg-zinc-900 opacity-0 peer-checked:opacity-100" />
                      </span>
                      {c}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          )}

          {type === "as-built" && asBuiltSections.includes("as_built_register") && (
            <div className="space-y-6 border-t border-zinc-200 p-6 sm:p-8 xl:border-t-0 xl:border-l xl:border-zinc-200">
              <fieldset>
                <legend className="mb-3 text-sm text-zinc-500">Register columns</legend>
                <label className="mb-3 flex items-center gap-2 text-sm">
                  <span className="relative inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center">
                    <input
                      type="checkbox"
                      className="peer m-0 block h-[14px] w-[14px] shrink-0 cursor-pointer appearance-none rounded-[2px] border border-zinc-300 bg-white p-0 transition-colors checked:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-200 focus-visible:outline-none"
                      checked={asBuiltColumns.length === AS_BUILT_COLUMNS.length}
                      onChange={e => setAsBuiltColumns(e.target.checked ? [...AS_BUILT_COLUMNS] : [])}
                    />
                    <span className="pointer-events-none absolute left-[4px] top-[4px] block h-[6px] w-[6px] rounded-[1px] bg-zinc-900 opacity-0 peer-checked:opacity-100" />
                  </span>
                  All columns
                </label>
                <div className="space-y-3 pl-5">
                  {AS_BUILT_COLUMNS.map(c => (
                    <label key={c} className="flex items-center gap-2 text-sm">
                      <span className="relative inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center">
                        <input
                          type="checkbox"
                          className="peer m-0 block h-[14px] w-[14px] shrink-0 cursor-pointer appearance-none rounded-[2px] border border-zinc-300 bg-white p-0 transition-colors checked:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-200 focus-visible:outline-none"
                          checked={asBuiltColumns.includes(c)}
                          onChange={e => setAsBuiltColumns(current => AS_BUILT_COLUMNS.filter(col => col === c ? e.target.checked : current.includes(col)))}
                        />
                        <span className="pointer-events-none absolute left-[4px] top-[4px] block h-[6px] w-[6px] rounded-[1px] bg-zinc-900 opacity-0 peer-checked:opacity-100" />
                      </span>
                      {c}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          )}
        </fieldset>

        <div className="border-t border-zinc-200 px-6 py-4 sm:px-8">
          {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}
          <div className="flex flex-wrap items-center gap-2.5">
            <button disabled={busy || !available} onClick={() => generate("view")} className={`${button} !border-zinc-900 !bg-zinc-900 text-white`}>
              <Eye className="size-4" />View Document
            </button>
            <button disabled={busy || !available} onClick={() => generate("pdf")} className={button}>
              <FileDown className="size-4" />Download PDF
            </button>
            <button disabled={busy || !available} onClick={() => generate("xlsx")} className={button}>
              <FileSpreadsheet className="size-4" />Download Excel
            </button>
            {busy && <span role="status" className="ml-2 text-sm text-zinc-500">{switchingProject ? "Loading project..." : "Generating report..."}</span>}
          </div>
        </div>
      </div>

      <Modal open={editing} onClose={() => setEditing(false)} title="Edit project closeout details" size="wide">
        <CloseoutEditor data={data} onClose={() => setEditing(false)} />
      </Modal>

      <Modal open={punchEditing} onClose={() => setPunchEditing(false)} title="Manage punch list" size="wide" bare>
        <PunchListManager
          data={data}
          onClose={() => setPunchEditing(false)}
          onSaved={() => {
            setPunchEditing(false);
            router.refresh();
          }}
        />
      </Modal>

      <Modal open={qualityEditing} onClose={() => setQualityEditing(false)} title="Manage quality inspections" size="wide" bare>
        <QualityInspectionManager
          data={data}
          onClose={() => setQualityEditing(false)}
          onSaved={() => {
            setQualityEditing(false);
            router.refresh();
          }}
        />
      </Modal>

      <Modal open={!!ready} onClose={closeReady} title="Report complete" size="small" variant="centered">
        <p className="text-sm text-zinc-500">Your report is ready{ready?.url ? ", click below to download." : "."}</p>
        {ready?.url && (
          <a href={ready.url} download={ready.filename} className="mt-4 block break-words text-sm font-medium text-emerald-700 underline">
            {ready.filename}
          </a>
        )}
        <ModalFooter>
          <div className="flex justify-end gap-2">
            {ready && !ready.url && (
              <button className={`${button} !bg-zinc-900 text-white`} onClick={() => { setPreview(ready.report); closeReady(); }}>
                View
              </button>
            )}
            <button className={button} onClick={closeReady}>Close</button>
          </div>
        </ModalFooter>
      </Modal>

      {/* Document View Modal matching Downloaded PDF layout */}
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.title ?? "Document view"} size="wide" variant="centered">
        {preview && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 pb-3">
              <p className="text-xs text-zinc-500">
                {preview.project} · Controlled Document Snapshot As of {preview.asOf}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const blob = await exportGeneratedReport(preview, "pdf");
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${preview.title} - ${preview.project}.pdf`.replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").slice(0, 160);
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="inline-flex items-center gap-1.5 rounded border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
                >
                  <FileDown className="size-3.5" />Download PDF
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const blob = await exportGeneratedReport(preview, "xlsx");
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${preview.title} - ${preview.project}.xlsx`.replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").slice(0, 160);
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="inline-flex items-center gap-1.5 rounded border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
                >
                  <FileSpreadsheet className="size-3.5" />Download Excel
                </button>
              </div>
            </div>

            <div className="max-h-[75vh] overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-100/70 p-3 sm:p-6 shadow-inner">
              <ReportDocumentSheet report={preview} />
            </div>

            <ModalFooter>
              <div className="flex justify-end gap-2">
                <button className={button} onClick={() => setPreview(null)}>Close</button>
              </div>
            </ModalFooter>
          </div>
        )}
      </Modal>
    </div>
  );
}
