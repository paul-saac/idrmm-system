"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  FileText,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import {
  extractBomFromFile,
  type ExtractedCategory,
} from "@/lib/bom-import/actions";
import { applyBomImport } from "@/lib/cost-estimate/actions";

/**
 * "Import with AI" — upload a document (a Bill of Materials is the
 * common case, but nothing here actually requires that specific format —
 * any quotation/estimate laid out as phases/tasks/materials works the
 * same way), Gemini extracts it into an editable draft of categories ->
 * tasks -> material line items (mirroring the Cost Estimate Breakdown's
 * own structure, since this kind of document is essentially a cost
 * estimate authored outside this system), the admin reviews/corrects
 * everything, then confirms. Still named "Bom" in this file's own name
 * and its internal types/functions — that's just implementation history
 * (a Bill of Materials was the first shape this was built for), not a
 * constraint on what a user can actually upload; nothing user-facing
 * calls it that anymore.
 *
 * "Process with AI" below calls extractBomFromFile (lib/bom-import/
 * actions.ts), which sends the uploaded file straight to Gemini — a
 * PDF/photo as multimodal input (no separate PDF-text-extraction step,
 * so it reads table layout directly and works on a scanned/photographed
 * document the same way it works on a typed one), or a CSV/.xlsx as
 * plain text instead (see extractBomFromFile's own doc comment for why
 * those need different handling). "Confirm & Create Tasks" then calls
 * applyBomImport (lib/cost-estimate/actions.ts), which writes exactly
 * what's in the draft at that point (Gemini's own extraction, corrected
 * by hand as needed) to the project as real categories/tasks/material
 * assignments — nothing before that click ever touches the database.
 *
 * Opened from the Material Breakdown modal's own footer (see
 * MaterialBreakdownModalContent) and the Gantt Chart's own toolbar (see
 * gantt-chart-view.tsx's onImportBom) — project-detail-view.tsx still
 * owns this modal's open state so both entry points share the same
 * instance. Rendered as Modal's "centered" variant (an ordinary dialog
 * box) rather than the app's usual right-docked panel — this flow isn't
 * a spreadsheet-sized screen like the modal that opens it, so it reads
 * better centered.
 */

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

type DraftCategory = {
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

function formatCurrency(amount: number) {
  return `₱${amount.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

// Tolerant of thousands separators and stray whitespace, same reasoning
// as material-breakdown-modal-content.tsx's own parseNumber — a pasted
// or AI-extracted "20,000" still needs to compute correctly here.
function parseNumber(value: string): number {
  const n = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function lineAmount(material: DraftMaterialLine) {
  return parseNumber(material.quantity) * parseNumber(material.unitCost);
}

// A task's own Amount here is always a rollup of its material lines —
// unlike CostTask in the real Material Breakdown, a draft task from an
// import has no direct quantity/unit-cost line of its own to also
// blend in (see DraftTask's own doc comment: a bare task-level
// quantity/unit is just the source document's stated scope, not a
// cost), so a task with no material lines has no Amount at all yet.
function taskAmount(task: DraftTask) {
  return task.materials.reduce((sum, m) => sum + lineAmount(m), 0);
}

// A category with tasks rolls theirs up, same as Material Breakdown's
// own categoryAmount; a standalone category (no tasks) uses its own
// typed-in amount instead — see DraftCategory.amount's own doc comment.
function categoryAmount(category: DraftCategory) {
  if (category.tasks.length === 0) return parseNumber(category.amount);
  return category.tasks.reduce((sum, t) => sum + taskAmount(t), 0);
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
  const [processError, setProcessError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

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
    setCategories(toDraftCategories(result.categories));
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
    router.refresh();
    setStep("done");
  }

  function updateCategoryName(categoryId: string, name: string) {
    setCategories((prev) =>
      prev.map((c) => (c.id === categoryId ? { ...c, name } : c))
    );
  }

  function updateCategoryAmount(categoryId: string, amount: string) {
    setCategories((prev) =>
      prev.map((c) => (c.id === categoryId ? { ...c, amount } : c))
    );
  }

  function removeCategory(categoryId: string) {
    setCategories((prev) => prev.filter((c) => c.id !== categoryId));
  }

  function addCategory() {
    setCategories((prev) => [
      ...prev,
      { id: nextId(), name: "New Category", amount: "", tasks: [] },
    ]);
  }

  function updateTask(
    categoryId: string,
    taskId: string,
    patch: Partial<Omit<DraftTask, "id" | "materials">>
  ) {
    setCategories((prev) =>
      prev.map((c) =>
        c.id !== categoryId
          ? c
          : {
              ...c,
              tasks: c.tasks.map((t) =>
                t.id === taskId ? { ...t, ...patch } : t
              ),
            }
      )
    );
  }

  function removeTask(categoryId: string, taskId: string) {
    setCategories((prev) =>
      prev.map((c) =>
        c.id !== categoryId
          ? c
          : { ...c, tasks: c.tasks.filter((t) => t.id !== taskId) }
      )
    );
  }

  function addTask(categoryId: string) {
    setCategories((prev) =>
      prev.map((c) =>
        c.id !== categoryId
          ? c
          : {
              ...c,
              tasks: [
                ...c.tasks,
                {
                  id: nextId(),
                  name: "New Task",
                  quantity: "",
                  unit: "",
                  materials: [],
                },
              ],
            }
      )
    );
  }

  function updateMaterial(
    categoryId: string,
    taskId: string,
    materialId: string,
    patch: Partial<Omit<DraftMaterialLine, "id">>
  ) {
    setCategories((prev) =>
      prev.map((c) =>
        c.id !== categoryId
          ? c
          : {
              ...c,
              tasks: c.tasks.map((t) =>
                t.id !== taskId
                  ? t
                  : {
                      ...t,
                      materials: t.materials.map((m) =>
                        m.id === materialId ? { ...m, ...patch } : m
                      ),
                    }
              ),
            }
      )
    );
  }

  function removeMaterial(categoryId: string, taskId: string, materialId: string) {
    setCategories((prev) =>
      prev.map((c) =>
        c.id !== categoryId
          ? c
          : {
              ...c,
              tasks: c.tasks.map((t) =>
                t.id !== taskId
                  ? t
                  : { ...t, materials: t.materials.filter((m) => m.id !== materialId) }
              ),
            }
      )
    );
  }

  function addMaterial(categoryId: string, taskId: string) {
    setCategories((prev) =>
      prev.map((c) =>
        c.id !== categoryId
          ? c
          : {
              ...c,
              tasks: c.tasks.map((t) =>
                t.id !== taskId
                  ? t
                  : {
                      ...t,
                      materials: [
                        ...t.materials,
                        { id: nextId(), name: "", quantity: "", unit: "", unitCost: "" },
                      ],
                    }
              ),
            }
      )
    );
  }

  const taskCount = categories.reduce((sum, c) => sum + c.tasks.length, 0);
  const materialCount = categories.reduce(
    (sum, c) => sum + c.tasks.reduce((s, t) => s + t.materials.length, 0),
    0
  );

  if (step === "upload") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-zinc-500">
          Upload a document (PDF, photo, CSV, or Excel) — a Bill of
          Materials, a quotation, or any similar cost estimate — and AI
          will draft the phases, tasks, and material lists for you to
          review before anything is added to the project.
        </p>

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
              ? "border-zinc-800 bg-zinc-50"
              : "border-zinc-300 hover:border-zinc-400"
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
              <FileText className="size-6 text-zinc-500" />
              <p className="text-sm font-medium text-zinc-700">{file.name}</p>
              <p className="text-xs text-zinc-400">Click to choose a different file</p>
            </>
          ) : (
            <>
              <Upload className="size-6 text-zinc-400" />
              <p className="text-sm font-medium text-zinc-700">
                Drop a file here, or click to browse
              </p>
              <p className="text-xs text-zinc-400">PDF, image, CSV, or Excel</p>
            </>
          )}
        </div>

        {processError && (
          <p role="alert" className="text-sm text-red-600">
            {processError}
          </p>
        )}

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleProcess}
            disabled={!file}
            className="flex cursor-pointer items-center gap-1.5 rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Sparkles className="size-3.5" />
            Process with AI
          </button>
        </div>
      </div>
    );
  }

  if (step === "processing") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <Loader2 className="size-6 animate-spin text-zinc-400" />
        <p className="text-sm font-medium text-zinc-700">Reading your document…</p>
        <p className="text-xs text-zinc-400">
          Extracting phases, tasks, and materials from {file?.name}
        </p>
      </div>
    );
  }

  if (step === "confirming") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <Loader2 className="size-6 animate-spin text-zinc-400" />
        <p className="text-sm font-medium text-zinc-700">Saving to the project…</p>
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
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <Sparkles className="size-6 text-zinc-400" />
        <p className="text-sm font-medium text-zinc-700">Added to the project</p>
        <p className="max-w-sm text-xs text-zinc-500">
          Created {categories.length} categor
          {categories.length === 1 ? "y" : "ies"}, {taskCount} task
          {taskCount === 1 ? "" : "s"}, and {materialCount} material line
          {materialCount === 1 ? "" : "s"}.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800"
        >
          Close
        </button>
      </div>
    );
  }

  // step === "review" — laid out as one continuous table, deliberately
  // recycling the Material Breakdown table's own design (see
  // MaterialBreakdownModalContent's doc comment: category -> task ->
  // material rows, vertical column-divider lines running through every
  // row, category rows shaded bg-zinc-100, a material row indented
  // further with its own border-l-2 accent) so a document that's really
  // a small spreadsheet reads like one here too, instead of a stack of
  // cards. Unlike that table, every row here is still fully mutable
  // (add/remove category/task/material) since this is a draft still
  // being corrected before anything is saved — Material Breakdown only
  // ever edits existing rows in place.
  const grandTotal = categories.reduce((sum, c) => sum + categoryAmount(c), 0);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500">
        Review and correct what AI found before it&apos;s added to the
        project — nothing is saved until you confirm.
      </p>

      <div className="overflow-hidden rounded-md border border-zinc-200">
        <table className="w-full table-fixed text-left text-sm">
          <colgroup>
            <col />
            <col style={{ width: 90 }} />
            <col style={{ width: 70 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 100 }} />
          </colgroup>
          <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
            <tr>
              <th className="border-r border-b border-zinc-300 px-3 py-2">
                Description
              </th>
              <th className="border-r border-b border-zinc-300 px-3 py-2 text-right">
                Quantity
              </th>
              <th className="border-r border-b border-zinc-300 px-3 py-2 text-right">
                Unit
              </th>
              <th className="border-r border-b border-zinc-300 px-3 py-2 text-right">
                Unit Cost
              </th>
              <th className="border-b border-zinc-300 px-3 py-2 text-right">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <Fragment key={category.id}>
                <tr className="border-y border-y-zinc-200 bg-zinc-100">
                  <td className="border-r border-r-zinc-300">
                    <div className="flex items-center gap-1.5 pr-2">
                      <input
                        type="text"
                        value={category.name}
                        onChange={(e) =>
                          updateCategoryName(category.id, e.target.value)
                        }
                        className="min-w-0 flex-1 bg-transparent py-2.5 pl-3 text-xs font-semibold text-zinc-700 outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => removeCategory(category.id)}
                        aria-label="Remove category"
                        className="shrink-0 cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className="border-r border-r-zinc-300 px-3 py-1.5 text-right text-xs text-zinc-300">
                    —
                  </td>
                  <td className="border-r border-r-zinc-300 px-3 py-1.5 text-right text-xs text-zinc-300">
                    —
                  </td>
                  <td className="border-r border-r-zinc-300 px-3 py-1.5 text-right text-xs text-zinc-300">
                    —
                  </td>
                  <td>
                    {/* Only while this category has no tasks — a
                        standalone line item's own amount, same
                        asymmetric rule Material Breakdown already
                        applies to a task-less category's own direct
                        cost line. Once a task is added below, this
                        becomes a read-only rollup instead — see
                        categoryAmount's own doc comment. */}
                    {category.tasks.length === 0 ? (
                      <input
                        type="number"
                        min={0}
                        value={category.amount}
                        onChange={(e) =>
                          updateCategoryAmount(category.id, e.target.value)
                        }
                        placeholder="—"
                        className="w-full bg-transparent px-3 py-1.5 text-right text-sm font-semibold text-zinc-900 outline-none transition placeholder:text-xs placeholder:text-zinc-300 hover:bg-zinc-900 hover:text-white focus:bg-white focus:text-zinc-900"
                      />
                    ) : (
                      <div className="px-3 py-1.5 text-right text-sm font-semibold whitespace-nowrap text-zinc-900">
                        {formatCurrency(categoryAmount(category))}
                      </div>
                    )}
                  </td>
                </tr>
                {category.tasks.map((task) => {
                  const missingQty = task.quantity.trim() === "";
                  return (
                    <Fragment key={task.id}>
                      <tr className="border-b border-b-zinc-200">
                        <td className="border-r border-r-zinc-300 py-1.5 pr-2 pl-6">
                          <div className="flex items-center gap-1.5">
                            {missingQty && (
                              <span title="The document didn't state a quantity for this task — confirm one.">
                                <AlertTriangle className="size-3.5 shrink-0 text-amber-500" />
                              </span>
                            )}
                            <input
                              type="text"
                              value={task.name}
                              onChange={(e) =>
                                updateTask(category.id, task.id, {
                                  name: e.target.value,
                                })
                              }
                              className="min-w-0 flex-1 rounded bg-transparent px-1 py-1 text-xs font-semibold text-zinc-600 outline-none transition focus:bg-zinc-50"
                            />
                            <button
                              type="button"
                              onClick={() => addMaterial(category.id, task.id)}
                              className="shrink-0 cursor-pointer rounded border border-zinc-300 px-2 py-0.5 text-[11px] font-medium text-zinc-500 transition hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-800"
                            >
                              Add Material
                            </button>
                            <button
                              type="button"
                              onClick={() => removeTask(category.id, task.id)}
                              aria-label="Remove task"
                              className="shrink-0 cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </td>
                        <td
                          className={`border-r border-r-zinc-300 ${missingQty ? "bg-amber-50" : ""}`}
                        >
                          <input
                            type="number"
                            min={0}
                            value={task.quantity}
                            onChange={(e) =>
                              updateTask(category.id, task.id, {
                                quantity: e.target.value,
                              })
                            }
                            placeholder="—"
                            className="w-full bg-transparent px-3 py-1.5 text-right text-sm text-zinc-700 outline-none transition placeholder:text-xs placeholder:text-zinc-300 hover:bg-zinc-900 hover:text-white focus:bg-white focus:text-zinc-700"
                          />
                        </td>
                        <td
                          className={`border-r border-r-zinc-300 ${missingQty ? "bg-amber-50" : ""}`}
                        >
                          <input
                            type="text"
                            value={task.unit}
                            onChange={(e) =>
                              updateTask(category.id, task.id, {
                                unit: e.target.value,
                              })
                            }
                            placeholder="—"
                            className="w-full bg-transparent px-3 py-1.5 text-right text-sm text-zinc-700 outline-none transition placeholder:text-xs placeholder:text-zinc-300 hover:bg-zinc-900 hover:text-white focus:bg-white focus:text-zinc-700"
                          />
                        </td>
                        <td className="border-r border-r-zinc-300 px-3 py-1.5 text-right text-xs text-zinc-300">
                          —
                        </td>
                        <td>
                          {task.materials.length > 0 ? (
                            <div className="px-3 py-1.5 text-right text-sm font-semibold whitespace-nowrap text-zinc-900">
                              {formatCurrency(taskAmount(task))}
                            </div>
                          ) : (
                            <div className="px-3 py-1.5 text-right text-xs text-zinc-300">
                              —
                            </div>
                          )}
                        </td>
                      </tr>
                      {task.materials.map((material) => (
                        <tr
                          key={material.id}
                          className="border-b border-b-zinc-200 border-l-2 border-l-zinc-900"
                        >
                          <td className="border-r border-r-zinc-300 py-1.5 pr-2 pl-9">
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                value={material.name}
                                onChange={(e) =>
                                  updateMaterial(category.id, task.id, material.id, {
                                    name: e.target.value,
                                  })
                                }
                                placeholder="Material"
                                className="min-w-0 flex-1 bg-transparent py-1.5 text-xs font-semibold text-zinc-600 outline-none focus:bg-zinc-50"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  removeMaterial(category.id, task.id, material.id)
                                }
                                aria-label="Remove material"
                                className="shrink-0 cursor-pointer rounded p-1 text-zinc-300 transition hover:bg-red-50 hover:text-red-600"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                          </td>
                          <td className="border-r border-r-zinc-300">
                            <input
                              type="number"
                              min={0}
                              value={material.quantity}
                              onChange={(e) =>
                                updateMaterial(category.id, task.id, material.id, {
                                  quantity: e.target.value,
                                })
                              }
                              className="w-full bg-transparent px-3 py-1.5 text-right text-sm text-zinc-700 outline-none transition hover:bg-zinc-900 hover:text-white focus:bg-zinc-50 focus:text-zinc-700"
                            />
                          </td>
                          <td className="border-r border-r-zinc-300">
                            <input
                              type="text"
                              value={material.unit}
                              onChange={(e) =>
                                updateMaterial(category.id, task.id, material.id, {
                                  unit: e.target.value,
                                })
                              }
                              placeholder="—"
                              className="w-full bg-transparent px-3 py-1.5 text-right text-sm text-zinc-700 outline-none transition placeholder:text-xs placeholder:text-zinc-300 hover:bg-zinc-900 hover:text-white focus:bg-zinc-50 focus:text-zinc-700"
                            />
                          </td>
                          <td className="border-r border-r-zinc-300">
                            <input
                              type="number"
                              min={0}
                              value={material.unitCost}
                              onChange={(e) =>
                                updateMaterial(category.id, task.id, material.id, {
                                  unitCost: e.target.value,
                                })
                              }
                              className="w-full bg-transparent px-3 py-1.5 text-right text-sm text-zinc-700 outline-none transition hover:bg-zinc-900 hover:text-white focus:bg-zinc-50 focus:text-zinc-700"
                            />
                          </td>
                          <td className="px-3 py-1.5 text-right text-sm whitespace-nowrap text-zinc-700">
                            {formatCurrency(lineAmount(material))}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
                <tr className="border-b border-b-zinc-200">
                  <td colSpan={5} className="py-1.5 pr-3 pl-6">
                    <button
                      type="button"
                      onClick={() => addTask(category.id)}
                      className="flex cursor-pointer items-center gap-1 text-xs font-medium text-zinc-500 transition hover:text-zinc-800"
                    >
                      <Plus className="size-3.5" />
                      Add task
                    </button>
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={addCategory}
        className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-300 py-2.5 text-xs font-medium text-zinc-500 transition hover:border-zinc-400 hover:text-zinc-800"
      >
        <Plus className="size-3.5" />
        Add category
      </button>

      {confirmError && (
        <p role="alert" className="text-sm text-red-600">
          {confirmError}
        </p>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-zinc-200 pt-4">
        <div className="text-sm">
          <span className="font-medium text-zinc-500">Estimated Total</span>{" "}
          <span className="font-semibold text-zinc-900">
            {formatCurrency(grandTotal)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setStep("upload")}
            className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
          >
            Back
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={categories.length === 0}
            className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Confirm &amp; Create Tasks
          </button>
        </div>
      </div>
    </div>
  );
}
