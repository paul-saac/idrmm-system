"use client";

/* eslint-disable @next/next/no-img-element -- Authenticated private image endpoint, not a public optimized image. */
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";

const pdfAssets = { standardFontDataUrl: "/api/pdf-assets/standard_fonts/", cMapUrl: "/api/pdf-assets/cmaps/", cMapPacked: true, wasmUrl: "/api/pdf-assets/wasm/" };

async function pdfLibrary() {
  const pdf = await import("pdfjs-dist");
  pdf.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  return pdf;
}

// Avoid starting a worker for every visible card at once.
let thumbnailJobs = 0;
const thumbnailQueue: Array<() => void> = [];
async function thumbnailSlot() {
  if (thumbnailJobs >= 2) await new Promise<void>(resolve => thumbnailQueue.push(resolve));
  else thumbnailJobs++;
  return () => {
    const next = thumbnailQueue.shift();
    if (next) next();
    else thumbnailJobs--;
  };
}

export function documentFileUrl(projectId: number, sheetId: number) {
  return `/api/projects/${projectId}/sheets/${sheetId}/file`;
}

export type ThumbnailCache = Map<string, { source?: string; promise?: Promise<string> }>;

async function thumbnailSource(url: string, pdf: boolean, cache: ThumbnailCache): Promise<string> {
  const existing = cache.get(url);
  if (existing?.source) return existing.source;
  if (existing?.promise) return existing.promise;
  const entry: { source?: string; promise?: Promise<string> } = {};
  cache.set(url, entry);
  entry.promise = (async () => {
    const release = await thumbnailSlot();
    let task: PDFDocumentLoadingTask | undefined;
    try {
      const surface = window.document.createElement("canvas");
      if (pdf) {
        const library = await pdfLibrary();
        task = library.getDocument({ url, ...pdfAssets, disableAutoFetch: true, disableStream: true });
        const doc = await task.promise;
        const page = await doc.getPage(1);
        const original = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: 640 / Math.max(original.width, original.height) });
        surface.width = Math.ceil(viewport.width); surface.height = Math.ceil(viewport.height);
        await page.render({ canvas: surface, viewport }).promise;
      } else {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Preview unavailable");
        const blob = await response.blob();
        const image = await createImageBitmap(blob);
        const scale = Math.min(1, 640 / Math.max(image.width, image.height));
        surface.width = Math.ceil(image.width * scale); surface.height = Math.ceil(image.height * scale);
        surface.getContext("2d")?.drawImage(image, 0, 0, surface.width, surface.height);
        image.close();
      }
      entry.source = surface.toDataURL("image/png");
      // Cache belongs to the mounted project section, never persistent storage.
      if (cache.size > 60) {
        const oldest = [...cache.entries()].find(([key, value]) => key !== url && value.source);
        if (oldest) cache.delete(oldest[0]);
      }
      return entry.source;
    } catch (error) { cache.delete(url); throw error; }
    finally { try { await task?.destroy(); } finally { release(); } }
  })();
  return entry.promise;
}

export function DocumentThumbnail({ url, pdf, title, cache, large = false }: { url: string; pdf: boolean; title: string; cache: ThumbnailCache; large?: boolean }) {
  const [source, setSource] = useState(() => cache.get(url)?.source ?? "");
  const [error, setError] = useState(false);
  useEffect(() => {
    let canceled = false;
    void thumbnailSource(url, pdf, cache).then(value => { if (!canceled) setSource(value); }).catch(() => { if (!canceled) setError(true); });
    return () => { canceled = true; };
  }, [url, pdf, cache]);
  return <span className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded border border-zinc-200 bg-zinc-50 ${large ? "h-36 w-full" : "h-16 w-20"}`}>
    {source ? <img src={source} alt={`Enlarged thumbnail of ${title}`} className="h-full w-full scale-110 object-cover object-top" /> : <span className="text-center text-[10px] text-zinc-400">{error ? "Preview unavailable" : pdf ? "PDF" : "Image"}</span>}
  </span>;
}

export function DocumentViewer({ url, pdf, title }: { url: string; pdf: boolean; title: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState("");
  const [rendering, setRendering] = useState(false);
  useEffect(() => {
    if (!pdf) return;
    let canceled = false;
    let task: PDFDocumentLoadingTask | undefined;
    void (async () => {
      try {
        const library = await pdfLibrary();
        if (canceled) return;
        task = library.getDocument({ url, ...pdfAssets });
        const result = await task.promise;
        if (!canceled) setDocument(result);
      } catch { if (!canceled) setError("Preview unavailable. The PDF may be damaged or password-protected. You can download it below."); }
    })();
    return () => { canceled = true; if (task) void task.destroy(); };
  }, [url, pdf]);
  useEffect(() => {
    if (!document) return;
    let canceled = false;
    let task: RenderTask | undefined;
    void (async () => {
      try {
        setRendering(true);
        const pdfPage = await document.getPage(page);
        if (canceled || !canvas.current) return;
        const original = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({ scale: 900 / Math.max(original.width, original.height) * zoom });
        // New canvas per render prevents canceled renders competing for the same surface.
        const surface = window.document.createElement("canvas");
        surface.width = Math.ceil(viewport.width); surface.height = Math.ceil(viewport.height);
        task = pdfPage.render({ canvas: surface, viewport }); await task.promise;
        if (!canceled && canvas.current) {
          canvas.current.width = surface.width; canvas.current.height = surface.height;
          canvas.current.getContext("2d")?.drawImage(surface, 0, 0); setRendering(false);
        }
      } catch { if (!canceled) { setError("Could not render this page. Try downloading the document."); setRendering(false); } }
    })();
    return () => { canceled = true; task?.cancel(); };
  }, [document, page, zoom]);
  return <section aria-label="Document preview" className="overflow-hidden rounded border border-zinc-200">
    {pdf && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-white p-3 text-sm">
      <div className="flex items-center gap-3"><button type="button" disabled={!document || page === 1} onClick={() => setPage(p => p - 1)} className="disabled:opacity-40">Previous</button><span>Page {page} / {document?.numPages ?? "…"}</span><button type="button" disabled={!document || page === document.numPages} onClick={() => setPage(p => p + 1)} className="disabled:opacity-40">Next</button></div>
      <label className="flex items-center gap-2">Zoom<select value={zoom} onChange={e => setZoom(Number(e.target.value))} className="rounded border border-zinc-200 p-1"><option value={1}>Fit</option><option value={1.5}>150%</option><option value={2}>200%</option><option value={3}>300%</option></select></label>
    </div>}
    <div className="relative max-h-[65vh] min-h-48 overflow-auto bg-zinc-100 p-4">
      {error ? <p role="alert" className="p-5 text-sm text-zinc-600">{error}</p> : pdf ? <><canvas ref={canvas} aria-label={`${title}, page ${page}`} className={`mx-auto bg-white shadow-sm ${zoom === 1 ? "max-h-[58vh] max-w-full object-contain" : "max-w-none"}`} />{(!document || rendering) && <p role="status" className="absolute left-4 top-4 rounded bg-white p-2 text-xs text-zinc-500">Rendering document…</p>}</> : <img src={url} alt={title} onError={() => setError("Image preview unavailable. Try downloading the document.")} className="mx-auto max-h-[60vh] max-w-full object-contain" />}
    </div>
    <div className="border-t border-zinc-200 bg-white p-3 text-xs text-zinc-500">{pdf ? "PDF page preview" : "Image preview"} · <a href={`${url}?download=1`} className="text-zinc-700 underline">Download original</a></div>
  </section>;
}
