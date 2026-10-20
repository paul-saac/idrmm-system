"use client";

import { useState, type FormEvent } from "react";
import { ChevronDown, ChevronRight, FileText, LayoutGrid, List, Plus, Search } from "lucide-react";
import { DocumentThumbnail, DocumentViewer, documentFileUrl, type ThumbnailCache } from "./document-preview";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { listSheets, submitSheet, sheetDetails, reviewSheet } from "@/lib/sheets/actions";
import { DISCIPLINES, DOCUMENT_TYPES, SHEET_STATUS, type DocumentType, type Sheet } from "@/lib/sheets/model";

const input = "w-full rounded border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500";
const button = "rounded border border-zinc-200 px-3 py-2 text-sm disabled:opacity-50";
const date = (value: string) => new Date(value.length === 10 ? `${value}T00:00:00+08:00` : value).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" });

export function SheetsSection({ projectId }: { projectId: number }) {
  const [open, setOpen] = useState(false);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canReview, setCanReview] = useState(false);
  const [query, setQuery] = useState("");
  const [discipline, setDiscipline] = useState("");
  const [group, setGroup] = useState<"drawings" | "documents">("drawings");
  const [documentType, setDocumentType] = useState<DocumentType>("drawing");
  const [signedDocument, setSignedDocument] = useState(true);
  const [views, setViews] = useState<Record<"drawings" | "documents", "list" | "grid">>({ drawings: "list", documents: "list" });
  const view = views[group];
  const [thumbnailCache] = useState<ThumbnailCache>(() => new Map());
  const [upload, setUpload] = useState<{ previous?: Sheet } | null>(null);
  const [selected, setSelected] = useState<Awaited<ReturnType<typeof sheetDetails>> | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [decision, setDecision] = useState<Sheet["status"]>("accepted");
  const [comments, setComments] = useState("");
  async function load() {
    setLoading(true);
    try { const result = await listSheets(projectId); setSheets(result.sheets); setCanReview(result.canReview); setError(result.error); setLoaded(!result.error); }
    catch { setError("Could not load sheets. Please retry."); }
    finally { setLoading(false); }
  }
  async function inspect(id: number) {
    setDetailLoading(true); setSelected(null); setFormError(null); setComments("");
    try { setSelected(await sheetDetails(projectId, id)); }
    catch { setSelected({ sheet: null, drawingUrl: null, evidenceUrl: null, reviews: [], error: "Could not load sheet details." }); }
    finally { setDetailLoading(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setPending(true); setFormError(null);
    try { const result = await submitSheet(projectId, form); if (result.error) setFormError(result.error); else { setUpload(null); await load(); } }
    catch { setFormError("Could not submit the sheet. Please retry."); }
    finally { setPending(false); }
  }
  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected?.sheet) return; setPending(true); setFormError(null);
    try {
      const result = await reviewSheet(projectId, selected.sheet.id, decision, comments, selected.sheet.reviewed_at);
      if (result.error) setFormError(result.error);
      else { setSelected(await sheetDetails(projectId, selected.sheet.id)); setComments(""); await load(); }
    } catch { setFormError("Could not save the review. Please retry."); }
    finally { setPending(false); }
  }
  const latest = new Map<string, number>();
  sheets.forEach(s => latest.set(s.sheet_number, Math.max(latest.get(s.sheet_number) ?? 0, s.revision)));
  const visible = sheets.filter(s => s.revision === latest.get(s.sheet_number) && (group === "drawings" ? s.document_type === "drawing" : s.document_type !== "drawing") && (group !== "drawings" || !discipline || s.discipline === discipline) && `${s.sheet_number} ${s.title} ${s.change_notes}`.toLowerCase().includes(query.toLowerCase()));
  const detail = selected?.sheet;
  return <section className="rounded-b border border-t-0 border-zinc-200 bg-white">
    <button type="button" aria-expanded={open} onClick={() => { setOpen(!open); if (!open && !loaded && !loading) void load(); }} className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-zinc-50">
      <FileText className="size-4 text-zinc-400" /><span className="text-sm font-medium">Sheets</span>{loaded && <span className="text-xs text-zinc-400">{latest.size}</span>}<span className="ml-auto flex shrink-0 items-center gap-1 text-sm font-medium text-zinc-700">Documents<ChevronRight className={`size-4 transition-transform ${open ? "rotate-90" : ""}`} /></span>
    </button>
    {open && <div className="border-t border-zinc-200">
      <div className="flex gap-6 border-b border-zinc-200 px-5 pt-4">
        {(["drawings", "documents"] as const).map(value => <button key={value} aria-pressed={group === value} onClick={() => setGroup(value)} className={`border-b-2 pb-3 text-sm font-medium ${group === value ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-500"}`}>{value === "drawings" ? "Construction Drawings" : "Project Documents"}</button>)}
      </div>
      <div className="flex flex-wrap items-center gap-3 p-5">
        <h3 className="text-sm font-medium">{group === "drawings" ? "Construction Drawings" : "Project Documents"}</h3>
        <div className="relative ml-auto"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-zinc-400" /><input aria-label="Search sheets" placeholder="Search reference or document" className={`${input} pl-9`} value={query} onChange={e => setQuery(e.target.value)} /></div>
        {group === "drawings" && <span className="relative inline-block "><select aria-label="Drawing discipline" className={`${input} !w-auto appearance-none pr-9`} value={discipline} onChange={e => setDiscipline(e.target.value)}><option value="">All disciplines</option>{DISCIPLINES.map(d => <option key={d}>{d}</option>)}</select><ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" /></span>}
        <div role="group" aria-label="Document view" className="flex rounded border border-zinc-200 p-1">
          {(["list", "grid"] as const).map(mode => <button key={mode} type="button" aria-label={mode === "list" ? "List view" : "Grid view"} aria-pressed={view === mode} onClick={() => setViews(current => ({ ...current, [group]: mode }))} className={`rounded p-1.5 ${view === mode ? "bg-zinc-100 text-zinc-900" : "text-zinc-400 hover:bg-zinc-50"}`}>{mode === "list" ? <List className="size-4" /> : <LayoutGrid className="size-4" />}</button>)}
        </div>
        <button disabled={!loaded || loading} className={`${button} flex items-center gap-2 bg-zinc-900 text-white`} onClick={() => { setUpload({}); setDocumentType(group === "drawings" ? "drawing" : "bom"); setSignedDocument(true); setFormError(null); }}><Plus className="size-4" />Add document</button>
      </div>
      {error ? <div role="alert" className="p-5 text-sm text-red-600">{error} <button onClick={load} className="underline">Retry</button></div> : loading ? <p role="status" className="p-5 text-sm text-zinc-500">Loading sheets...</p> : view === "grid" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3 border-t border-zinc-200 p-5">
          {visible.map(s => <button key={s.id} type="button" onClick={() => inspect(s.id)} className="flex flex-col gap-2 rounded border border-zinc-200 p-3 text-left transition hover:border-zinc-400 hover:bg-zinc-50">
            <div className="flex w-full items-center justify-between gap-2"><span className="text-xs text-zinc-500">{s.file_path.endsWith(".pdf") ? "PDF" : "Image"}</span><span className="text-xs text-zinc-500">R{s.revision}</span></div>
            <DocumentThumbnail key={`${s.id}-grid`} url={documentFileUrl(projectId, s.id)} pdf={s.file_path.endsWith(".pdf")} title={s.title} cache={thumbnailCache} large />
            <div><p className="text-sm font-semibold">{s.sheet_number}</p><p className="mt-1 break-words text-sm text-zinc-600">{s.title}</p></div>
            <p className="text-xs text-zinc-500">{group === "drawings" ? s.discipline : DOCUMENT_TYPES[s.document_type]} · {s.stage === "as_built" ? "As-built" : s.stage === "original" ? "Original" : "Revision"}</p>
            <span className={`self-start rounded px-2 py-1 text-xs ${s.status === "accepted" ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>{SHEET_STATUS[s.status]}</span>
            <div className="mt-auto flex w-full flex-wrap justify-between gap-2 border-t border-zinc-100 pt-3 text-xs text-zinc-500"><span>{s.submitted_name}</span><span>{date(s.created_at)}</span></div>
          </button>)}
          {!visible.length && <p className="col-span-full p-8 text-center text-sm text-zinc-400">{sheets.length ? "No documents match this category or search." : "No documents uploaded yet."}</p>}
        </div>
      ) : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-y border-zinc-200 bg-zinc-50 text-xs text-zinc-500"><tr>{["Reference / Document", "Revision", group === "drawings" ? "Discipline" : "Document category", "Version type", "Document review", "Submitted by", "Date"].map(h => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr></thead><tbody className="divide-y divide-zinc-100">{visible.map(s => <tr key={s.id} className="hover:bg-zinc-50"><td className="px-5 py-4"><button onClick={() => inspect(s.id)} className="flex items-center gap-3 text-left"><DocumentThumbnail key={`${s.id}-list`} url={documentFileUrl(projectId, s.id)} pdf={s.file_path.endsWith(".pdf")} title={s.title} cache={thumbnailCache} /><span><span className="block font-medium">{s.sheet_number}</span><span className="block text-xs text-zinc-500">{s.title}</span></span></button></td><td className="px-5 py-4">R{s.revision}</td><td className="px-5 py-4">{group === "drawings" ? s.discipline : DOCUMENT_TYPES[s.document_type]}</td><td className="px-5 py-4">{s.stage === "as_built" ? "As-built" : s.stage === "original" ? "Original" : "Revision"}</td><td className="px-5 py-4"><span className={`rounded px-2 py-1 text-xs ${s.status === "accepted" ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>{SHEET_STATUS[s.status]}</span></td><td className="px-5 py-4">{s.submitted_name}</td><td className="whitespace-nowrap px-5 py-4 text-xs text-zinc-500">{date(s.created_at)}</td></tr>)}{!visible.length && <tr><td colSpan={7} className="p-8 text-center text-zinc-400">{sheets.length ? "No documents match this category or search." : "No documents uploaded yet."}</td></tr>}</tbody></table></div>}
    </div>}
    <Modal open={!!upload} onClose={() => { if (!pending) setUpload(null); }} title={upload?.previous ? `New revision — ${upload.previous.sheet_number}` : "Add document"} size="wide">
      <form id="upload-sheet" onSubmit={save}><fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm">Reference / sheet number<input required maxLength={80} name="sheet_number" defaultValue={upload?.previous?.sheet_number} readOnly={!!upload?.previous} placeholder="A-01" className={input} /></label>
        <label className="space-y-1 text-sm">Document title<input required maxLength={200} name="title" defaultValue={upload?.previous?.title} className={input} /></label>
        <label className="space-y-1 text-sm">Document category<span className="relative inline-block w-full"><select name="document_type" value={documentType} disabled={!!upload?.previous} onChange={e => setDocumentType(e.target.value as DocumentType)} className={`${input} appearance-none pr-9`}>{Object.entries(DOCUMENT_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" /></span>{upload?.previous && <input type="hidden" name="document_type" value={documentType} />}</label>
        {documentType === "drawing" ? <label className="space-y-1 text-sm">Discipline<span className="relative inline-block w-full"><select name="discipline" defaultValue={upload?.previous?.discipline ?? "Architectural"} className={`${input} appearance-none pr-9`}>{DISCIPLINES.map(d => <option key={d}>{d}</option>)}</select><ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" /></span></label> : <input type="hidden" name="discipline" value="General" />}
        <label className="space-y-1 text-sm">Version type<span className="relative inline-block w-full"><select key={documentType} name="stage" defaultValue={upload?.previous ? "revision" : "original"} className={`${input} appearance-none pr-9`}>{!upload?.previous && <option value="original">Original / baseline</option>}<option value="revision">Revision</option>{documentType === "drawing" && <option value="as_built">As-built drawing</option>}</select><ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" /></span></label>
        <label className="space-y-1 text-sm sm:col-span-2">Document file<input required type="file" name="drawing" accept="application/pdf,image/png,image/jpeg" className={input} /><span className="text-xs text-zinc-400">PDF, PNG, or JPEG · 8 MB maximum per file. Export CAD files and spreadsheets to PDF.</span></label>
        <label className="space-y-1 text-sm sm:col-span-2">Changes / revision notes<textarea name="change_notes" maxLength={5000} rows={3} className={input} placeholder="Describe what changed and why. For drawings, include location, implementation date, and site instruction reference. For unchanged as-builts, confirm no changes." /></label>
        <p className="border-t border-zinc-200 pt-4 text-xs text-zinc-500 sm:col-span-2">External technical approval / as-built verification. Required before admin acceptance; For pending submissions, uncheck the signed-document option and leave the approval fields blank. Revised submissions must include their own evidence.</p>
        <label className="space-y-1 text-sm">Professional name<input name="external_name" maxLength={200} className={input} /></label>
        <label className="space-y-1 text-sm">Professional role<input name="external_role" maxLength={200} placeholder="Architect / Civil Engineer" className={input} /></label>
        <label className="space-y-1 text-sm">Approval / verification date<input type="date" name="approval_date" className={input} /></label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="signed_document" checked={signedDocument} onChange={e => setSignedDocument(e.target.checked)} />The uploaded document already contains the professional&apos;s signature / approval</label>
        {!signedDocument && <label className="space-y-1 text-sm">Separate signed approval evidence<input type="file" name="evidence" accept="application/pdf,image/png,image/jpeg" className={input} /></label>}
      </fieldset><ModalFooter><div className="flex w-full flex-wrap items-center justify-end gap-3">{formError && <p role="alert" className="mr-auto text-sm text-red-600">{formError}</p>}<button type="button" disabled={pending} className={button} onClick={() => setUpload(null)}>Cancel</button><button type="submit" form="upload-sheet" disabled={pending} className={`${button} bg-zinc-900 text-white`}>{pending ? "Uploading..." : "Submit for review"}</button></div></ModalFooter></form>
    </Modal>
    <Modal open={detailLoading || !!selected} onClose={() => { if (!pending && !detailLoading) setSelected(null); }} title={detail ? `${detail.sheet_number} — Revision ${detail.revision}` : "Sheet details"} size="wide">
      {detailLoading ? <p>Loading sheet...</p> : selected?.error ? <p role="alert" className="text-red-600">{selected.error}</p> : detail && <div className="space-y-5">
        <div><h3 className="font-semibold">{detail.title}</h3><p className="mt-1 text-sm text-zinc-500">{DOCUMENT_TYPES[detail.document_type]} · {detail.discipline} · {SHEET_STATUS[detail.status]}</p></div>
        <DocumentViewer key={detail.id} url={documentFileUrl(projectId, detail.id)} pdf={detail.file_path.endsWith(".pdf")} title={detail.title} />
        <div className="flex flex-wrap gap-3"><a className={button} href={selected?.drawingUrl ?? undefined} target="_blank" rel="noopener noreferrer">Download document</a>{selected?.evidenceUrl && <a className={button} href={selected.evidenceUrl} target="_blank" rel="noopener noreferrer">Approval evidence</a>}<button className={button} disabled={pending} onClick={() => { setSelected(null); setUpload({ previous: detail }); setDocumentType(detail.document_type); setSignedDocument(true); setFormError(null); }}>Upload new revision</button></div>
        <p className="text-xs text-zinc-400">Download links expire after five minutes. Reopen this sheet to refresh them.</p>
        <section className="border-t border-zinc-200 pt-4"><h4 className="text-sm font-medium">Field changes / revision notes</h4><p className="mt-2 whitespace-pre-wrap text-sm text-zinc-600">{detail.change_notes || "No change notes recorded."}</p></section>
        <section className="border-t border-zinc-200 pt-4"><h4 className="text-sm font-medium">External approval / verification</h4><p className="mt-2 text-sm text-zinc-600">{detail.external_name ? `${detail.external_name} · ${detail.external_role} · ${detail.approval_date ? date(detail.approval_date) : "Date not recorded"}` : "Not recorded — awaiting professional approval evidence."}</p></section>
        <section className="border-t border-zinc-200 pt-4"><h4 className="mb-2 text-sm font-medium">Revision history</h4><div className="flex flex-wrap gap-2">{sheets.filter(s => s.sheet_number === detail.sheet_number).sort((a,b) => b.revision-a.revision).map(s => <button key={s.id} disabled={pending} onClick={() => inspect(s.id)} className={`${button} ${s.id === detail.id ? "bg-zinc-100" : ""}`}>R{s.revision} · {SHEET_STATUS[s.status]}</button>)}</div></section>
        <section className="border-t border-zinc-200 pt-4"><h4 className="text-sm font-medium">Document review history</h4>{!selected?.reviews.length && <p className="mt-2 text-sm text-zinc-400">Awaiting admin review.</p>}{selected?.reviews.map(r => <div key={r.id} className="mt-3 border-l-2 border-zinc-200 pl-3"><p className="text-sm">{SHEET_STATUS[r.status as Sheet["status"]]} · {r.reviewer_name} · {date(r.created_at)}</p><p className="mt-1 whitespace-pre-wrap text-sm text-zinc-500">{r.notes}</p></div>)}</section>
        {canReview && <form onSubmit={review} className="space-y-3 border-t border-zinc-200 pt-4"><h4 className="text-sm font-medium">Admin document review</h4><p className="text-xs text-zinc-500">Check the revision and attached professional approval. Acceptance does not certify technical correctness.</p><span className="relative inline-block w-full"><select aria-label="Review decision" disabled={pending} className={`${input} appearance-none pr-9`} value={decision} onChange={e => setDecision(e.target.value as Sheet["status"])}><option value="accepted">Accept for project records</option><option value="changes_requested">Request changes</option><option value="rejected">Reject submission</option></select><ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" /></span><textarea aria-label="Review comments" required maxLength={2000} disabled={pending} value={comments} onChange={e => setComments(e.target.value)} placeholder="Document review comments" rows={3} className={input} />{formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}<button disabled={pending} className={`${button} bg-zinc-900 text-white`}>{pending ? "Saving..." : "Save review"}</button></form>}
      </div>}
    </Modal>
  </section>;
}
