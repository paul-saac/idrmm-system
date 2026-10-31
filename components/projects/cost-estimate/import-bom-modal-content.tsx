"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FileText,
  History,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { AiSparklesIcon } from "@/components/ui/ai-sparkles-icon";
import {
  extractBomFromFile,
  type ExtractedCategory,
} from "@/lib/bom-import/actions";
import { applyBomImport } from "@/lib/cost-estimate/actions";
import { ImportBomDraftReview } from "./import-bom-draft-review";

/** Upload -> extraction -> editable draft -> confirm. The browser keeps recent
 * drafts until they are applied. Only applyBomImport writes project records;
 * the review workspace edits the same draft and preserves that boundary. */

type DraftMaterialLine = {
  id: string;
  name: string;
  quantity: string;
  unit: string;
  unitCost: string;
};

type DraftTask = {
  id: string;
  name: string;
  // A task-level quantity/unit isn't always present in a BOM (see
  // SAMPLE_EXTRACTION below — a task that's really just a group header
  // for its own material lines has neither) — kept as a string so an
  // empty one reads as "not stated" rather than coercing to 0, which
  // would silently look like a real, deliberate value.
  quantity: string;
  unit: string;
  materials: DraftMaterialLine[];
};

export type DraftCategory = {
  id: string;
  name: string;
  // Only meaningful (and only ever shown/editable — see the review
  // step's own category header below) while `tasks` is empty — a
  // standalone top-level line item the source document never broke
  // down further, same "no tasks yet, own direct line" concept
  // estimate_categories.material_direct_amount already models for a
  // category created by hand. See applyBomImport's own doc comment
  // (lib/cost-estimate/actions.ts) for how this gets saved.
  amount: string;
  tasks: DraftTask[];
};

type RecentImportDraft = {
  id: string;
  sourceName: string;
  createdAt: string;
  updatedAt: string;
  categories: DraftCategory[];
};

const MAX_RECENT_DRAFTS = 5;

function draftStorageKey(projectId: number) {
  return `idrmm:ai-import-drafts:${projectId}`;
}

function isDraftCategories(value: unknown): value is DraftCategory[] {
  return (
    Array.isArray(value) &&
    value.every(
      (category) =>
        typeof category?.id === "string" &&
        typeof category?.name === "string" &&
        typeof category?.amount === "string" &&
        Array.isArray(category?.tasks) &&
        category.tasks.every(
          (task: unknown) => {
            if (typeof task !== "object" || task === null) return false;
            const row = task as Record<string, unknown>;
            return (
              typeof row.id === "string" &&
              typeof row.name === "string" &&
              typeof row.quantity === "string" &&
              typeof row.unit === "string" &&
              Array.isArray(row.materials) &&
              row.materials.every((material: unknown) => {
                if (typeof material !== "object" || material === null) return false;
                const line = material as Record<string, unknown>;
                return (
                  typeof line.id === "string" &&
                  typeof line.name === "string" &&
                  typeof line.quantity === "string" &&
                  typeof line.unit === "string" &&
                  typeof line.unitCost === "string"
                );
              })
            );
          }
        )
    )
  );
}

function readRecentDrafts(projectId: number): RecentImportDraft[] {
  try {
    const stored = window.localStorage.getItem(draftStorageKey(projectId));
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (draft): draft is RecentImportDraft =>
          typeof draft?.id === "string" &&
          typeof draft?.sourceName === "string" &&
          typeof draft?.createdAt === "string" &&
          typeof draft?.updatedAt === "string" &&
          isDraftCategories(draft?.categories)
      )
      .slice(0, MAX_RECENT_DRAFTS);
  } catch {
    return [];
  }
}

function nextId() {
  return Math.random().toString(36).slice(2);
}

// extractBomFromFile returns plain ExtractedCategory[] (no ids — nothing
// client-side to key React elements by or edit in place yet) — this
// attaches a fresh client-generated id to every category/task/material
// line, same as addCategory/addTask/addMaterial below already do for a
// row created straight in the browser.
function toDraftCategories(extracted: ExtractedCategory[]): DraftCategory[] {
  return extracted.map((category) => ({
    id: nextId(),
    name: category.name,
    amount: category.amount,
    tasks: category.tasks.map((task) => ({
      id: nextId(),
      name: task.name,
      quantity: task.quantity,
      unit: task.unit,
      materials: task.materials.map((material) => ({
        id: nextId(),
        name: material.name,
        quantity: material.quantity,
        unit: material.unit,
        unitCost: material.unitCost,
      })),
    })),
  }));
}

export type ImportBomStep =
  | "upload"
  | "processing"
  | "review"
  | "confirming"
  | "done";

export function ImportBomModalContent({
  projectId,
  onClose,
  onStepChange,
}: {
  projectId: number;
  onClose: () => void;
  /** Reports the current step up to the Modal wrapper (project-detail-
   * view.tsx) so it can widen itself only for "review" — a wide dialog
   * only actually helps once there's a spreadsheet-sized draft to
   * double-check; every other step (upload, a spinner, a done message)
   * is a small, centered piece of content that looks lost at that
   * width. See Modal's own `size` prop. */
  onStepChange?: (step: ImportBomStep) => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<ImportBomStep>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [categories, setCategories] = useState<DraftCategory[]>([]);
  const [recentDrafts, setRecentDrafts] = useState<RecentImportDraft[]>([]);
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const [processError, setProcessError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  useEffect(() => {
    const loadDrafts = window.setTimeout(() => {
      setRecentDrafts(readRecentDrafts(projectId));
    }, 0);
    return () => window.clearTimeout(loadDrafts);
  }, [projectId]);

  // Keep every edit made in the review table. Closing the modal unmounts
  // this component, but the project-specific browser draft remains and is
  // offered under Recently imported the next time the modal opens.
  useEffect(() => {
    if (!currentDraftId) return;
    const next = recentDrafts.map((draft) =>
      draft.id === currentDraftId
        ? { ...draft, categories, updatedAt: new Date().toISOString() }
        : draft
    );
    try {
      window.localStorage.setItem(draftStorageKey(projectId), JSON.stringify(next));
    } catch {
      // Storage can be unavailable in a restricted/private browser. The
      // current in-memory review remains usable for this open modal.
    }
  }, [categories, currentDraftId, projectId, recentDrafts]);

  useEffect(() => {
    onStepChange?.(step);
    // onStepChange isn't a stable identity across the parent's own
    // renders — only re-reporting when `step` itself actually changes
    // (not on every parent re-render) is what matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function handleFilePicked(files: FileList | null) {
    const picked = files?.[0];
    if (picked) {
      setFile(picked);
      setProcessError(null);
    }
  }

  function storeRecentDrafts(next: RecentImportDraft[]) {
    const limited = next.slice(0, MAX_RECENT_DRAFTS);
    setRecentDrafts(limited);
    try {
      window.localStorage.setItem(draftStorageKey(projectId), JSON.stringify(limited));
    } catch {
      // Keep the current session usable even if browser storage is disabled.
    }
  }

  function resumeDraft(draft: RecentImportDraft) {
    setCategories(draft.categories);
    setCurrentDraftId(draft.id);
    setFile(null);
    setProcessError(null);
    setConfirmError(null);
    setStep("review");
  }

  function removeDraft(draftId: string) {
    storeRecentDrafts(recentDrafts.filter((draft) => draft.id !== draftId));
    if (currentDraftId === draftId) setCurrentDraftId(null);
  }

  function returnToUpload() {
    if (currentDraftId) {
      const next = recentDrafts.map((draft) =>
        draft.id === currentDraftId
          ? { ...draft, categories, updatedAt: new Date().toISOString() }
          : draft
      );
      storeRecentDrafts(next);
    }
    setStep("upload");
  }

  async function handleProcess() {
    if (!file) return;
    setProcessError(null);
    setStep("processing");
    const formData = new FormData();
    formData.set("file", file);
    const result = await extractBomFromFile(formData);
    if (!result.categories) {
      setProcessError(result.error ?? "Something went wrong. Please try again.");
      setStep("upload");
      return;
    }
    const importedCategories = toDraftCategories(result.categories);
    const importedAt = new Date().toISOString();
    const draft: RecentImportDraft = {
      id: nextId(),
      sourceName: file.name,
      createdAt: importedAt,
      updatedAt: importedAt,
      categories: importedCategories,
    };
    setCategories(importedCategories);
    setCurrentDraftId(draft.id);
    storeRecentDrafts([draft, ...recentDrafts]);
    setStep("review");
  }

  async function handleConfirm() {
    setConfirmError(null);
    setStep("confirming");
    // Sends exactly what's currently in the draft (whatever the admin
    // has corrected by hand) — the id fields on DraftCategory/DraftTask/
    // DraftMaterialLine are harmless excess properties here, applyBomImport
    // only reads name/quantity/unit/materials.
    const result = await applyBomImport(projectId, categories);
    if (result.error) {
      setConfirmError(result.error);
      setStep("review");
      return;
    }
    if (currentDraftId) removeDraft(currentDraftId);
    router.refresh();
    setStep("done");
  }

  const taskCount = categories.reduce((sum, c) => sum + c.tasks.length, 0);
  const materialCount = categories.reduce(
    (sum, c) => sum + c.tasks.reduce((s, t) => s + t.materials.length, 0),
    0
  );

  if (step === "upload") {
    return (
      <div className="flex flex-col gap-4 text-zinc-200">
        <p className="text-sm text-zinc-400">
          Upload a document (PDF, photo, CSV, or Excel) — a Bill of
          Materials, a quotation, or any similar cost estimate — and AI
          will draft the phases, tasks, and material lists for you to
          review before anything is added to the project.
        </p>

        {recentDrafts.length > 0 && (
          <section className="overflow-hidden rounded-md border border-white/10 bg-zinc-900 text-white">
            <div className="flex items-center gap-2 border-b border-white/10 bg-zinc-900 px-3 py-2.5">
              <History aria-hidden className="size-4 text-zinc-400" />
              <div>
                <h3 className="text-sm font-semibold text-white">Recently imported</h3>
                <p className="text-[11px] text-zinc-400">
                  Drafts are saved automatically on this device.
                </p>
              </div>
            </div>
            <div className="divide-y divide-white/10">
              {recentDrafts.map((draft) => {
                const tasks = draft.categories.reduce(
                  (sum, category) => sum + category.tasks.length,
                  0
                );
                return (
                  <div key={draft.id} className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-white/5">
                    <FileText aria-hidden className="size-4 shrink-0 text-zinc-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">
                        {draft.sourceName}
                      </p>
                      <p className="text-[11px] text-zinc-400">
                        {draft.categories.length} categor
                        {draft.categories.length === 1 ? "y" : "ies"} · {tasks} task
                        {tasks === 1 ? "" : "s"} · Updated {new Date(draft.updatedAt).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => resumeDraft(draft)}
                      className="cursor-pointer rounded border border-white/15 bg-white px-3 py-1.5 text-xs font-medium text-zinc-900 transition hover:bg-zinc-100"
                    >
                      Resume
                    </button>
                    <button
                      type="button"
                      onClick={() => removeDraft(draft.id)}
                      aria-label={`Delete draft for ${draft.sourceName}`}
                      className="cursor-pointer rounded p-1.5 text-zinc-400 transition hover:bg-red-500/10 hover:text-red-400"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            handleFilePicked(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-12 text-center transition ${
            dragActive
              ? "border-emerald-400 bg-emerald-500/10"
              : "border-white/15 bg-zinc-800/30 hover:border-white/30 hover:bg-zinc-800/50"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/*,.csv,text/csv,application/vnd.ms-excel,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => handleFilePicked(e.target.files)}
          />
          {file ? (
            <>
              <FileText className="size-6 text-emerald-400" />
              <p className="text-sm font-medium text-white">{file.name}</p>
              <p className="text-xs text-zinc-400">Click to choose a different file</p>
            </>
          ) : (
            <>
              <Upload className="size-6 text-zinc-400" />
              <p className="text-sm font-medium text-zinc-200">
                Drop a file here, or click to browse
              </p>
              <p className="text-xs text-zinc-400">PDF, image, CSV, or Excel</p>
            </>
          )}
        </div>

        {processError && (
          <p role="alert" className="text-sm text-red-400">
            {processError}
          </p>
        )}

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded border border-white/15 bg-transparent px-4 py-2 text-sm font-medium text-zinc-300 transition hover:bg-white/10 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleProcess}
            disabled={!file}
            className="flex cursor-pointer items-center gap-2 rounded bg-white px-4 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-100 disabled:cursor-not-allowed"
          >
            <AiSparklesIcon className="size-5 text-emerald-600 shrink-0" />
            Process with AI
          </button>
        </div>
      </div>
    );
  }

  if (step === "processing") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <Loader2 className="size-6 animate-spin text-emerald-400" />
        <p className="text-sm font-medium text-white">Reading your document…</p>
        <p className="text-xs text-zinc-400">
          Extracting phases, tasks, and materials from {file?.name}
        </p>
      </div>
    );
  }

  if (step === "confirming") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <Loader2 className="size-6 animate-spin text-emerald-400" />
        <p className="text-sm font-medium text-white">Saving to the project…</p>
        <p className="text-xs text-zinc-400">
          Creating {categories.length} categor
          {categories.length === 1 ? "y" : "ies"}, {taskCount} task
          {taskCount === 1 ? "" : "s"}, and {materialCount} material line
          {materialCount === 1 ? "" : "s"}
        </p>
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="flex flex-col items-center justify-center gap-3.5 py-16 text-center">
        <div className="flex size-14 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/15">
          <AiSparklesIcon className="size-8 text-emerald-400" />
        </div>
        <p className="text-base font-semibold text-white">Added to the project</p>
        <p className="max-w-sm text-xs text-zinc-400">
          Created {categories.length} categor
          {categories.length === 1 ? "y" : "ies"}, {taskCount} task
          {taskCount === 1 ? "" : "s"}, and {materialCount} material line
          {materialCount === 1 ? "" : "s"}.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 cursor-pointer rounded bg-white px-4 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-100"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <ImportBomDraftReview
      categories={categories}
      onChange={setCategories}
      onBack={returnToUpload}
      onConfirm={handleConfirm}
      error={confirmError}
    />
  );
}
