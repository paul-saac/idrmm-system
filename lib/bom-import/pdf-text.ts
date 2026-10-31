/** Extract embedded text and render image-only pages for the vision model.
 * next.config.ts keeps PDF.js external so its sibling worker resolves in Node. */
export class PdfImportError extends Error {}

export async function readPdfForImport(file: Pick<File, "arrayBuffer">, renderScans = true): Promise<{ text: string; images: { page: number; url: string }[] }> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    useSystemFonts: true,
  });
  const pages: string[] = [];
  const images: { page: number; url: string }[] = [];
  let imageBytes = 0;

  try {
    const pdf = await loadingTask.promise;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) pages.push(`Page ${pageNumber}:\n${text}`);
      else if (renderScans) {
        if (images.length >= 12) throw new PdfImportError("This PDF contains more than 12 scanned pages. Split it into smaller PDFs and import each separately.");
        // Use PDF.js's own Node canvas factory (already supplied by PDF.js).
        const original = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2, 1800 / Math.max(original.width, original.height)) });
        const factory = pdf.canvasFactory as { create(width: number, height: number): {
          canvas: HTMLCanvasElement & { toBuffer(type: "image/jpeg", quality: number): Buffer };
          context: CanvasRenderingContext2D;
        }; destroy(surface: unknown): void };
        const surface = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
        try {
          await page.render({ canvas: surface.canvas, canvasContext: surface.context, viewport, background: "white" }).promise;
          const jpeg = surface.canvas.toBuffer("image/jpeg", 85);
          imageBytes += jpeg.length;
          if (imageBytes > 8 * 1024 * 1024) throw new PdfImportError("The scanned pages are too large for one AI import. Split this PDF into smaller files and import each separately.");
          images.push({ page: pageNumber, url: `data:image/jpeg;base64,${jpeg.toString("base64")}` });
        } finally { factory.destroy(surface); }
      }
      page.cleanup();
    }
    return { text: pages.join("\n\n"), images };
  } finally {
    // Release resources even if opening an invalid/protected PDF fails.
    await loadingTask.destroy();
  }
}

export async function pdfToText(file: Pick<File, "arrayBuffer">): Promise<string> {
  return (await readPdfForImport(file, false)).text;
}
