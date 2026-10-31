"use server";

import { requireAdminOrForeman } from "@/lib/auth/project-access";
import { getAIProvider, aiModel, aiChatRequest, aiResponseFormat, nextAIResponseMode, isAIJsonFormatError, type AIProvider, type AIResponseMode } from "@/lib/ai/provider";

export type ExtractedMaterialLine = {
  name: string;
  quantity: string;
  unit: string;
  unitCost: string;
};

export type ExtractedTask = {
  name: string;
  quantity: string;
  unit: string;
  materials: ExtractedMaterialLine[];
};

export type ExtractedCategory = {
  name: string;
  /** This category's own direct amount — only meaningful (and only ever
   * non-empty) when `tasks` is empty, for a top-level line item the
   * source document never broke down into its own sub-items (e.g. a
   * BOM's own "A — MOBILIZATION ... 20,000.00" row, nothing nested under
   * it). Matches estimate_categories' own material_direct_amount
   * column — see applyBomImport's own doc comment (lib/cost-estimate/
   * actions.ts) for how this gets written. Left empty when the category
   * does have real tasks instead, since its own total is a rollup of
   * those, not something to duplicate here. */
  amount: string;
  tasks: ExtractedTask[];
};

export type BomExtractionState = {
  error?: string;
  categories?: ExtractedCategory[];
};

// Images are sent to an explicitly configured vision model as data URLs.
// Base64 inflates the raw file by roughly 4/3. Keep the existing upload
// bound; PDFs are converted to text locally and never sent as raw files.
// Doesn't apply to a CSV/Excel upload — see MAX_SPREADSHEET_BYTES/
// isCsvFile/isExcelFile below, a wholly separate, non-multimodal path.
const MAX_FILE_BYTES = 15 * 1024 * 1024;

// A CSV or Excel file is sent as plain text (see requestParts below),
// not base64 — so this bounds actual token usage, not request-body
// size. 2MB of plain tabular text is already generous for any real
// cost-estimate export (a project with thousands of material lines is
// still well under this), and erring smaller here keeps a huge
// accidental upload from burning through the free tier's own
// per-request token ceiling.
const MAX_SPREADSHEET_BYTES = 2 * 1024 * 1024;
const MAX_DOCUMENT_TEXT_CHARS = 60_000;

const ACCEPTED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
]);

// A CSV's own MIME type is inconsistent across browsers/OS — reported
// as "text/csv" on some, "application/vnd.ms-excel" on others (Excel's
// own file association bleeding into the browser's sniffing on
// Windows), and sometimes not meaningfully set at all. Checking the
// file's own .csv extension alongside these two is what actually
// catches all of them reliably, rather than trusting MIME type alone.
const CSV_MIME_TYPES = new Set(["text/csv", "application/vnd.ms-excel"]);

function isCsvFile(file: File): boolean {
  return CSV_MIME_TYPES.has(file.type) || file.name.toLowerCase().endsWith(".csv");
}

// .xlsx only, deliberately — ExcelJS (already a dependency, see
// export-buttons.tsx for its own write-side usage) only reads/writes
// the modern OOXML format (workbook.xlsx.load), not the legacy binary
// .xls Excel used before 2007. application/vnd.ms-excel (the classic
// .xls MIME type) is left out of this check on purpose — it's already
// claimed by isCsvFile above for the Windows CSV-misdetection case, and
// this app has no way to actually parse a real .xls file if one showed
// up under that same MIME type anyway.
const EXCEL_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function isExcelFile(file: File): boolean {
  return file.type === EXCEL_MIME_TYPE || file.name.toLowerCase().endsWith(".xlsx");
}

// ExcelJS's own CellValue union — a plain value, or one of a handful of
// object shapes (formula, hyperlink, rich text, error) a cell can hold
// instead. Recurses once for a formula cell's own computed `result`
// (itself a plain CellValue). Anything else unrecognized reads as "" —
// better than crashing the whole extraction over one unusual cell.
function cellValueToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== "object") return String(value);

  const obj = value as Record<string, unknown>;
  if (Array.isArray(obj.richText)) {
    return (obj.richText as { text?: unknown }[])
      .map((run) => (typeof run.text === "string" ? run.text : ""))
      .join("");
  }
  if (typeof obj.text === "string") return obj.text; // hyperlink cell
  if ("formula" in obj) return cellValueToText(obj.result);
  if (typeof obj.error === "string") return obj.error;
  return "";
}

/**
 * Reads an .xlsx workbook and flattens every sheet into a lightweight,
 * pipe-delimited text table — not real CSV (no quote-escaping, since
 * this is only ever read by the model, never re-parsed as CSV), and a
 * pipe rather than a comma specifically so an ordinary comma inside a
 * cell's own text never gets mistaken for a column break the way it
 * would in true CSV. row.values is 1-indexed (index 0 is always empty,
 * an ExcelJS quirk carried over from how Excel itself references
 * columns) — sliced off here so column 1 of the sheet is column 1 of
 * this output, not column 2.
 */
async function excelToText(file: File): Promise<string> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  // The cast is purely a TS type-resolution artifact — this project's
  // own @types/node and exceljs's own bundled Buffer type reference
  // don't structurally match (confirmed directly: even an explicit
  // `as Buffer` on the global Buffer type still didn't satisfy it),
  // even though Buffer.from()'s own runtime result is a real, fully
  // compatible Buffer either way. Casting to exactly what .load() itself
  // declares sidesteps whichever Buffer this ends up being, rather than
  // guessing at the global one.
  const buffer = Buffer.from(await file.arrayBuffer());
  await workbook.xlsx.load(
    buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]
  );

  const sheetTexts: string[] = [];
  workbook.eachSheet((worksheet) => {
    const rowLines: string[] = [];
    worksheet.eachRow((row) => {
      const values = Array.isArray(row.values) ? row.values : [];
      rowLines.push(values.slice(1).map(cellValueToText).join(" | "));
    });
    sheetTexts.push(`Sheet: ${worksheet.name}\n${rowLines.join("\n")}`);
  });
  return sheetTexts.join("\n\n");
}

/** Extracts the text layer from a PDF before sending it to the AI service. This keeps
 * the API key and document processing on the server and avoids pretending
 * a chat-completions image endpoint accepts a raw PDF. */
async function pdfToText(file: File): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  try {
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
  } finally {
    await loadingTask.destroy();
  }

  return pages.join("\n\n");
}

// A 503 from Groq means its own servers are temporarily unavailable, not that
// anything about this request was wrong — confirmed directly the first
// time this ran end-to-end against a real key ("This model is currently
// experiencing high demand..."). That kind of spike is near-always gone
// within a few seconds, so retrying here beats surfacing a scary error
// for something that would usually already be resolved by the time an
// admin re-clicked "Process with AI" themselves. Only 503 gets this
// treatment — 429 (this project's own quota, not provider capacity) and
// 4xx (a real request problem) retrying blindly wouldn't help either.
const MAX_ATTEMPTS = 3;

// A busy model can also just never answer — Node's own fetch then waits 5
// minutes for headers before failing (UND_ERR_HEADERS_TIMEOUT), the modal
// spinning all the while. So each request gets REQUEST_TIMEOUT_MS (a
// 3-page BOM normally takes well under a minute), a model that times out
// isn't retried (it's jammed — the next one is tried instead), and the
// whole import stops after TOTAL_BUDGET_MS either way.
const REQUEST_TIMEOUT_MS = 90_000;
const TOTAL_BUDGET_MS = 180_000;

const BUSY_MESSAGE =
  "The AI service is busy right now. Please try again in a few minutes.";

/** Whether a failed fetch was a timeout — ours (AbortSignal.timeout) or
 * Node's own header/body wait. */
function isTimeout(error: unknown) {
  if (error instanceof DOMException) {
    return error.name === "TimeoutError" || error.name === "AbortError";
  }
  const code = (error as { cause?: { code?: string } } | null)?.cause?.code;
  return code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT";
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// Sent as the model's system instructions alongside locally extracted
// PDF/spreadsheet text or a base64 image. Deliberately not framed as "a
// BOM" specifically — a Bill
// of Materials is the common case, but a quotation or any similar
// construction cost estimate laid out as phases/tasks/materials works
// the same way, and the modal itself no longer calls this a BOM import.
const EXTRACTION_PROMPT = `You are extracting a construction cost estimate document (e.g. a Bill of Materials, a quotation, or a similar breakdown) into structured data for a project management system.

The document is organized as phases/categories, each containing tasks (work items), each of which may list the materials it needs (name, quantity, unit, unit cost). A document's own item numbering (e.g. "A", "B", "E" for categories, "E.1", "E.2" for tasks under category E, plain "1", "2", "3" for a task's own material lines) is usually the clearest signal of this structure — use it to figure out the hierarchy, but never copy the number/letter itself into a \`name\` field. A row written as "A — MOBILIZATION" or "E.1  Excavation" means the name is just "MOBILIZATION" or "Excavation" — strip the leading item number/letter (and any dash/period/space separating it from the text) before writing it into \`name\`. This applies at every level: categories, tasks, and materials.

Rules:
- Extract every category, task, and material line exactly as stated in the document — do not invent, estimate, or round any value that isn't actually written there. The one deliberate exception is the item number/letter prefix itself (see above) — that's a document-numbering artifact, not part of the actual name, so it's the one thing you do NOT copy verbatim.
- A category that has real sub-items in the document (e.g. "E — EARTHWORKS" with "E.1 Excavation" and "E.2 Backfilling" nested under it) gets those as its own \`tasks\` (named "Excavation"/"Backfilling", not "E.1 Excavation"/"E.2 Backfilling"), and its own \`amount\` must be left as an empty string — its total is a rollup of those tasks, not something to also state separately.
- A category that has NO sub-items at all in the document — just its own single row with a name and a peso amount, nothing nested underneath it (e.g. "A — MOBILIZATION ... 20,000.00" with no A.1, A.2, etc.) — is a standalone line item: its own \`tasks\` array must be empty, its \`name\` is "MOBILIZATION" (not "A — MOBILIZATION" or "A MOBILIZATION"), and whatever amount is shown on that row goes in \`amount\` instead. Do NOT invent a task with the same name as the category just to give it somewhere to put that amount — that duplicates the category for no reason. This is the most common mistake to avoid.
- A task sometimes has its own overall quantity/unit (e.g. "12 cu.m excavation") and no material lines; other times it's just a group header, with all quantity/cost living on its own material lines instead (e.g. "Concrete Footings" listing Cement, Sand, Gravel, Rebar underneath it). Both are valid — reproduce whichever shape the source document actually uses, per task.
- If a task or material's quantity, unit, or unit cost is not stated in the document, leave that field as an empty string rather than guessing a value.
- Skip generic equipment/tool provisioning or miscellaneous overhead line items (e.g. "Power Tools," "Hand Tools," a general equipment allowance) — these aren't schedulable construction work or a real material, so leave them out of the output entirely rather than turning them into a category, task, or material line.
- Respond with JSON only, matching the provided schema exactly.
- The top-level value must be an object with a categories array. Every category must contain string name, string amount, and array tasks. Every task must contain string name, string quantity, string unit, and array materials. Every material must contain string name, string quantity, string unit, and string unitCost.`;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    categories: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          amount: { type: "string" },
          tasks: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                quantity: { type: "string" },
                unit: { type: "string" },
                materials: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      name: { type: "string" },
                      quantity: { type: "string" },
                      unit: { type: "string" },
                      unitCost: { type: "string" },
                    },
                    required: ["name", "quantity", "unit", "unitCost"],
                  },
                },
              },
              required: ["name", "quantity", "unit", "materials"],
            },
          },
        },
        required: ["name", "amount", "tasks"],
      },
    },
  },
  required: ["categories"],
} as const;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Defensive runtime validation/coercion of Groq's JSON response — the
 * response schema constrains the model's output, but this still isn't a
 * compiler guarantee (a truncated response, a schema the model quietly
 * didn't fully honor, etc.), so nothing downstream trusts the parsed
 * JSON's shape without this passing first. Drops a category/task/
 * material with no name (never a valid row in the review draft either)
 * rather than failing the whole extraction over one bad entry.
 */
function normalizeCategories(value: unknown): ExtractedCategory[] | null {
  if (!Array.isArray(value)) return null;

  const categories: ExtractedCategory[] = [];
  for (const rawCategory of value) {
    if (typeof rawCategory !== "object" || rawCategory === null) return null;
    const categoryRecord = rawCategory as Record<string, unknown>;
    const categoryName = asString(categoryRecord.name).trim();
    if (!categoryName) continue;

    const tasks: ExtractedTask[] = [];
    if (Array.isArray(categoryRecord.tasks)) {
      for (const rawTask of categoryRecord.tasks) {
        if (typeof rawTask !== "object" || rawTask === null) continue;
        const taskRecord = rawTask as Record<string, unknown>;
        const taskName = asString(taskRecord.name).trim();
        if (!taskName) continue;

        const materials: ExtractedMaterialLine[] = [];
        if (Array.isArray(taskRecord.materials)) {
          for (const rawMaterial of taskRecord.materials) {
            if (typeof rawMaterial !== "object" || rawMaterial === null) continue;
            const materialRecord = rawMaterial as Record<string, unknown>;
            const materialName = asString(materialRecord.name).trim();
            if (!materialName) continue;
            materials.push({
              name: materialName,
              quantity: asString(materialRecord.quantity),
              unit: asString(materialRecord.unit),
              unitCost: asString(materialRecord.unitCost),
            });
          }
        }

        tasks.push({
          name: taskName,
          quantity: asString(taskRecord.quantity),
          unit: asString(taskRecord.unit),
          materials,
        });
      }
    }

    categories.push({
      name: categoryName,
      amount: asString(categoryRecord.amount),
      tasks,
    });
  }
  return categories;
}

/** Groq may place an otherwise usable JSON result in `failed_generation`
 * when its response validator rejects surrounding text or a minor wrapper
 * mismatch. Accept the schema's { categories: [...] } wrapper or the direct
 * category array models sometimes produce, then apply full local validation. */
function categoriesFromJsonText(text: string): ExtractedCategory[] | null {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.push(trimmed.slice(objectStart, objectEnd + 1));
  }
  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    candidates.push(trimmed.slice(arrayStart, arrayEnd + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const value = Array.isArray(parsed)
        ? parsed
        : typeof parsed === "object" && parsed !== null
          ? (parsed as Record<string, unknown>).categories
          : null;
      const categories = normalizeCategories(value);
      if (categories) return categories;
    } catch {
      // Try the next candidate (for example, JSON inside a fenced block).
    }
  }
  return null;
}

/** Reads a cost estimate document and asks the configured AI provider for phases, tasks, and
 * materials as strict JSON. This action never writes to the project; the
 * user reviews the returned draft before applyBomImport creates anything. */
export async function extractBomFromFile(
  formData: FormData
): Promise<BomExtractionState> {
  const profile = await requireAdminOrForeman();
  if (!profile) return { error: "You are not authorized to use this feature." };

  let provider: AIProvider;
  try { provider=getAIProvider(); }
  catch (error) { return {error:error instanceof Error ? error.message : "AI import is not configured yet."}; }

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "No file was uploaded." };

  const isCsv = isCsvFile(file);
  const isExcel = !isCsv && isExcelFile(file);
  const isSpreadsheet = isCsv || isExcel;
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const isImage = !isSpreadsheet && !isPdf;

  if (!isSpreadsheet && !ACCEPTED_MIME_TYPES.has(file.type)) {
    return {
      error: "Upload a PDF, image (PNG, JPG, WEBP, HEIC), CSV, or Excel (.xlsx) file.",
    };
  }
  if (isSpreadsheet && file.size > MAX_SPREADSHEET_BYTES) {
    return { error: "That file is too large — try a smaller export." };
  }
  if (!isSpreadsheet && file.size > MAX_FILE_BYTES) {
    return { error: "That file is too large — try a smaller PDF or image." };
  }

  let model: string;
  try { model=aiModel(provider,isImage); }
  catch (error) { return {error:error instanceof Error ? error.message : "This AI deployment cannot process images."}; }
  let userContent: string | Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  >;

  if (isImage) {
    const base64Data = Buffer.from(await file.arrayBuffer()).toString("base64");
    userContent = [
      { type: "text", text: "Extract the construction estimate from this image." },
      {
        type: "image_url",
        image_url: { url: `data:${file.type};base64,${base64Data}` },
      },
    ];
  } else {
    let documentText: string;
    try {
      if (isCsv) {
        documentText = await file.text();
      } else if (isExcel) {
        documentText = await excelToText(file);
      } else {
        documentText = await pdfToText(file);
      }
    } catch (error) {
      console.error("[extractBomFromFile] Could not read uploaded file:", error);
      return {
        error: isExcel
          ? "Couldn't read that Excel file — make sure it's a valid .xlsx file."
          : "Couldn't read that PDF — make sure it is a valid, unprotected PDF.",
      };
    }

    if (!documentText.trim()) {
      return {
        error:
          "No readable text was found in that PDF. For a scanned document, upload its pages as PNG or JPG images.",
      };
    }
    if (documentText.length > MAX_DOCUMENT_TEXT_CHARS) {
      return {
        error: "That document contains too much text for one AI import. Upload a smaller document or split it into sections.",
      };
    }
    userContent = `Extract the construction estimate from this document:\n\n${documentText}`;
  }

  const requestBody = {
    model,
    messages: [
      { role: "system", content: EXTRACTION_PROMPT },
      { role: "user", content: userContent },
    ],
    temperature: 0.1,
    max_completion_tokens: 8_192,
  };

  const startedAt = Date.now();
  let response: Response | undefined;
  let responseMode: AIResponseMode = provider.responseMode;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const remaining = TOTAL_BUDGET_MS - (Date.now() - startedAt);
    if (remaining < 5_000) break;
    try {
      const request=aiChatRequest(provider,{...requestBody,
        response_format:aiResponseFormat(responseMode,"construction_cost_estimate",RESPONSE_SCHEMA)});
      response = await fetch(request.url, {
        ...request.options,
        signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remaining)),
      });
    } catch (error) {
      return {
        error: isTimeout(error)
          ? BUSY_MESSAGE
          : "Could not reach the AI service. Please try again shortly.",
      };
    }

    // Real documents occasionally make Groq's constrained decoder return
    // `Failed to generate JSON` even though the same model can produce a
    // valid JSON object. Retry once in JSON-object mode, then run the same
    // local shape validation below before trusting the result.
    if (response.status === 400) {
      const errorBody = await response.clone().json().catch(() => null);
      const message =
        typeof errorBody?.error?.message === "string" ? errorBody.error.message : "";
      const errorCode =
        typeof errorBody?.error?.code === "string" ? errorBody.error.code : "";
      const jsonGenerationFailed = isAIJsonFormatError({error:{code:errorCode,message,param:errorBody?.error?.param}});
      if (jsonGenerationFailed) {
        const failedGeneration = errorBody?.error?.failed_generation;
        if (failedGeneration !== undefined && failedGeneration !== null) {
          const recovered = categoriesFromJsonText(
            typeof failedGeneration === "string"
              ? failedGeneration
              : JSON.stringify(failedGeneration)
          );
          if (recovered && recovered.length > 0) return { categories: recovered };
        }

        const nextMode = nextAIResponseMode(responseMode);
        if (!nextMode) break;
        console.warn(
          `[extractBomFromFile] ${responseMode} JSON generation failed; retrying with ${nextMode}`
        );
        responseMode = nextMode;
        response = undefined;
        continue;
      }
    }

    if (response.status !== 503 || attempt === MAX_ATTEMPTS) break;
    await sleep(1_000 * attempt);
  }

  if (!response) return { error: BUSY_MESSAGE };
  if (!response.ok) {
    if (response.status === 429) {
      return { error: "The AI service's usage limit was reached. Please wait and try again." };
    }
    if (response.status === 401 || response.status === 403) return {error:"AI import is unavailable. Please contact your system administrator."};
    if (response.status === 404) return {error:"The configured AI deployment was not found. Ask your system administrator to check its endpoint and deployment name."};
    if (response.status === 503) return { error: BUSY_MESSAGE };
    return {
      error: `The AI service couldn't process this document (HTTP ${response.status}). Please try again.`,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { error: "The AI service returned an unreadable response. Please try again." };
  }

  const finishReason=(payload as {choices?:{finish_reason?:string}[]})?.choices?.[0]?.finish_reason;
  if (finishReason === "length") return {error:"The AI import exceeded the response limit. Upload a smaller document or split it into sections."};
  if (finishReason === "content_filter") return {error:"The AI service could not process this document under its content policy."};

  const content = (payload as {
    choices?: { message?: { content?: unknown; refusal?: unknown } }[];
  })?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    return { error: "The AI service returned an unexpected response. Please try again." };
  }

  const categories = categoriesFromJsonText(content);
  if (!categories) {
    return { error: "The AI response didn't match the expected format. Please try again." };
  }
  if (categories.length === 0) {
    return { error: "No phases, tasks, or materials were found in that document." };
  }

  return { categories };
}
