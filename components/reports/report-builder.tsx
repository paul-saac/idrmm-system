"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { usePortal } from "@/components/portal/portal-context";
import { ChevronDown, Eye, FileDown, FileSpreadsheet, Pencil } from "lucide-react";
import { Modal, ModalFooter } from "@/components/ui/modal";
import type { CloseoutReportData } from "@/lib/reports/closeout-data";
import {
  generateReport,
  generateAsBuiltReport,
  REPORT_SECTIONS,
  MILESTONE_COLUMNS,
  AS_BUILT_SECTIONS,
  AS_BUILT_COLUMNS,
  type GeneratedReport,
  type ReportSectionId,
  type AsBuiltSectionId,
} from "@/lib/reports/generated-report";
import { exportGeneratedReport } from "@/lib/reports/generated-report-export";
import { CloseoutEditor } from "./closeout-report";
import type { ProjectOption } from "./project-picker";

const input = "w-full rounded border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500";
const button = "inline-flex items-center justify-center gap-2 rounded border border-zinc-200 bg-white px-4 py-2 text-sm font-medium disabled:opacity-50";
const types = [
  { id: "full", label: "Project closeout report", description: "Master summary of the project lifecycle, final outcomes, key milestones met, lessons learned, and overall performance." },
  { id: "punch", label: "Punch list report", description: "Remaining, incomplete, or defective items to resolve before final payment and sign-off.", requires: "A recorded punch list with item status and sign-off details." },
  { id: "as-built", label: "As-built drawing & record report", description: "Final construction records compared with the original design, including field changes." },
  { id: "financial", label: "Final financial & job cost report", description: "Original budget versus actual expenditures, final billings, unbilled revenue, profit margins, and subcontractor payouts.", requires: "Connected billing, revenue, and subcontractor payout records alongside project costs." },
  { id: "quality", label: "Quality assurance and inspection sign-off reports", description: "Final inspection certificates, test results, and authority or third-party compliance sign-offs.", requires: "Recorded inspections, test results, certificates, and compliance sign-offs." },
  { id: "safety", label: "Safety and incident closeout report", description: "Overall safety performance and recorded accident or incident reviews during the project.", requires: "Verified safety and incident records. Missing records cannot establish zero accidents." },
] as const;

export function ReportBuilder({ data, projects }: { data: CloseoutReportData; projects: ProjectOption[] }) {
  const router = useRouter();
  const { basePath } = usePortal();
  const [switchingProject, startProjectTransition] = useTransition();
  const [type, setType] = useState<string>("full");
  const selectedType = types.find(item => item.id === type) ?? types[0];
  const available = type === "full" || type === "as-built";
  const [title, setTitle] = useState("Project closeout report");
  const [sections, setSections] = useState<ReportSectionId[]>(REPORT_SECTIONS.map(s => s.id));
  const [columns, setColumns] = useState<string[]>([...MILESTONE_COLUMNS]);
  const [asBuiltSections, setAsBuiltSections] = useState<AsBuiltSectionId[]>(AS_BUILT_SECTIONS.map(s => s.id));
  const [asBuiltColumns, setAsBuiltColumns] = useState<string[]>([...AS_BUILT_COLUMNS]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [generating, setBusy] = useState(false);
  const busy = generating || switchingProject;
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [ready, setReady] = useState<{ report: GeneratedReport; url?: string; filename?: string } | null>(null);
  const [preview, setPreview] = useState<GeneratedReport | null>(null);
  const downloadUrl = useRef<string | null>(null);
  useEffect(() => () => { if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current); }, []);
  const uniqueSheetCount = new Set((data.sheets ?? []).map(s => s.sheet_number)).size;
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
        ? generateAsBuiltReport(data, { title, sections: asBuiltSections, columns: asBuiltColumns, from, to })
        : generateReport(data, { title, sections, columns, from, to });
      if (format === "view") setReady({ report });
      else {
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
  return <div className="flex min-h-full flex-1 flex-col bg-white md:flex-row">
    <nav aria-label="Report types" className="border-b border-zinc-200 py-5 md:w-60 md:shrink-0 md:border-r md:border-b-0">
      <h2 className="border-b border-zinc-200 px-6 pb-4 text-base font-semibold">Report type</h2>
      {types.map(item => <button key={item.id} disabled={busy} aria-current={type === item.id ? "page" : undefined} onClick={() => {
        setType(item.id);
        setTitle(item.label);
        if (item.id === "full") setSections(REPORT_SECTIONS.map(s => s.id));
        if (item.id === "as-built") setAsBuiltSections(AS_BUILT_SECTIONS.map(s => s.id));
        setError("");
      }} className={`block w-full px-6 py-3 text-left text-sm ${type === item.id ? "bg-zinc-100 font-medium text-zinc-900" : "text-zinc-500 hover:bg-zinc-50"}`}>{item.label}</button>)}
    </nav>
    <div className="flex min-w-0 flex-1 flex-col p-6 sm:p-8">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{types.find(t => t.id === type)?.label}</h2>
        {type === "full" && <button className={button} disabled={busy || !data.storageAvailable} onClick={() => setEditing(true)}><Pencil className="size-3.5" />Edit closeout details</button>}
      </div>
      <p className="mb-5 text-sm text-zinc-500">{selectedType.description}</p>
      {!available && <div role="status" className="mb-5 rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><p className="font-medium">Report generation not connected yet</p><p className="mt-1">Required: {"requires" in selectedType ? selectedType.requires : ""}</p></div>}
      {type === "full" && !data.storageAvailable && <p className="mb-5 text-sm text-amber-700">Closeout detail saving is not available yet. Project figures can still be reported; missing details are marked as not recorded.</p>}
      {type === "as-built" && !data.sheetsAvailable && <p className="mb-5 text-sm text-amber-700">Sheets storage is not enabled yet. Apply migration 0077 in Supabase to load project drawing and document records.</p>}
      <fieldset disabled={busy} className="grid gap-8 disabled:opacity-60 xl:grid-cols-2">
        <div className="space-y-5">
          <label className="flex items-center gap-3 text-sm text-zinc-500"><span className="w-14 shrink-0">Title</span><input value={title} maxLength={120} onChange={e => setTitle(e.target.value)} className={`${input} max-w-sm`} /></label>
          <label className="flex items-center gap-3 text-sm text-zinc-500"><span className="w-14 shrink-0">Project</span><span className="relative w-full max-w-sm"><select value={data.project.id} className={`${input} cursor-pointer appearance-none pr-9 text-zinc-900`} onChange={event => {
            const projectId = event.target.value;
            startProjectTransition(() => router.push(`${basePath}/reports?projectId=${projectId}`));
          }}>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select><ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" /></span></label>
          {available && (
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
          {type === "full" && <fieldset><legend className="mb-3 text-sm text-zinc-500">Include sections</legend><div className="space-y-3">{REPORT_SECTIONS.map(s => <label key={s.id} className="flex items-center gap-2 text-sm"><span className="relative flex size-4 shrink-0 items-center justify-center"><input type="checkbox" className="peer size-4 cursor-pointer appearance-none rounded border border-zinc-300 bg-white transition checked:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-200 focus-visible:outline-none" checked={sections.includes(s.id)} onChange={e => setSections(current => e.target.checked ? [...current, s.id] : current.filter(id => id !== s.id))} /><span className="pointer-events-none absolute size-2 rounded-[1px] bg-zinc-900 opacity-0 transition peer-checked:opacity-100" /></span>{s.label}</label>)}</div></fieldset>}
          {type === "as-built" && <fieldset><legend className="mb-3 text-sm text-zinc-500">Include sections</legend><div className="space-y-3">{AS_BUILT_SECTIONS.map(s => <label key={s.id} className="flex items-center gap-2 text-sm"><span className="relative flex size-4 shrink-0 items-center justify-center"><input type="checkbox" className="peer size-4 cursor-pointer appearance-none rounded border border-zinc-300 bg-white transition checked:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-200 focus-visible:outline-none" checked={asBuiltSections.includes(s.id)} onChange={e => setAsBuiltSections(current => e.target.checked ? [...current, s.id] : current.filter(id => id !== s.id))} /><span className="pointer-events-none absolute size-2 rounded-[1px] bg-zinc-900 opacity-0 transition peer-checked:opacity-100" /></span>{s.label}</label>)}</div></fieldset>}
          <p className="text-sm text-zinc-400">
            {type === "as-built"
              ? `Connected to project Sheets (${uniqueSheetCount} reference${uniqueSheetCount === 1 ? "" : "s"}, ${(data.sheets ?? []).length} total version${(data.sheets ?? []).length === 1 ? "" : "s"} as of ${data.asOf}).`
              : `Project snapshot as of ${data.asOf}. Unrecorded details are never inferred.`}
          </p>
        </div>
        {type === "full" && sections.includes("milestones") && <div className="space-y-6 xl:border-l xl:border-zinc-200 xl:pl-8">
          <fieldset><legend className="mb-3 text-sm text-zinc-500">Milestone columns</legend>
            <label className="mb-3 flex items-center gap-2 text-sm"><span className="relative flex size-4 shrink-0 items-center justify-center"><input type="checkbox" className="peer size-4 cursor-pointer appearance-none rounded border border-zinc-300 bg-white transition checked:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-200 focus-visible:outline-none" checked={columns.length === MILESTONE_COLUMNS.length} onChange={e => setColumns(e.target.checked ? [...MILESTONE_COLUMNS] : [])} /><span className="pointer-events-none absolute size-2 rounded-[1px] bg-zinc-900 opacity-0 transition peer-checked:opacity-100" /></span>All columns</label>
            <div className="space-y-3 pl-5">{MILESTONE_COLUMNS.map(c => <label key={c} className="flex items-center gap-2 text-sm"><span className="relative flex size-4 shrink-0 items-center justify-center"><input type="checkbox" className="peer size-4 cursor-pointer appearance-none rounded border border-zinc-300 bg-white transition checked:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-200 focus-visible:outline-none" checked={columns.includes(c)} onChange={e => setColumns(current => MILESTONE_COLUMNS.filter(col => col === c ? e.target.checked : current.includes(col)))} /><span className="pointer-events-none absolute size-2 rounded-[1px] bg-zinc-900 opacity-0 transition peer-checked:opacity-100" /></span>{c}</label>)}</div>
          </fieldset>
        </div>}
        {type === "as-built" && asBuiltSections.includes("as_built_register") && <div className="space-y-6 xl:border-l xl:border-zinc-200 xl:pl-8">
          <fieldset><legend className="mb-3 text-sm text-zinc-500">Register columns</legend>
            <label className="mb-3 flex items-center gap-2 text-sm"><span className="relative flex size-4 shrink-0 items-center justify-center"><input type="checkbox" className="peer size-4 cursor-pointer appearance-none rounded border border-zinc-300 bg-white transition checked:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-200 focus-visible:outline-none" checked={asBuiltColumns.length === AS_BUILT_COLUMNS.length} onChange={e => setAsBuiltColumns(e.target.checked ? [...AS_BUILT_COLUMNS] : [])} /><span className="pointer-events-none absolute size-2 rounded-[1px] bg-zinc-900 opacity-0 transition peer-checked:opacity-100" /></span>All columns</label>
            <div className="space-y-3 pl-5">{AS_BUILT_COLUMNS.map(c => <label key={c} className="flex items-center gap-2 text-sm"><span className="relative flex size-4 shrink-0 items-center justify-center"><input type="checkbox" className="peer size-4 cursor-pointer appearance-none rounded border border-zinc-300 bg-white transition checked:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-200 focus-visible:outline-none" checked={asBuiltColumns.includes(c)} onChange={e => setAsBuiltColumns(current => AS_BUILT_COLUMNS.filter(col => col === c ? e.target.checked : current.includes(col)))} /><span className="pointer-events-none absolute size-2 rounded-[1px] bg-zinc-900 opacity-0 transition peer-checked:opacity-100" /></span>{c}</label>)}</div>
          </fieldset>
        </div>}
      </fieldset>
      <div className="mt-auto pt-10">
        {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-5">
          <button disabled={busy || !available} onClick={() => generate("view")} className={`${button} !border-zinc-900 !bg-zinc-900 text-white`}><Eye className="size-4" />View</button>
          <button disabled={busy || !available} onClick={() => generate("pdf")} className={button}><FileDown className="size-4" />PDF</button>
          <button disabled={busy || !available} onClick={() => generate("xlsx")} className={button}><FileSpreadsheet className="size-4" />Excel</button>
          {busy && <span role="status" className="ml-2 text-sm text-zinc-500">{switchingProject ? "Loading project..." : "Generating report..."}</span>}
        </div>
      </div>
    </div>
    <Modal open={editing} onClose={() => setEditing(false)} title="Edit project closeout details" size="wide"><CloseoutEditor data={data} onClose={() => setEditing(false)} /></Modal>
    <Modal open={!!ready} onClose={closeReady} title="Report complete" size="small" variant="centered">
      <p className="text-sm text-zinc-500">Your report is ready{ready?.url ? ", click below to download." : "."}</p>
      {ready?.url && <a href={ready.url} download={ready.filename} className="mt-4 block break-words text-sm font-medium text-emerald-700 underline">{ready.filename}</a>}
      <ModalFooter><div className="flex justify-end gap-2">{ready && !ready.url && <button className={`${button} !bg-zinc-900 text-white`} onClick={() => { setPreview(ready.report); closeReady(); }}>View</button>}<button className={button} onClick={closeReady}>Close</button></div></ModalFooter>
    </Modal>
    <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.title ?? "Report preview"} size="large" variant="centered">
      {preview && <article className="space-y-6"><p className="text-sm text-zinc-500">{preview.project} · As of {preview.asOf}</p>{preview.sections.map(s => <section key={s.title} className="overflow-hidden rounded border border-zinc-200">
        <h3 className="border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-medium">{s.title}</h3>
        <div className="space-y-3 p-4">{s.paragraphs.map((p, i) => <p key={i} className="whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-600">{p}</p>)}</div>
        {!!s.rows.length && <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-y border-zinc-200 bg-zinc-50"><tr>{s.headers.map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead><tbody>{s.rows.map((row, i) => <tr key={i} className="border-b border-zinc-100">{row.map((value, j) => <td key={j} className="px-4 py-3">{value}</td>)}</tr>)}</tbody></table></div>}
      </section>)}</article>}
    </Modal>
  </div>;
}
