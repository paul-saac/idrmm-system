"use server";

import { requireAdminOrForeman } from "@/lib/auth/project-access";

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

// gemini-2.5-flash (this file's original choice) turned out to be
// restricted-access now — Google limits the 2.x generation to accounts
// that already used it before, so a freshly-created API key gets
// rejected outright (confirmed directly against Google's own current
// docs). gemini-3.8-flash (the next choice) has free-tier access but is
// also the newest, most in-demand model, so it hit real 503 "high
// demand" errors in practice — confirmed directly against a real key.
// gemini-3.5-flash is one generation back: still free-tier and still
// strong at document/table extraction, but far less contended since
// default traffic goes to 3.8 first.
const GEMINI_MODEL = "gemini-3.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Sent as inline base64 in the request body, not Google's separate Files
// API (this app has no infrastructure for that yet) — inline_data has a
// real ceiling around Gemini's own ~20MB total-request-size limit, and
// base64 itself inflates the raw file by ~4/3, so this stays comfortably
// under both. Covers the modal's own upload hint ("PDF or image, up to
// a few pages") without needing a second upload path for anything larger.
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

// A 503 from Gemini means its own servers are at capacity, not that
// anything about this request was wrong — confirmed directly the first
// time this ran end-to-end against a real key ("This model is currently
// experiencing high demand..."). That kind of spike is near-always gone
// within a few seconds, so retrying here beats surfacing a scary error
// for something that would usually already be resolved by the time an
// admin re-clicked "Process with AI" themselves. Only 503 gets this
// treatment — 429 (this project's own quota, not Gemini's capacity) and
// 4xx (a real request problem) retrying blindly wouldn't help either.
const MAX_ATTEMPTS = 3;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// Sent as the model's own text instructions alongside the file itself
// (inline_data) — Gemini reads the PDF/photo directly, no separate
// text-extraction library in front of it, so it can still see table
// layout a flattened text dump would lose, and it works on a scanned/
// photographed document (no text layer at all) the same way it works on
// a typed one. Deliberately not framed as "a BOM" specifically — a Bill
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
- Respond with JSON only, matching the provided schema exactly.`;

const RESPONSE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      name: { type: "STRING" },
      amount: { type: "STRING" },
      tasks: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING" },
            quantity: { type: "STRING" },
            unit: { type: "STRING" },
            materials: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  name: { type: "STRING" },
                  quantity: { type: "STRING" },
                  unit: { type: "STRING" },
                  unitCost: { type: "STRING" },
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
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Defensive runtime validation/coercion of Gemini's own JSON response —
 * response_schema constrains the model's output, but this still isn't a
 * compiler guarantee (a truncated response, a schema Gemini quietly
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

/**
 * Uploads a cost estimate document (PDF, photo, CSV, or .xlsx — a Bill
 * of Materials is the common case, but see EXTRACTION_PROMPT's own doc
 * comment for why that's not the only shape accepted) straight to
 * Gemini — a PDF/photo as multimodal inline_data input, a CSV/.xlsx as
 * a plain text part instead (see the requestParts block below for why
 * those need different handling) — no separate PDF-parsing step in
 * front of any of them, and asks for the extracted phases/tasks/
 * materials back as schema-constrained JSON. Returns plain data
 * (ExtractedCategory[]), not the review draft's own DraftCategory[]
 * shape (which also carries client-generated ids for React keys/edits)
 * — ImportBomModalContent maps one onto the other once this resolves.
 *
 * Nothing is written to the project here — this only ever reads the
 * uploaded file and returns what Gemini extracted from it, for the admin
 * to review/correct in the draft UI before anything is created.
 */
export async function extractBomFromFile(
  formData: FormData
): Promise<BomExtractionState> {
  // No project data is read or written here (applyBomImport does that,
  // with its own project check), so a role check is enough.
  const profile = await requireAdminOrForeman();
  if (!profile) {
    return { error: "You are not authorized to use this feature." };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      error:
        "The Gemini API key isn't configured yet. Add GEMINI_API_KEY to your .env file and restart the dev server.",
    };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { error: "No file was uploaded." };
  }

  const isCsv = isCsvFile(file);
  const isExcel = !isCsv && isExcelFile(file);
  const isSpreadsheet = isCsv || isExcel;
  if (!isSpreadsheet && !ACCEPTED_MIME_TYPES.has(file.type)) {
    return {
      error: "Upload a PDF, image (PNG, JPG, WEBP, HEIC), CSV, or Excel (.xlsx) file.",
    };
  }
  if (isSpreadsheet && file.size > MAX_SPREADSHEET_BYTES) {
    return { error: "That file is too large — try a smaller export." };
  }
  if (!isSpreadsheet && file.size > MAX_FILE_BYTES) {
    return {
      error: "That file is too large — try a smaller PDF or fewer pages.",
    };
  }

  // A CSV is already plain text, and an .xlsx gets read into the same
  // kind of plain text by excelToText above — either way it's sent as a
  // second text part instead of inline_data, since Gemini's own document
  // vision only meaningfully understands PDFs/images; anything else
  // handed to inline_data just gets extracted back to pure text anyway
  // (confirmed directly against Google's own docs), so there's nothing
  // gained by routing either through that path, and it saves the
  // base64-encoding overhead entirely.
  const requestParts: (
    | { text: string }
    | { inline_data: { mime_type: string; data: string } }
  )[] = [{ text: EXTRACTION_PROMPT }];
  if (isCsv) {
    const csvText = await file.text();
    requestParts.push({
      text: `Here is the CSV file's own contents:\n\n${csvText}`,
    });
  } else if (isExcel) {
    let excelText: string;
    try {
      excelText = await excelToText(file);
    } catch (error) {
      console.error("[extractBomFromFile] Could not read Excel file:", error);
      return {
        error: "Couldn't read that Excel file — make sure it's a valid .xlsx file.",
      };
    }
    requestParts.push({
      text: `Here is the Excel file's own contents (each sheet, one row per line, columns separated by " | "):\n\n${excelText}`,
    });
  } else {
    const bytes = await file.arrayBuffer();
    const base64Data = Buffer.from(bytes).toString("base64");
    requestParts.push({
      inline_data: { mime_type: file.type, data: base64Data },
    });
  }

  let response: Response;
  let attempt = 1;
  for (;;) {
    try {
      response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: requestParts,
            },
          ],
          generationConfig: {
            response_mime_type: "application/json",
            response_schema: RESPONSE_SCHEMA,
          },
        }),
      });
    } catch (error) {
      console.error("[extractBomFromFile] Gemini request failed:", error);
      return {
        error: "Could not reach Gemini. Check your connection and try again.",
      };
    }

    if (response.status !== 503 || attempt >= MAX_ATTEMPTS) break;
    console.error(
      `[extractBomFromFile] Gemini returned 503 (attempt ${attempt}/${MAX_ATTEMPTS}) — retrying`
    );
    await sleep(1000 * attempt);
    attempt += 1;
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(
      "[extractBomFromFile] Gemini API error",
      response.status,
      bodyText
    );
    // Gemini's own error body is {"error":{"code","message","status"}} —
    // surfaced directly (not just logged server-side) so a wrong model
    // id/API key/quota issue is diagnosable from the modal itself, not
    // just the dev server terminal. This is exactly what caught
    // gemini-2.5-flash's own access restriction above, the first time
    // this ran against a real key.
    let geminiMessage: string | null = null;
    try {
      const parsedBody = JSON.parse(bodyText);
      geminiMessage =
        typeof parsedBody?.error?.message === "string"
          ? parsedBody.error.message
          : null;
    } catch {
      // bodyText wasn't JSON — geminiMessage stays null, fall through
      // to the generic per-status message below.
    }

    if (response.status === 429) {
      return {
        error: "Gemini's free-tier rate limit was hit — wait a moment and try again.",
      };
    }
    return {
      error: geminiMessage
        ? `Gemini error (${response.status}): ${geminiMessage}`
        : `Gemini couldn't process this document (HTTP ${response.status}). Check the server terminal for details.`,
    };
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") {
    console.error("[extractBomFromFile] Unexpected Gemini response shape", payload);
    return { error: "Gemini returned an unexpected response. Please try again." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error("[extractBomFromFile] Gemini response wasn't valid JSON:", text);
    return { error: "Gemini's response couldn't be read. Please try again." };
  }

  const categories = normalizeCategories(parsed);
  if (!categories) {
    console.error(
      "[extractBomFromFile] Gemini response didn't match the expected shape",
      parsed
    );
    return {
      error: "Gemini's response didn't match the expected format. Please try again.",
    };
  }
  if (categories.length === 0) {
    return { error: "No phases, tasks, or materials were found in that document." };
  }

  return { categories };
}
