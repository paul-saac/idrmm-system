"use server";

import { getSessionProfile } from "@/lib/auth/session";

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
// docs). gemini-3.8-flash is the current flash-tier model new keys
// actually get free-tier access to.
const GEMINI_MODEL = "gemini-3.8-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Sent as inline base64 in the request body, not Google's separate Files
// API (this app has no infrastructure for that yet) — inline_data has a
// real ceiling around Gemini's own ~20MB total-request-size limit, and
// base64 itself inflates the raw file by ~4/3, so this stays comfortably
// under both. Covers the modal's own upload hint ("PDF or image, up to
// a few pages") without needing a second upload path for anything larger.
const MAX_FILE_BYTES = 15 * 1024 * 1024;

const ACCEPTED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
]);

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

The document is organized as phases/categories, each containing tasks (work items), each of which may list the materials it needs (name, quantity, unit, unit cost).

Rules:
- Extract every category, task, and material line exactly as stated in the document — do not invent, estimate, or round any value that isn't actually written there.
- A task sometimes has its own overall quantity/unit (e.g. "12 cu.m excavation") and no material lines; other times it's just a group header, with all quantity/cost living on its own material lines instead (e.g. "Concrete Footings" listing Cement, Sand, Gravel, Rebar underneath it). Both are valid — reproduce whichever shape the source document actually uses, per task.
- If a task or material's quantity, unit, or unit cost is not stated in the document, leave that field as an empty string rather than guessing a value.
- Respond with JSON only, matching the provided schema exactly.`;

const RESPONSE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      name: { type: "STRING" },
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
    required: ["name", "tasks"],
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

    categories.push({ name: categoryName, tasks });
  }
  return categories;
}

/**
 * Uploads a cost estimate document (PDF or photo — a Bill of Materials
 * is the common case, but see EXTRACTION_PROMPT's own doc comment for
 * why that's not the only shape accepted) straight to Gemini as
 * multimodal input — no separate PDF-parsing step in front of it — and
 * asks for the extracted phases/tasks/materials back as schema-
 * constrained JSON. Returns plain data (ExtractedCategory[]), not the
 * review draft's own DraftCategory[] shape (which also carries client-
 * generated ids for React keys/edits) — ImportBomModalContent maps one
 * onto the other once this resolves.
 *
 * Nothing is written to the project here — this only ever reads the
 * uploaded file and returns what Gemini extracted from it, for the admin
 * to review/correct in the draft UI before anything is created.
 */
export async function extractBomFromFile(
  formData: FormData
): Promise<BomExtractionState> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
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
  if (!ACCEPTED_MIME_TYPES.has(file.type)) {
    return { error: "Upload a PDF or image file (PNG, JPG, WEBP, or HEIC)." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      error: "That file is too large — try a smaller PDF or fewer pages.",
    };
  }

  const bytes = await file.arrayBuffer();
  const base64Data = Buffer.from(bytes).toString("base64");

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
              parts: [
                { text: EXTRACTION_PROMPT },
                { inline_data: { mime_type: file.type, data: base64Data } },
              ],
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
