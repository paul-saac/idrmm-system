"use client";

import { usePortal } from "@/components/portal/portal-context";
import { incidentStatus, type Incident } from "@/lib/incidents/model";
import { RequiredMark } from "@/components/ui/required-mark";
import { ProjectWriteButton } from "@/components/projects/project-access-context";


import { incidentReportSections, incidentReportedDate } from "@/lib/incidents/report";
import { downloadIncidentPdf } from "@/lib/incidents/report-pdf";
import Image from "next/image";
import { AttachmentLink } from "@/components/ui/attachment-viewer";
import { ClipboardCheck, Flag, FileText, FileDown, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal, ModalFooter, ModalHeaderActions, ModalHeaderAddon } from "@/components/ui/modal";
import { closeIncident, deleteIncident, loadIncident } from "@/lib/incidents/actions";


export type LoadedIncident = Awaited<ReturnType<typeof loadIncident>>;

function formatIncidentDate(value?: string) {
  if (!value) return "Incident report";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function IncidentDetails({ projectId, projectName, id, result, onClose, onDeleted, onCloseout }: {
  projectId: number;
  projectName: string;
  id: number;
  result: LoadedIncident;
  onClose: () => void;
  onDeleted?: (id: number) => void;
  onCloseout?: () => void;

}) {
  const portal = usePortal();
  const canClose = portal.isAdmin || portal.basePath === "/project-manager";
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const incident = result.incident;
  const attachments = [...(result.evidence ?? incident?.attachments ?? []), ...(incident?.closeout?.attachments ?? [])];
  const [downloading,setDownloading]=useState(false);
  const [downloadError,setDownloadError]=useState("");
  async function downloadReport(){
    if(!incident||downloading)return;setDownloading(true);setDownloadError("");
    try{await downloadIncidentPdf(incident,projectName,result.evidence??incident.attachments);}
    catch{setDownloadError("Could not create the report. Please try again.");}
    finally{setDownloading(false);}
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const deleted = await deleteIncident(projectId, id);
      if (deleted.error) {
        setDeleteError(deleted.error);
        return;
      }
      setConfirmingDelete(false);
      onDeleted?.(id);
      onClose();
    } catch {
      setDeleteError("Could not delete this incident. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      {result.error ? (
        <p role="alert" className="text-sm text-red-600">{result.error}</p>
      ) : incident ? (
        <article className="space-y-4">
          <ModalHeaderActions><div className="mr-3 text-right text-xs leading-relaxed text-zinc-500"><span className="block font-medium">Reported date:</span><span>{incidentReportedDate(incident.created_at)}</span></div></ModalHeaderActions>
          <ModalHeaderAddon><span className={`rounded px-2 py-0.5 text-xs font-medium ${incident.closeout ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{incidentStatus(incident)}</span></ModalHeaderAddon>
          {incidentReportSections(incident).map(group=><section key={group.title} className="overflow-hidden rounded border border-zinc-200"><h3 className="bg-zinc-100 px-4 py-2.5 text-sm font-semibold text-zinc-700">{group.title}</h3><div className="overflow-x-auto"><table className="w-full table-fixed text-left text-sm">{group.columns.length===3&&<thead className="bg-zinc-50 text-xs text-zinc-500"><tr>{group.columns.map(column=><th key={column} className="px-4 py-2 font-medium">{column}</th>)}</tr></thead>}<tbody>{group.rows.map((row,index)=><tr key={index} className="border-t border-zinc-200">{row.map((value,i)=><td key={i} className={`break-words whitespace-pre-wrap px-4 py-2.5 ${group.columns.length===2&&i===0?"w-[32%] text-xs text-zinc-500":"text-zinc-800"}`}>{value}</td>)}</tr>)}</tbody></table></div></section>)}
          <section className="overflow-hidden rounded border border-zinc-200">
            <h3 className="bg-zinc-100 px-4 py-2.5 text-sm font-semibold text-zinc-700">Attachments</h3>
            <div className="p-4">
            {attachments.length ? (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {attachments.map((file) => {
                  const preview = file.type.startsWith("image/") && file.url ? (
                    <span className="relative block aspect-[4/3] overflow-hidden bg-zinc-100">
                      <Image src={file.url} alt={file.name} fill unoptimized sizes="160px" className="object-cover" />
                    </span>
                  ) : (
                    <span className="flex aspect-[4/3] flex-col items-center justify-center gap-1 bg-zinc-50 px-2 text-center text-zinc-500">
                      <FileText className="size-5 text-zinc-400" />
                      <span className="max-w-full truncate text-[11px]">{file.name}</span>
                    </span>
                  );
                  return file.url ? (
                    <AttachmentLink key={file.path} url={file.url} name={file.name} type={file.type} title={file.name} className="overflow-hidden rounded border border-zinc-200 hover:border-zinc-400">
                      {preview}
                    </AttachmentLink>
                  ) : (
                    <div key={file.path} title={file.name} className="overflow-hidden rounded border border-zinc-200">{preview}</div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-zinc-400">No attachments.</p>
            )}
            </div>
          </section>

          {downloadError&&<p role="alert" className="text-sm text-red-600">{downloadError}</p>}
        </article>
      ) : null}

      <ModalFooter>
        <div className="flex w-full flex-wrap items-center justify-end gap-3">
          <div><ProjectWriteButton type="button" onClick={() => setConfirmingDelete(true)} disabled={!incident} className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-40">Delete</ProjectWriteButton></div>
          {incident && !incident.closeout && canClose && <ProjectWriteButton type="button" onClick={onCloseout} className="rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">Close incident</ProjectWriteButton>}
          <div><button type="button" onClick={downloadReport} disabled={!incident||downloading} className="inline-flex items-center gap-2 rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{downloading?<Loader2 className="size-4 animate-spin"/>:<FileDown className="size-4"/>}{downloading?"Creating report...":"Download as a report"}</button></div>
        </div>
      </ModalFooter>

      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this incident?"
        message="This incident and its attached evidence will be permanently removed."
        pending={deleting}
        error={deleteError}
        onConfirm={handleDelete}
        onCancel={() => {
          if (!deleting) {
            setConfirmingDelete(false);
            setDeleteError("");
          }
        }}
      />
    </>
  );
}

export function IncidentDetailModal({ projectId, projectName = "", id, result, onClose, onDeleted, onUpdated }: {
  projectId: number;
  projectName?: string;
  id: number | null;
  result?: LoadedIncident | null;
  onClose: () => void;
  onDeleted?: (id: number) => void;
  onUpdated?: (incident: Incident) => void;
}) {
  const [closingId, setClosingId] = useState<number | null>(null);
  const [saved, setSaved] = useState<LoadedIncident | null>(null);
  const targetKey = `${projectId}:${id}`;
  const [fetched, setFetched] = useState<{ key: string; result: LoadedIncident } | null>(null);
  useEffect(() => {
    if (result !== undefined || id === null) return;
    let cancelled = false;
    loadIncident(projectId, id)
      .then((value) => {
        if (!cancelled) setFetched({ key: targetKey, result: value });
      })
      .catch(() => {
        if (!cancelled) setFetched({ key: targetKey, result: { error: "Could not load this incident. Close and try again." } });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, id, result, targetKey]);
  const loadedResult = result === undefined ? (fetched?.key === targetKey ? fetched.result : null) : result;
  const effectiveResult = saved?.incident?.id === id && saved.incident.project_id === projectId ? saved : loadedResult;
  const closing = id !== null && closingId === id;
  function dismiss() { setClosingId(null); onClose(); }
  async function closed(incident: Incident) {
    setSaved({incident, evidence: effectiveResult?.evidence ?? incident.attachments.map(file => ({...file, url: file.url ?? null}))});
    setClosingId(null); onUpdated?.(incident);
    try { const fresh = await loadIncident(projectId, incident.id);
      if (fresh.incident) { setSaved(fresh); onUpdated?.(fresh.incident); }
    } catch { /* Keep the committed closeout visible if preview signing is unavailable. */ }
  }

  return (
    <Modal open={id !== null} onClose={dismiss} title={closing ? "Close incident" : formatIncidentDate(effectiveResult?.incident?.occurred_on)} icon={closing ? <ClipboardCheck className="size-5" /> : <Flag className="size-5" />} description={!closing && effectiveResult?.incident ? `Reported by ${effectiveResult.incident.reporter_name || "Project member"}` : undefined} variant="centered" size="wide" headerClassName="[&_h2]:text-base [&_p]:text-xs">
      {id !== null && effectiveResult === null && (
        <div role="status" aria-label="Loading incident report" className="space-y-4">
          <span className="sr-only">Loading incident report</span>
          <div aria-hidden className="h-4 w-1/3 animate-pulse rounded bg-zinc-100" />
          <div aria-hidden className="h-20 animate-pulse rounded bg-zinc-100" />
          <div aria-hidden className="h-28 animate-pulse rounded bg-zinc-100" />
        </div>
      )}
      {closing && id !== null ? <IncidentCloseoutForm key={targetKey} projectId={projectId} id={id} onCancel={() => setClosingId(null)} onClosed={closed} /> : id !== null && effectiveResult !== null && (
        <IncidentDetails key={`${projectId}:${id}`} projectId={projectId} projectName={projectName} id={id} result={effectiveResult} onClose={dismiss} onDeleted={onDeleted} onCloseout={() => setClosingId(id)} />
      )}
    </Modal>
  );
}


function IncidentCloseoutForm({projectId,id,onCancel,onClosed}:{projectId:number;id:number;onCancel:()=>void;onClosed:(incident:Incident)=>void}) {
 const [pending,setPending]=useState(false);
 const [error,setError]=useState("");
 const [fileNames,setFileNames]=useState("");
 async function submit(event: React.FormEvent<HTMLFormElement>) {
  event.preventDefault(); if(pending)return;
  const form=new FormData(event.currentTarget);setPending(true);setError("");
  try {const result=await closeIncident(projectId,id,form);if(result.incident)onClosed(result.incident);else setError(result.error||"Could not close this incident.");}
  catch {setError("Could not close this incident. Please try again.");}
  finally {setPending(false);}
 }
 const input="w-full rounded border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500";
 return <form id="incident-closeout" onSubmit={submit}>
  <fieldset disabled={pending} className="-mx-6 -my-5 divide-y divide-zinc-200">
   <section className="space-y-3 bg-zinc-50 px-6 py-5"><label className="block text-sm font-medium" htmlFor="closeout-findings">Investigation findings<RequiredMark /></label><textarea id="closeout-findings" name="findings" required maxLength={5000} rows={3} className={`${input} resize-y`} /></section>
   <section className="space-y-3 px-6 py-5"><label className="block text-sm font-medium" htmlFor="closeout-action">Action taken<RequiredMark /></label><textarea id="closeout-action" name="actionTaken" required maxLength={5000} rows={3} className={`${input} resize-y`} /></section>
   <section className="space-y-3 bg-zinc-50 px-6 py-5"><label htmlFor="closeout-files" className="block text-sm font-medium">Supporting attachments</label><label className="relative flex cursor-pointer items-center rounded border border-zinc-200 bg-white text-sm"><input id="closeout-files" type="file" name="attachments" multiple accept="image/jpeg,image/png,application/pdf" onChange={e=>setFileNames(Array.from(e.target.files??[]).map(file=>file.name).join(", "))} className="absolute inset-0 size-full cursor-pointer opacity-0"/><span className="shrink-0 border-r border-zinc-200 px-3 py-2">Choose files</span><span className="truncate px-3 text-zinc-400">{fileNames||"No files chosen"}</span></label></section>
  </fieldset>
  <ModalFooter>{error&&<p role="alert" className="mr-auto text-sm text-red-600">{error}</p>}<button type="button" disabled={pending} onClick={onCancel} className="rounded border border-zinc-200 px-4 py-2 text-sm disabled:opacity-50">Cancel</button><button type="submit" form="incident-closeout" disabled={pending} className="inline-flex items-center gap-2 rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending&&<Loader2 className="size-4 animate-spin"/>}{pending?"Closing...":"Close incident"}</button></ModalFooter>
 </form>;
}
