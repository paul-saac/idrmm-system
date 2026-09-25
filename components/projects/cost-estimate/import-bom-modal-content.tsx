"use client";

import { useRef, useState } from "react";
import {
  AlertTriangle,
  FileText,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";

/**
 * UI-only preview of the planned "Import Bill of Materials" flow —
 * upload a BOM document, "AI" extracts it into an editable draft of
 * categories -> tasks -> material line items (mirroring the Cost
 * Estimate Breakdown's own structure, since a BOM is essentially a cost
 * estimate authored outside this system), the admin reviews/corrects
 * everything, then confirms.
 *
 * The actual AI extraction and the final "write this to the project"
 * step are deliberately NOT implemented yet (explicit instruction: build
 * the flow to visualize it, not the AI itself) — "Process with AI"
 * below seeds the draft from a fixed sample instead of a real upload
 * parse, and "Confirm" only shows what *would* be created rather than
 * calling any server action. Nothing here writes to the database.
 *
 * Opened from the Material Breakdown modal's own footer (see
 * MaterialBreakdownModalContent) — project-detail-view.tsx still owns
 * this modal's open state in case another entry point needs the same
 * instance later. Rendered as Modal's "centered" variant (an ordinary
 * dialog box) rather than the app's usual right-docked panel — this
 * flow isn't a spreadsheet-sized screen like the modal that opens it,
 * so it reads better centered.
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
  tasks: DraftTask[];
};

function nextId() {
  return Math.random().toString(36).slice(2);
}

// A small, representative slice of a real architect-prepared BOM this
// feature is meant to import — deliberately includes both task shapes a
// real BOM mixes: a single-line task with its own qty/unit/cost
// (Excavation), and a task that's just a group header with all of its
// qty/cost living on the material lines underneath it (Concrete
// Footings/Columns) — see this component's own doc comment above for
// why the latter's quantity/unit start blank rather than guessed.
function buildSampleExtraction(): DraftCategory[] {
  return [
    {
      id: nextId(),
      name: "E. EARTHWORKS",
      tasks: [
        {
          id: nextId(),
          name: "E.1 Excavation",
          quantity: "12",
          unit: "cu.m",
          materials: [],
        },
        {
          id: nextId(),
          name: "E.2 Backfilling / Filling & Compacting",
          quantity: "25",
          unit: "cu.m",
          materials: [],
        },
      ],
    },
    {
      id: nextId(),
      name: "G. CONCRETE WORKS",
      tasks: [
        {
          id: nextId(),
          name: "G.1 Concrete Footings",
          quantity: "",
          unit: "",
          materials: [
            { id: nextId(), name: "Portland Cement", quantity: "30", unit: "bags", unitCost: "210" },
            { id: nextId(), name: "Screened Sand", quantity: "1", unit: "cu.m", unitCost: "1200" },
            { id: nextId(), name: "3/4 Gravel", quantity: "2", unit: "cu.m", unitCost: "1800" },
            { id: nextId(), name: '12mm Ø Reinforced Steel Bar', quantity: "16", unit: "pcs", unitCost: "145" },
            { id: nextId(), name: "#16 G.I. Tie Wire", quantity: "10", unit: "kgs", unitCost: "100" },
          ],
        },
        {
          id: nextId(),
          name: "G.2 Concrete Columns",
          quantity: "",
          unit: "",
          materials: [
            { id: nextId(), name: "Portland Cement", quantity: "33", unit: "bags", unitCost: "210" },
            { id: nextId(), name: "Screened Sand", quantity: "2", unit: "cu.m", unitCost: "1200" },
            { id: nextId(), name: "3/4 Gravel", quantity: "4", unit: "cu.m", unitCost: "1800" },
          ],
        },
      ],
    },
  ];
}

function TaskQuantityField({
  value,
  onChange,
  unit,
  onUnitChange,
}: {
  value: string;
  onChange: (value: string) => void;
  unit: string;
  onUnitChange: (value: string) => void;
}) {
  const missing = value.trim() === "";
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {missing && (
        <span title="The BOM didn't state a quantity for this task — confirm one.">
          <AlertTriangle className="size-3.5 shrink-0 text-amber-500" />
        </span>
      )}
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Qty"
        className={`w-16 rounded border px-1.5 py-1 text-xs ${
          missing ? "border-amber-300 bg-amber-50" : "border-zinc-200"
        }`}
      />
      <input
        type="text"
        value={unit}
        onChange={(e) => onUnitChange(e.target.value)}
        placeholder="Unit"
        className={`w-16 rounded border px-1.5 py-1 text-xs ${
          missing ? "border-amber-300 bg-amber-50" : "border-zinc-200"
        }`}
      />
    </div>
  );
}

export function ImportBomModalContent({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<"upload" | "processing" | "review" | "done">(
    "upload"
  );
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [categories, setCategories] = useState<DraftCategory[]>([]);

  function handleFilePicked(files: FileList | null) {
    const file = files?.[0];
    if (file) setFileName(file.name);
  }

  function handleProcess() {
    setStep("processing");
    // Stands in for the real AI extraction call — see this file's own
    // doc comment. The delay is purely so the step actually reads as
    // "processing" rather than instantly swapping content.
    setTimeout(() => {
      setCategories(buildSampleExtraction());
      setStep("review");
    }, 900);
  }

  function updateCategoryName(categoryId: string, name: string) {
    setCategories((prev) =>
      prev.map((c) => (c.id === categoryId ? { ...c, name } : c))
    );
  }

  function removeCategory(categoryId: string) {
    setCategories((prev) => prev.filter((c) => c.id !== categoryId));
  }

  function addCategory() {
    setCategories((prev) => [
      ...prev,
      { id: nextId(), name: "New Category", tasks: [] },
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
          Upload a Bill of Materials document (PDF or photo) and AI will draft
          the phases, tasks, and material lists for you to review before
          anything is added to the project.
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
            accept="application/pdf,image/*"
            className="hidden"
            onChange={(e) => handleFilePicked(e.target.files)}
          />
          {fileName ? (
            <>
              <FileText className="size-6 text-zinc-500" />
              <p className="text-sm font-medium text-zinc-700">{fileName}</p>
              <p className="text-xs text-zinc-400">Click to choose a different file</p>
            </>
          ) : (
            <>
              <Upload className="size-6 text-zinc-400" />
              <p className="text-sm font-medium text-zinc-700">
                Drop a file here, or click to browse
              </p>
              <p className="text-xs text-zinc-400">PDF or image, up to a few pages</p>
            </>
          )}
        </div>

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
            disabled={!fileName}
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
          Extracting phases, tasks, and materials from {fileName}
        </p>
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <Sparkles className="size-6 text-zinc-400" />
        <p className="text-sm font-medium text-zinc-700">Preview complete</p>
        <p className="max-w-sm text-xs text-zinc-500">
          This would create {categories.length} categor
          {categories.length === 1 ? "y" : "ies"}, {taskCount} task
          {taskCount === 1 ? "" : "s"}, and {materialCount} material line
          {materialCount === 1 ? "" : "s"}. AI extraction and saving to the
          project aren&apos;t connected yet — this is a preview of the
          intended flow.
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

  // step === "review"
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500">
        Review and correct what AI found before it&apos;s added to the
        project — nothing is saved until you confirm.
      </p>

      <div className="flex flex-col gap-4">
        {categories.map((category) => (
          <div
            key={category.id}
            className="rounded-lg border border-zinc-200 bg-zinc-50/60"
          >
            <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2">
              <input
                type="text"
                value={category.name}
                onChange={(e) => updateCategoryName(category.id, e.target.value)}
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm font-semibold text-zinc-800 hover:border-zinc-200 focus:border-zinc-300 focus:bg-white focus:outline-none"
              />
              <button
                type="button"
                onClick={() => removeCategory(category.id)}
                aria-label="Remove category"
                className="cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>

            <div className="flex flex-col gap-3 px-3 py-3">
              {category.tasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-md border border-zinc-200 bg-white p-2.5"
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={task.name}
                      onChange={(e) =>
                        updateTask(category.id, task.id, { name: e.target.value })
                      }
                      className="min-w-0 flex-1 rounded border border-zinc-200 px-1.5 py-1 text-xs font-medium text-zinc-700"
                    />
                    <TaskQuantityField
                      value={task.quantity}
                      onChange={(value) =>
                        updateTask(category.id, task.id, { quantity: value })
                      }
                      unit={task.unit}
                      onUnitChange={(value) =>
                        updateTask(category.id, task.id, { unit: value })
                      }
                    />
                    <button
                      type="button"
                      onClick={() => removeTask(category.id, task.id)}
                      aria-label="Remove task"
                      className="shrink-0 cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>

                  {task.materials.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-1.5 border-t border-zinc-100 pt-2 pl-2">
                      {task.materials.map((material) => (
                        <li key={material.id} className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={material.name}
                            onChange={(e) =>
                              updateMaterial(category.id, task.id, material.id, {
                                name: e.target.value,
                              })
                            }
                            placeholder="Material"
                            className="min-w-0 flex-1 rounded border border-zinc-200 px-1.5 py-1 text-xs"
                          />
                          <input
                            type="number"
                            min={0}
                            value={material.quantity}
                            onChange={(e) =>
                              updateMaterial(category.id, task.id, material.id, {
                                quantity: e.target.value,
                              })
                            }
                            placeholder="Qty"
                            className="w-14 shrink-0 rounded border border-zinc-200 px-1.5 py-1 text-xs"
                          />
                          <input
                            type="text"
                            value={material.unit}
                            onChange={(e) =>
                              updateMaterial(category.id, task.id, material.id, {
                                unit: e.target.value,
                              })
                            }
                            placeholder="Unit"
                            className="w-14 shrink-0 rounded border border-zinc-200 px-1.5 py-1 text-xs"
                          />
                          <span className="shrink-0 text-xs text-zinc-400">₱</span>
                          <input
                            type="number"
                            min={0}
                            value={material.unitCost}
                            onChange={(e) =>
                              updateMaterial(category.id, task.id, material.id, {
                                unitCost: e.target.value,
                              })
                            }
                            placeholder="Unit cost"
                            className="w-16 shrink-0 rounded border border-zinc-200 px-1.5 py-1 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              removeMaterial(category.id, task.id, material.id)
                            }
                            aria-label="Remove material"
                            className="shrink-0 cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    onClick={() => addMaterial(category.id, task.id)}
                    className="mt-2 flex cursor-pointer items-center gap-1 pl-2 text-xs font-medium text-zinc-500 transition hover:text-zinc-800"
                  >
                    <Plus className="size-3" />
                    Add material
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={() => addTask(category.id)}
                className="flex cursor-pointer items-center gap-1 self-start text-xs font-medium text-zinc-500 transition hover:text-zinc-800"
              >
                <Plus className="size-3.5" />
                Add task
              </button>
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={addCategory}
          className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-300 py-2.5 text-xs font-medium text-zinc-500 transition hover:border-zinc-400 hover:text-zinc-800"
        >
          <Plus className="size-3.5" />
          Add category
        </button>
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-zinc-200 pt-4">
        <button
          type="button"
          onClick={() => setStep("upload")}
          className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => setStep("done")}
          className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800"
        >
          Confirm &amp; Create Tasks
        </button>
      </div>
    </div>
  );
}
