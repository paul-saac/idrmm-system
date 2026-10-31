/** Read a PDF's text layer on the server without sending the raw file to AI.
 * next.config.ts keeps PDF.js external so its sibling worker resolves in Node. */
export async function pdfToText(file: Pick<File, "arrayBuffer">): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    useSystemFonts: true,
  });
  const pages: string[] = [];

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
    }
    return pages.join("\n\n");
  } finally {
    // Release resources even if opening an invalid/protected PDF fails.
    await loadingTask.destroy();
  }
}
