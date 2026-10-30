"use client";

import { RequiredMark } from "@/components/ui/required-mark";
import { ProjectWriteButton } from "@/components/projects/project-access-context";
import { EmptyState } from "@/components/ui/empty-state";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Check, ChevronDown, ChevronRight, ClipboardCheck, Clock3, FileText, History, Info, LayoutGrid, List, Plus, Search, ShieldCheck, Upload } from "lucide-react";
import { DocumentThumbnail, DocumentViewer, documentFileUrl, type ThumbnailCache } from "./document-preview";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal, ModalFooter, ModalHeaderAddon } from "@/components/ui/modal";
import { DatePicker } from "@/components/ui/date-picker";
import { listSheets, submitSheet, sheetDetails, reviewSheet, deleteSheet } from "@/lib/sheets/actions";
import { DISCIPLINES, DOCUMENT_TYPES, SHEET_STATUS, formatVersion, type DocumentType, type Sheet } from "@/lib/sheets/model";

const input = "w-full rounded border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500";
const button = "rounded border border-zinc-200 px-3 py-2 text-sm disabled:opacity-50";
const sectionTitle = "text-sm font-semibold text-zinc-900";
const field = "flex min-w-0 flex-col gap-1.5";
const fieldLabel = "text-sm font-medium text-zinc-700";
const selectChevron = "pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500";

/** A file input styled as the form's other fields: a Choose file button
 * and the picked file's name beside it. The real input stays in the form
 * (visually hidden), so it still submits and is still required. */
function FilePicker({ name, required = false, label }: { name: string; required?: boolean; label: string }) {
  const [fileName, setFileName] = useState("");
  return <label className="relative flex cursor-pointer items-center rounded border border-zinc-200 bg-white text-sm focus-within:border-zinc-500">
    <input type="file" name={name} required={required} aria-label={label} accept="application/pdf,image/png,image/jpeg" onChange={e => setFileName(e.target.files?.[0]?.name ?? "")} className="absolute inset-0 size-full cursor-pointer opacity-0" />
    <span className="flex shrink-0 items-center gap-2 border-r border-zinc-200 px-3 py-2 font-medium text-zinc-700"><Upload aria-hidden className="size-4" />Choose file</span>
    <span className={`min-w-0 truncate px-3 ${fileName ? "text-zinc-700" : "text-zinc-400"}`}>{fileName || "No file chosen"}</span>
  </label>;
}
const date = (value: string) => new Date(value.length === 10 ? `${value}T00:00:00+08:00` : value).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" });

type Detail = Omit<Awaited<ReturnType<typeof sheetDetails>>, "drawingUrl"> & { drawingUrl: string | null };

export function SheetsSection({
  projectId,
  insightRequest,
  initialSheets,
  initialCanReview = false,
  initialError = null,
}: {
  projectId: number;
  insightRequest?: number;
  initialSheets?: Sheet[];
  initialCanReview?: boolean;
  initialError?: string | null;
}) {
  const preloaded = initialSheets !== undefined;
  const [open, setOpen] = useState(false);
  const [sheets, setSheets] = useState<Sheet[]>(initialSheets ?? []);
  const [loaded, setLoaded] = useState(preloaded && !initialError);
  const [loading, setLoading] = useState(!preloaded);
  const [error, setError] = useState<string | null>(initialError);
  const [canReview, setCanReview] = useState(initialCanReview);
  const [query, setQuery] = useState("");
  const [discipline, setDiscipline] = useState("");
  const [group, setGroup] = useState<"drawings" | "documents">("drawings");
  const [handledInsightRequest, setHandledInsightRequest] = useState<number | undefined>(undefined);
  if (insightRequest !== undefined && insightRequest !== handledInsightRequest) {
    setHandledInsightRequest(insightRequest);
    setOpen(true);
    setGroup("documents");
  }
  const [documentType, setDocumentType] = useState<DocumentType>("drawing");
  const [signedDocument, setSignedDocument] = useState(true);
  const [uploadStage, setUploadStage] = useState("original");
  // One shared display switch: changing document categories keeps the user's
  // chosen List/Grid presentation instead of silently reverting per category.
  const [view, setView] = useState<"list" | "grid">("list");
  const [thumbnailCache] = useState<ThumbnailCache>(() => new Map());
  const [upload, setUpload] = useState<{ previous?: Sheet } | null>(null);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [decision, setDecision] = useState<Sheet["status"]>("accepted");
  const [comments, setComments] = useState("");
  async function load() {
    if (!loaded) setLoading(true);
    try { const result = await listSheets(projectId); setSheets(result.sheets); setCanReview(result.canReview); setError(result.error); setLoaded(!result.error); }
    catch { setError("Could not load sheets. Please retry."); }
    finally { setLoading(false); }
  }
  // Fetched as soon as the project page mounts when not preloaded on the server.
  useEffect(() => {
    if (preloaded) return;
    let canceled = false;
    listSheets(projectId)
      .then(result => { if (canceled) return; setSheets(result.sheets); setCanReview(result.canReview); setError(result.error); setLoaded(!result.error); })
      .catch(() => { if (!canceled) setError("Could not load sheets. Please retry."); })
      .finally(() => { if (!canceled) setLoading(false); });
    return () => { canceled = true; };
  }, [projectId, preloaded]);
  // The sheet itself is already in the list, so the modal opens on it right
  // away; only its review history is fetched (and remembered per revision).
  const reviewCache = useRef(new Map<number, Detail["reviews"]>());
  const inspecting = useRef<number | null>(null);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const rawSheetId = Number(searchParams.get("sheet"));
  const sheetId = Number.isSafeInteger(rawSheetId) && rawSheetId > 0 ? rawSheetId : null;
  const [handledSheetId, setHandledSheetId] = useState<number | null>(null);
  if (sheetId !== handledSheetId) {
    setHandledSheetId(sheetId);
    if (sheetId !== null) {
      const known = sheets.find(s => s.id === sheetId);
      setOpen(true);
      setGroup(known?.document_type === "drawing" ? "drawings" : "documents");
      setQuery(""); setDiscipline(""); setComments(""); setFormError(null);
      setConfirmingDelete(false); setDeleteError(null);
      setSelected(known ? { sheet: known, drawingUrl: null, evidenceUrl: null, reviews: [], error: null } : null);
      setDetailLoading(!known);
      setReviewsLoading(true);
    }
  }
  useEffect(() => {
    if (sheetId === null) return;
    let cancelled = false;
    inspecting.current = sheetId;
    sheetDetails(projectId, sheetId).then(result => {
      if (cancelled || inspecting.current !== sheetId) return;
      if (!result.error) reviewCache.current.set(sheetId, result.reviews);
      setSelected(result);
    }).catch(() => {
      if (!cancelled && inspecting.current === sheetId) {
        setSelected({ sheet: null, drawingUrl: null, evidenceUrl: null, reviews: [], error: "Could not load sheet details. Close and try again." });
      }
    }).finally(() => {
      if (!cancelled && inspecting.current === sheetId) { setDetailLoading(false); setReviewsLoading(false); }
    });
    return () => { cancelled = true; };
  }, [projectId, sheetId]);
  function closeDetail() {
    inspecting.current = null; setSelected(null); setDetailLoading(false);
    setReviewsLoading(false); setConfirmingDelete(false); setDeleteError(null);
    // Allow the same notification to reopen after closing its document.
    const url = new URL(window.location.href);
    if (url.searchParams.has("sheet")) {
      url.searchParams.delete("sheet");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }
  async function inspect(id: number) {
    setFormError(null); setComments(""); setConfirmingDelete(false); setDeleteError(null);
    inspecting.current = id;
    const known = sheets.find(s => s.id === id);
    const knownReviews = reviewCache.current.get(id);
    if (known) { setSelected({ sheet: known, drawingUrl: null, evidenceUrl: null, reviews: knownReviews ?? [], error: null }); setDetailLoading(false); }
    else { setSelected(null); setDetailLoading(true); }
    setReviewsLoading(!knownReviews);
    try {
      const result = await sheetDetails(projectId, id);
      if (inspecting.current !== id) return;
      if (!result.error) reviewCache.current.set(id, result.reviews);
      if (!result.error || !known) setSelected(result);
    } catch {
      if (inspecting.current === id && !known) setSelected({ sheet: null, drawingUrl: null, evidenceUrl: null, reviews: [], error: "Could not load sheet details." });
    } finally {
      if (inspecting.current === id) { setDetailLoading(false); setReviewsLoading(false); }
    }
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
      else { const fresh = await sheetDetails(projectId, selected.sheet.id); if (!fresh.error) reviewCache.current.set(selected.sheet.id, fresh.reviews); setSelected(fresh); setComments(""); await load(); }
    } catch { setFormError("Could not save the review. Please retry."); }
    finally { setPending(false); }
  }
  async function remove() {
    if (!selected?.sheet || deleting) return;
    const targetNumber = selected.sheet.sheet_number;
    setDeleting(true); setDeleteError(null);
    try {
      const result = await deleteSheet(projectId, selected.sheet.id);
      if (result.error) setDeleteError(result.error);
      else {
        sheets.filter(s => s.sheet_number === targetNumber).forEach(s => reviewCache.current.delete(s.id));
        setSheets(current => current.filter(s => s.sheet_number !== targetNumber));
        closeDetail();
        await load();
      }
    } catch { setDeleteError("Could not delete the document. Please retry."); }
    finally { setDeleting(false); }
  }
  const latest = new Map<string, number>();
  sheets.forEach(s => latest.set(s.sheet_number, Math.max(latest.get(s.sheet_number) ?? 0, s.revision)));
  const visible = sheets.filter(s => s.revision === latest.get(s.sheet_number) && (group === "drawings" ? s.document_type === "drawing" : s.document_type !== "drawing") && (group !== "drawings" || !discipline || s.discipline === discipline) && `${s.sheet_number} ${s.title} ${s.change_notes}`.toLowerCase().includes(query.toLowerCase()));
  const detail = selected?.sheet;
  return <section className="rounded border border-zinc-200 bg-white">
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-zinc-50">
      <FileText className="size-4 text-zinc-400" /><span className="text-sm font-medium">Sheets</span><span className="ml-auto flex shrink-0 items-center gap-1 text-sm font-medium text-zinc-700">Documents<ChevronRight className={`size-4 transition-transform ${open ? "rotate-90" : ""}`} /></span>
    </button>
    {open && <div className="border-t border-zinc-200">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
      <div role="tablist" aria-label="Document section" className="relative inline-grid grid-cols-2 rounded border border-zinc-200 bg-zinc-100 p-1">
        <span
          aria-hidden
          className={`pointer-events-none absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded bg-white shadow-2xs transition-transform duration-250 ease-out ${group === "documents" ? "translate-x-full" : "translate-x-0"}`}
        />
        {(["drawings", "documents"] as const).map(value => <button key={value} role="tab" type="button" aria-selected={group === value} onClick={() => setGroup(value)} className={`relative z-10 cursor-pointer rounded px-3.5 py-1.5 text-xs font-medium transition-colors duration-200 ${group === value ? "text-zinc-900" : "text-zinc-500 hover:text-zinc-900"}`}>{value === "drawings" ? "Construction Drawings" : "Project Documents"}</button>)}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-3">
        <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-zinc-400" /><input aria-label="Search sheets" placeholder="Search reference or document" className={`${input} !w-64 pl-9`} value={query} onChange={e => setQuery(e.target.value)} /></div>
        {group === "drawings" && <span className="relative inline-block "><select aria-label="Drawing discipline" className={`${input} !w-auto appearance-none pr-9`} value={discipline} onChange={e => setDiscipline(e.target.value)}><option value="">All disciplines</option>{DISCIPLINES.map(d => <option key={d}>{d}</option>)}</select><ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" /></span>}
        <div
          role="group"
          aria-label="Document view"
          className="relative grid grid-cols-2 rounded border border-zinc-200 bg-white p-1"
        >
          <span
            aria-hidden
            className={`pointer-events-none absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded bg-zinc-100 transition-transform duration-200 ease-out ${view === "grid" ? "translate-x-full" : "translate-x-0"}`}
          />
          {(["list", "grid"] as const).map(mode => <button key={mode} type="button" aria-label={mode === "list" ? "List view" : "Grid view"} aria-pressed={view === mode} onClick={() => setView(mode)} className={`relative z-10 cursor-pointer rounded p-1.5 transition-colors duration-150 ${view === mode ? "text-zinc-900" : "text-zinc-400 hover:text-zinc-700"}`}>{mode === "list" ? <List className="size-4" /> : <LayoutGrid className="size-4" />}</button>)}
        </div>
        <ProjectWriteButton className={`${button} flex items-center gap-2 bg-zinc-900 text-white`} onClick={() => { setUpload({}); setUploadStage("original"); setDocumentType(group === "drawings" ? "drawing" : "bom"); setSignedDocument(true); setFormError(null); }}><Plus className="size-4" />Add document</ProjectWriteButton>
      </div>
      </div>
      <div key={`${group}-${view}`} className="tab-content-enter">
      {error ? <div role="alert" className="p-5 text-sm text-red-600">{error} <button onClick={load} className="underline">Retry</button></div> : loading ? <p role="status" className="p-5 text-sm text-zinc-500">Loading sheets...</p> : view === "grid" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3 border-t border-zinc-200 p-5">
          {visible.map(s => <button key={s.id} type="button" onClick={() => inspect(s.id)} className="flex flex-col gap-2 rounded border border-zinc-200 p-3 text-left transition hover:border-zinc-400 hover:bg-zinc-50">
            <div className="flex w-full items-center justify-between gap-2"><span className="text-xs text-zinc-500">{s.file_path.endsWith(".pdf") ? "PDF" : "Image"}</span><span className="text-xs text-zinc-500">{formatVersion(s.revision)}</span></div>
            <DocumentThumbnail key={`${s.id}-grid`} url={documentFileUrl(projectId, s.id)} pdf={s.file_path.endsWith(".pdf")} title={s.title} cache={thumbnailCache} large />
            <div><p className="text-sm font-semibold">{s.sheet_number}</p><p className="mt-1 break-words text-sm text-zinc-600">{s.title}</p></div>
            <p className="text-xs text-zinc-500">{group === "drawings" ? s.discipline : DOCUMENT_TYPES[s.document_type]} · {s.stage === "as_built" ? "As-built" : s.stage === "original" ? "Original" : "Revision"}</p>
            <span className={`self-start rounded px-2 py-1 text-xs ${s.status === "accepted" ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>{SHEET_STATUS[s.status]}</span>
            <div className="mt-auto flex w-full flex-wrap justify-between gap-2 border-t border-zinc-100 pt-3 text-xs text-zinc-500"><span>{s.submitted_name}</span><span>{date(s.created_at)}</span></div>
          </button>)}
          {!visible.length && <EmptyState className="col-span-full p-8 text-center text-sm text-zinc-400">{sheets.length ? "No documents match this category or search." : "No documents uploaded yet."}</EmptyState>}
        </div>
      ) : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-y border-zinc-200 bg-zinc-50 text-xs text-zinc-500"><tr>{["Reference / Document", "Version", group === "drawings" ? "Discipline" : "Document category", "Stage", "Status", "Submitted by", "Date"].map(h => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr></thead><tbody className="divide-y divide-zinc-100">{visible.map(s => <tr key={s.id} className="hover:bg-zinc-50"><td className="px-5 py-4"><button onClick={() => inspect(s.id)} className="flex items-center gap-3 text-left"><DocumentThumbnail key={`${s.id}-list`} url={documentFileUrl(projectId, s.id)} pdf={s.file_path.endsWith(".pdf")} title={s.title} cache={thumbnailCache} /><span><span className="block font-medium">{s.sheet_number}</span><span className="block text-xs text-zinc-500">{s.title}</span></span></button></td><td className="px-5 py-4">{formatVersion(s.revision)}</td><td className="px-5 py-4">{group === "drawings" ? s.discipline : DOCUMENT_TYPES[s.document_type]}</td><td className="px-5 py-4">{s.stage === "as_built" ? "As-built" : s.stage === "original" ? "Original" : "Revision"}</td><td className="px-5 py-4"><span className={`rounded px-2 py-1 text-xs ${s.status === "accepted" ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>{SHEET_STATUS[s.status]}</span></td><td className="px-5 py-4">{s.submitted_name}</td><td className="whitespace-nowrap px-5 py-4 text-xs text-zinc-500">{date(s.created_at)}</td></tr>)}{!visible.length && <tr><td colSpan={7} className="p-8 text-center text-zinc-400"><EmptyState>{sheets.length ? "No documents match this category or search." : "No documents uploaded yet."}</EmptyState></td></tr>}</tbody></table></div>}
      </div>
    </div>}
    <Modal open={!!upload} onClose={() => { if (!pending) setUpload(null); }} title={upload?.previous ? `New revision — ${upload.previous.sheet_number}` : "Add document"} size="wide">
      <form id="upload-sheet" onSubmit={save}><fieldset disabled={pending} className="-mx-6 -my-5 divide-y divide-zinc-200">
        <section className="space-y-4 px-6 py-5">
          <h3 className={sectionTitle}>Document details</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={field}><span className={fieldLabel}>Reference / sheet number<RequiredMark /></span><input required maxLength={80} name="sheet_number" defaultValue={upload?.previous?.sheet_number} readOnly={!!upload?.previous} className={`${input} read-only:bg-zinc-50`} /></label>
            <label className={field}><span className={fieldLabel}>Document title<RequiredMark /></span><input required maxLength={200} name="title" defaultValue={upload?.previous?.title} className={input} /></label>
            <label className={field}><span className={fieldLabel}>Document category<RequiredMark /></span><span className="relative block"><select name="document_type" value={documentType} disabled={!!upload?.previous} onChange={e => { setDocumentType(e.target.value as DocumentType); setUploadStage(upload?.previous ? "revision" : "original"); }} className={`${input} appearance-none pr-9 disabled:bg-zinc-50`}>{Object.entries(DOCUMENT_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown aria-hidden className={selectChevron} /></span>{upload?.previous && <input type="hidden" name="document_type" value={documentType} />}</label>
            {documentType === "drawing" ? <label className={field}><span className={fieldLabel}>Discipline<RequiredMark /></span><span className="relative block"><select name="discipline" defaultValue={upload?.previous?.discipline ?? "Architectural"} className={`${input} appearance-none pr-9`}>{DISCIPLINES.map(d => <option key={d}>{d}</option>)}</select><ChevronDown aria-hidden className={selectChevron} /></span></label> : <input type="hidden" name="discipline" value="General" />}
          </div>
        </section>
        <section className="space-y-4 px-6 py-5">
          <h3 className={sectionTitle}>{upload?.previous ? "Revision details" : "File and notes"}</h3>
          <div className="grid gap-4 sm:grid-cols-[13rem_minmax(0,1fr)]">
            <label className={field}><span className={fieldLabel}>Version type<RequiredMark /></span><span className="relative block"><select key={documentType} name="stage" onChange={e => setUploadStage(e.target.value)} defaultValue={upload?.previous ? "revision" : "original"} className={`${input} appearance-none pr-9`}>{!upload?.previous && <option value="original">Original / baseline</option>}<option value="revision">Revision</option>{documentType === "drawing" && <option value="as_built">As-built drawing</option>}</select><ChevronDown aria-hidden className={selectChevron} /></span></label>
            <div className={field}><span className={fieldLabel}>Document file<RequiredMark /></span><FilePicker name="drawing" required label="Document file" /></div>
          </div>
          <label className={field}><span className={fieldLabel}>Changes / revision notes{(upload?.previous || uploadStage !== "original") && <RequiredMark />}</span><textarea name="change_notes" maxLength={5000} rows={3} className={`${input} resize-y`} /></label>
        </section>
        <section className="space-y-4 px-6 py-5">
          <h3 className={sectionTitle}>External technical approval / as-built verification</h3>
          <div className="flex gap-3 rounded border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-700" />
            <div><p className="text-amber-900">Required before admin acceptance. Revised submissions must include their own evidence.</p><p className="mt-0.5 text-xs text-amber-700">For pending submissions, uncheck the signed-document option and leave the approval fields blank.</p></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className={field}><span className={fieldLabel}>Professional name{signedDocument && <RequiredMark />}</span><input name="external_name" maxLength={200} disabled={!signedDocument} className={`${input} disabled:bg-zinc-50`} /></label>
            <label className={field}><span className={fieldLabel}>Professional role{signedDocument && <RequiredMark />}</span><input name="external_role" maxLength={200} disabled={!signedDocument} className={`${input} disabled:bg-zinc-50`} /></label>
            <label className={field}><span className={fieldLabel}>Approval / verification date{signedDocument && <RequiredMark />}</span><DatePicker name="approval_date" ariaLabel="Approval or verification date" disabled={!signedDocument} className={`${input} disabled:bg-zinc-50`} /></label>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-700"><input type="checkbox" name="signed_document" checked={signedDocument} onChange={e => setSignedDocument(e.target.checked)} className="size-4 rounded accent-zinc-900" />The uploaded document already contains the professional&apos;s signature / approval</label>
        </section>
      </fieldset>
      <ModalFooter><div className="flex w-full flex-wrap items-center gap-3">
        {formError ? <p role="alert" className="mr-auto text-sm text-red-600">{formError}</p> : <p className="mr-auto flex items-center gap-2 text-sm text-zinc-500"><ClipboardCheck aria-hidden className="size-4 text-zinc-400" />{upload?.previous ? "Revisions are reviewed before acceptance." : "Documents are reviewed before acceptance."}</p>}
        <ProjectWriteButton type="button" disabled={pending} onClick={() => setUpload(null)} className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60">Cancel</ProjectWriteButton>
        <ProjectWriteButton type="submit" form="upload-sheet" disabled={pending} className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60">{pending ? "Uploading..." : "Submit for review"}</ProjectWriteButton>
      </div></ModalFooter></form>
    </Modal>
    <Modal open={detailLoading || !!selected} onClose={() => { if (!pending) closeDetail(); }} title={detail?.sheet_number ?? "Document"} icon={<FileText className="size-5" />} size="large">
      {detail && <ModalHeaderAddon><span className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-normal text-zinc-500">{formatVersion(detail.revision)}</span></ModalHeaderAddon>}
      {detailLoading ? <p>Loading sheet...</p> : selected?.error ? <p role="alert" className="text-red-600">{selected.error}</p> : detail && <div>
        <div className={`-mx-6 -mt-5 ${canReview ? "" : "-mb-5"} grid items-stretch lg:grid-cols-[minmax(0,1.7fr)_minmax(250px,1fr)]`}>
        <div className="min-w-0 space-y-5 px-6 py-5">
        <div className="overflow-hidden rounded border border-zinc-200">
        <DocumentViewer key={detail.id} url={documentFileUrl(projectId, detail.id)} pdf={detail.file_path.endsWith(".pdf")} title={detail.title} />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 p-3"><span className="text-xs text-zinc-500">{detail.sheet_number} — {formatVersion(detail.revision)}</span>{canReview && <ProjectWriteButton className={`${button} inline-flex items-center gap-2 text-xs`} disabled={pending} onClick={() => { closeDetail(); setUpload({ previous: detail }); setUploadStage("revision"); setDocumentType(detail.document_type); setSignedDocument(true); setFormError(null); }}><Upload className="size-3.5" />Upload new revision</ProjectWriteButton>}</div>
        </div>

        <section><h4 className="text-sm font-medium">Field changes / revision notes</h4><p className="mt-2 whitespace-pre-wrap text-sm text-zinc-600">{detail.change_notes || "No change notes recorded."}</p></section>
        </div>
        <aside className="min-w-0 border-t border-zinc-200 lg:border-t-0 lg:border-l">
          <section className="px-6 py-5"><h4 className="mb-3 text-sm font-medium">Verification</h4>
            {detail.evidence_path || detail.external_name || detail.approval_date ? (
              <div className="flex items-start justify-between gap-3 rounded border border-emerald-100 bg-emerald-50/80 p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="shrink-0 rounded border border-emerald-100 bg-emerald-100 p-2 text-emerald-700"><ShieldCheck className="size-4" /></span>
                  <div className="min-w-0 space-y-0.5">
                    <p className="break-words text-sm font-semibold text-emerald-950">{detail.external_name || "Authorized Stakeholder"}</p>
                    <p className="text-xs font-medium text-emerald-700">{detail.external_role || "Signed & Verified"}</p>
                  </div>
                </div>
                <span className="shrink-0 pt-0.5 text-xs font-medium text-emerald-800 tabular-nums">{detail.approval_date ? date(detail.approval_date) : "Oct 21, 2026"}</span>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded border border-amber-200 bg-amber-50/60 p-4">
                <span className="shrink-0 rounded border border-amber-200 bg-amber-100/80 p-2 text-amber-700"><Clock3 className="size-4" /></span>
                <div className="min-w-0 space-y-0.5">
                  <p className="break-words text-sm font-semibold text-amber-950">Not yet approved by authorized professional</p>
                  <p className="text-xs font-medium text-amber-700">Pending signature / verification</p>
                </div>
              </div>
            )}
          </section>
          <section className="border-t border-zinc-200"><h4 className="flex items-center gap-2 px-6 py-4 text-sm font-medium"><History aria-hidden="true" className="size-4 shrink-0 text-zinc-400" />Version history</h4>
            <div className="divide-y divide-zinc-200 border-t border-zinc-200">{sheets.filter(s => s.sheet_number === detail.sheet_number).sort((a,b) => b.revision-a.revision).map(s => <button key={s.id} type="button" disabled={pending} aria-pressed={s.id === detail.id} onClick={() => inspect(s.id)} className={`flex w-full cursor-pointer items-center justify-between gap-3 px-6 py-3 text-left transition-colors hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-500 disabled:opacity-50 ${s.id === detail.id ? "bg-zinc-100" : "bg-white"}`}>
              <span className="min-w-0"><span className="block text-sm font-medium">{formatVersion(s.revision)}</span><span className="mt-1 block text-xs text-zinc-500">{SHEET_STATUS[s.status]}</span></span>
              {s.id === detail.id ? <span className="inline-flex shrink-0 items-center gap-1 text-xs text-zinc-600"><Check className="size-3.5" />Viewing</span> : <ChevronRight className="size-4 shrink-0 text-zinc-400" />}
            </button>)}</div>
          </section>
          <section className="border-t border-zinc-200 px-6 py-5"><h4 className="mb-3 flex items-center gap-2 text-sm font-medium"><ClipboardCheck aria-hidden="true" className="size-4 shrink-0 text-zinc-400" />Document review history</h4>
            {!selected?.reviews.length && <p className="text-sm text-zinc-400">{reviewsLoading ? "Loading review history..." : "Awaiting admin review."}</p>}
            {selected?.reviews.map(r => <div key={r.id} className="relative ml-2 border-l border-zinc-200 pb-5 pl-5">
              <span className={`absolute -left-2.5 top-0 rounded-full p-1 ${r.status === "accepted" ? "bg-teal-50 text-teal-700" : "bg-zinc-100 text-zinc-500"}`}>{r.status === "accepted" ? <Check className="size-3" /> : <Clock3 className="size-3" />}</span>
              <p className="text-sm">{SHEET_STATUS[r.status as Sheet["status"]]}</p><p className="mt-1 text-xs text-zinc-500">{date(r.created_at)}</p><p className="mt-1 break-words text-xs text-zinc-500">{r.reviewer_name}</p><p className="mt-2 whitespace-pre-wrap break-words text-xs text-zinc-500">{r.notes}</p>
            </div>)}
          </section>
        </aside>
        </div>
        {canReview ? <form id="sheet-document-review" onSubmit={review} className="-mx-6 -mb-5 space-y-4 border-t border-zinc-200 bg-white px-6 py-5">
          <div><h4 className="text-sm font-medium">Admin document review</h4><p className="mt-1 text-xs text-zinc-500">Check the revision and attached professional approval. Acceptance does not certify technical correctness.</p></div>
          <div className="grid gap-4">
            <label className="flex flex-col gap-2 text-sm font-medium"><span>Review decision<RequiredMark /></span><span className="relative block">
              <select disabled={pending} className={`${input} appearance-none pr-9 font-normal`} value={decision} onChange={e => setDecision(e.target.value as Sheet["status"])}><option value="accepted">Accept for project records</option><option value="changes_requested">Request changes</option><option value="rejected">Reject submission</option></select><ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
            </span></label>
            <label className="flex flex-col gap-2 text-sm font-medium"><span>Document review comments<RequiredMark /></span><textarea required maxLength={2000} disabled={pending} value={comments} onChange={e => setComments(e.target.value)} placeholder="Document review comments" rows={3} className={`${input} block resize-y font-normal`} /></label>
          </div>
          {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
          <ModalFooter><ProjectWriteButton type="button" disabled={pending || deleting} onClick={() => { setDeleteError(null); setConfirmingDelete(true); }} className="cursor-pointer rounded border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">Delete</ProjectWriteButton><ProjectWriteButton type="submit" form="sheet-document-review" disabled={pending || deleting} className="inline-flex cursor-pointer items-center gap-2 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"><Check className="size-4" />{pending ? "Saving..." : "Save review"}</ProjectWriteButton></ModalFooter>
        </form> : <ModalFooter><ProjectWriteButton type="button" disabled={pending} onClick={() => { closeDetail(); setUpload({ previous: detail }); setDocumentType(detail.document_type); setSignedDocument(true); setFormError(null); }} className="inline-flex cursor-pointer items-center gap-2 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"><Upload className="size-4" />Upload new revision</ProjectWriteButton></ModalFooter>}
      </div>}
    </Modal>
    <ConfirmDialog
      open={confirmingDelete && !!detail}
      title={`Delete ${detail?.sheet_number ?? "document"}?`}
      message="This document, its version history, and attached files will be permanently removed."
      pending={deleting}
      error={deleteError}
      onConfirm={remove}
      onCancel={() => { if (!deleting) { setConfirmingDelete(false); setDeleteError(null); } }}
    />
  </section>;
}
