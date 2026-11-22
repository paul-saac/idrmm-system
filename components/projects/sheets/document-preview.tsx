"use client";

/* eslint-disable @next/next/no-img-element -- Authenticated private image endpoint, not a public optimized image. */
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCw, Maximize, Download, Loader2 } from "lucide-react";
import { downloadAttachment } from "@/lib/attachments/preview";
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

export function DocumentViewer({ url, pdf, title, showDownload = true, downloadName = title }: { url: string; pdf: boolean; title: string; showDownload?: boolean; downloadName?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [error, setError] = useState("");
  const [rendering, setRendering] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [space, setSpace] = useState({ width: 900, height: 600 });
  useEffect(() => {
    const container = viewport.current;
    if (!container) return;
    const observer = new ResizeObserver(() => setSpace({ width: Math.max(1, container.clientWidth - 32), height: Math.max(1, container.clientHeight - 32) }));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
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
      } catch { if (!canceled) setError("Preview unavailable. The PDF may be damaged, password-protected, or no longer accessible. You can download it below."); }
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
        const original = pdfPage.getViewport({ scale: 1, rotation: pdfPage.rotate + rotation });
        const fit = Math.min(space.width / original.width, space.height / original.height);
        const display = pdfPage.getViewport({ scale: fit * zoom, rotation: pdfPage.rotate + rotation });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const surface = window.document.createElement("canvas");
        const rendered = pdfPage.getViewport({ scale: fit * zoom * pixelRatio, rotation: pdfPage.rotate + rotation });
        surface.width = Math.ceil(rendered.width); surface.height = Math.ceil(rendered.height);
        task = pdfPage.render({ canvas: surface, viewport: rendered }); await task.promise;
        if (!canceled && canvas.current) {
          canvas.current.width = surface.width; canvas.current.height = surface.height;
          canvas.current.style.width = `${display.width}px`; canvas.current.style.height = `${display.height}px`;
          canvas.current.getContext("2d")?.drawImage(surface, 0, 0); setRendering(false);
        }
      } catch { if (!canceled) { setError("Could not render this page. Try downloading the document."); setRendering(false); } }
    })();
    return () => { canceled = true; task?.cancel(); };
  }, [document, page, zoom, rotation, space]);
  const rotated = rotation % 180 !== 0;
  const imageWidth = rotated ? imageSize.height : imageSize.width;
  const imageHeight = rotated ? imageSize.width : imageSize.height;
  const imageScale = imageWidth && imageHeight ? Math.min(space.width / imageWidth, space.height / imageHeight, 1) * zoom : 1;
  const control = "inline-flex h-8 min-w-8 items-center justify-center rounded border border-zinc-200 px-2 text-zinc-600 hover:text-zinc-900 disabled:opacity-40";
  async function download() {
    if (downloading) return;
    setDownloading(true); setDownloadError("");
    try { await downloadAttachment(url, downloadName); }
    catch { setDownloadError("Could not download the document. Please try again."); }
    finally { setDownloading(false); }
  }
  return <section aria-label="Document preview" className="overflow-hidden rounded border border-zinc-200">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-white p-3 text-xs">
      {pdf ? <div className="flex items-center gap-2"><button type="button" aria-label="Previous page" disabled={!document || page === 1} onClick={() => setPage(p => p - 1)} className={control}><ChevronLeft className="size-4" /></button><span className="tabular-nums">Page {page} / {document?.numPages ?? "?"}</span><button type="button" aria-label="Next page" disabled={!document || page === document.numPages} onClick={() => setPage(p => p + 1)} className={control}><ChevronRight className="size-4" /></button></div> : <span className="text-zinc-500">Image preview</span>}
      <div className="flex items-center gap-2"><button type="button" aria-label="Zoom out" disabled={zoom <= 0.5} onClick={() => setZoom(z => Math.max(.5, z - .25))} className={control}><ZoomOut className="size-4" /></button><span className="min-w-10 text-center tabular-nums">{zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`}</span><button type="button" aria-label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom(z => Math.min(3, z + .25))} className={control}><ZoomIn className="size-4" /></button><button type="button" aria-label="Fit to screen" onClick={() => setZoom(1)} className={control}><Maximize className="size-4" /></button><button type="button" aria-label="Rotate clockwise" onClick={() => setRotation(r => (r + 90) % 360)} className={control}><RotateCw className="size-4" /></button></div>
    </div>
    <div ref={viewport} className="relative h-[55dvh] min-h-48 overflow-auto bg-zinc-100 p-4">
      {error ? <p role="alert" className="p-5 text-sm text-zinc-600">{error}</p> : pdf ? <><canvas ref={canvas} aria-label={`${title}, page ${page}`} className="mx-auto bg-white shadow-sm" />{(!document || rendering) && <p role="status" className="absolute left-4 top-4 flex items-center gap-2 rounded bg-white p-2 text-xs text-zinc-500"><Loader2 className="size-4 animate-spin" />Rendering document?</p>}</> : <div className="relative mx-auto" style={{ width: imageWidth ? imageWidth * imageScale : "100%", height: imageHeight ? imageHeight * imageScale : "100%" }}><img src={url} alt={title} onLoad={event => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setError("Image preview unavailable. Try downloading the document.")} className="absolute left-1/2 top-1/2 max-w-none" style={{ width: imageSize.width ? imageSize.width * imageScale : undefined, height: imageSize.height ? imageSize.height * imageScale : undefined, transform: `translate(-50%, -50%) rotate(${rotation}deg)` }} /></div>}
    </div>
    {showDownload && <div className="border-t border-zinc-200 bg-white p-3 text-xs"><button type="button" onClick={download} disabled={downloading} className="inline-flex items-center gap-2 text-zinc-700 disabled:opacity-50">{downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}Download original</button>{downloadError && <p role="alert" className="mt-2 text-red-600">{downloadError}</p>}</div>}
  </section>;
}
