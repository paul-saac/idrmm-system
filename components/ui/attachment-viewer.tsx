"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Download, FileText, Loader2, X } from "lucide-react";
import { Modal, ModalFooter } from "./modal";
import { attachmentKind, downloadAttachment, safeAttachmentUrl } from "@/lib/attachments/preview";

const DocumentViewer = dynamic(() => import("@/components/projects/sheets/document-preview").then(module => module.DocumentViewer), {
  ssr: false,
  loading: () => <p role="status" className="p-6 text-sm text-zinc-500">Opening attachment…</p>,
});

type Attachment = { url: string; name: string; type?: string; file?: File };
type SelectedAttachment = Attachment & { ownedUrl?: string };
const AttachmentContext = createContext<((attachment: Attachment) => void) | null>(null);

export function AttachmentViewerProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<SelectedAttachment | null>(null);
  const open = useCallback((attachment: Attachment) => {
    if (attachment.file) {
      const url = URL.createObjectURL(attachment.file);
      setSelected({ ...attachment, url, ownedUrl: url, type: attachment.file.type });
    } else {
      const url = safeAttachmentUrl(attachment.url, window.location.href);
      if (url) setSelected({ ...attachment, url });
    }
  }, []);
  useEffect(() => () => { if (selected?.ownedUrl) URL.revokeObjectURL(selected.ownedUrl); }, [selected]);
  return <AttachmentContext.Provider value={open}>
    {children}
    {selected && attachmentKind(selected.type, selected.name, selected.url) === "image" ? <ImageLightbox key={selected.url} attachment={selected} onClose={() => setSelected(null)} /> : <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.name || "Attachment"} icon={<FileText className="size-5" />} variant="centered" size="large">
      {selected && <AttachmentContent key={selected.url} attachment={selected} onClose={() => setSelected(null)} />}
    </Modal>}
  </AttachmentContext.Provider>;
}

function ImageLightbox({ attachment, onClose }: { attachment: SelectedAttachment; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { element?.close(); document.body.style.overflow = previous; };
  }, []);
  async function download() {
    if (busy) return;
    setBusy(true);
    try { await downloadAttachment(attachment.url, attachment.name); }
    catch { setError("Could not download this image. Please try again."); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} aria-label={attachment.name} onCancel={event => { event.preventDefault(); onClose(); }} className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-0 text-white backdrop:bg-black/60 backdrop:backdrop-blur-md">
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={attachment.url} alt={attachment.name} onError={() => setError("Could not load this image.")} className="relative max-h-full max-w-full object-contain" />
      <div className="absolute right-3 top-3 flex gap-2">
        <button type="button" aria-label="Download image" title="Download" disabled={busy} onClick={download} className="flex size-10 items-center justify-center text-white disabled:opacity-50">{busy ? <Loader2 className="size-5 animate-spin" /> : <Download className="size-5" />}</button>
        <button type="button" aria-label="Close image" title="Close" onClick={onClose} className="flex size-10 items-center justify-center text-white"><X className="size-5" /></button>
      </div>
      {error && <p role="alert" className="absolute bottom-5 bg-black/75 px-4 py-2 text-sm">{error}</p>}
    </div>
  </dialog>;
}

function AttachmentContent({ attachment, onClose }: { attachment: SelectedAttachment; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const kind = attachmentKind(attachment.type, attachment.name, attachment.url);
  async function download() {
    if (busy) return;
    setBusy(true); setError("");
    try { await downloadAttachment(attachment.url, attachment.name); }
    catch { setError("Could not download the attachment. Check your connection and try again."); }
    finally { setBusy(false); }
  }
  return <>
    {kind === "unsupported" ? <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center text-sm text-zinc-500"><FileText className="size-8 text-zinc-400" /><p>A preview is not available for this file format.</p><p>Use Download to open it with a compatible application.</p></div> : <DocumentViewer url={attachment.url} pdf={kind === "pdf"} title={attachment.name} showDownload={false} />}
    {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
    <ModalFooter><button type="button" onClick={download} disabled={busy} className="inline-flex items-center gap-2 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}{busy ? "Downloading…" : "Download"}</button><button type="button" onClick={onClose} className="rounded border border-zinc-200 px-4 py-2 text-sm">Close</button></ModalFooter>
  </>;
}

export function AttachmentLink({ url, name, type, file, className = "", children, title }: Attachment & { className?: string; children: ReactNode; title?: string }) {
  const open = useContext(AttachmentContext);
  return <button type="button" title={title || name} onClick={event => { event.stopPropagation(); open?.({ url, name, type, file }); }} className={`cursor-pointer text-left ${className}`}>{children}</button>;
}
