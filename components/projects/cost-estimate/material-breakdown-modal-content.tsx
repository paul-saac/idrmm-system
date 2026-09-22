"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { updateTaskMaterialAssignments } from "@/lib/cost-estimate/actions";
import type { CostCategory } from "@/lib/cost-estimate/data";

function formatCurrency(amount: number | null | undefined) {
  return `₱${(amount ?? 0).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

let keySeq = 0;
function nextKey() {
  keySeq += 1;
  return `line-${keySeq}`;
}

type DraftLine = {
  // Local-only React key, never persisted — updateTaskMaterialAssignments
  // deletes and reinserts a task's whole list on save, so there's no
  // real id to track client-side between loads.
  key: string;
  materialName: string;
  specification: string;
  quantity: string;
  unit: string;
};

/**
 * Opened from the Cost Estimate Breakdown table's own "Material" column
 * header (see cost-estimate-view.tsx) — this is where a Bill of
 * Materials import (see import-bom-modal-content.tsx) is meant to land:
 * every task's planned materials, project-wide, laid out the same way a
 * real BOM document is (category -> task -> material lines), and — since
 * AI extraction is never fully trustworthy — directly editable right
 * here rather than read-only, so double-checking and correcting an
 * import (or just hand-maintaining the list without one) both happen in
 * the same place. Large-sized modal (see Modal's own `size` prop) since
 * this is really a small spreadsheet, not a one-glance summary.
 *
 * Saves per-task, only for tasks actually touched (dirtyTaskIds) — a
 * project can have many tasks, and resaving every one of them on every
 * edit would mean a lot of needless delete+reinsert round trips for
 * tasks nobody changed.
 *
 * Task creation/editing itself still lives on the Gantt Chart only (see
 * CostEstimateView's own doc comment) — this only ever edits a task's
 * *material list*, never adds/removes/renames a task.
 */
export function MaterialBreakdownModalContent({
  projectId,
  categories,
  onClose,
}: {
  projectId: number;
  categories: CostCategory[];
  onClose: () => void;
}) {
  const [draftByTask, setDraftByTask] = useState<Record<number, DraftLine[]>>(
    () => {
      const initial: Record<number, DraftLine[]> = {};
      for (const category of categories) {
        for (const task of category.tasks) {
          initial[task.id] = task.materialAssignments.map((m) => ({
            key: nextKey(),
            materialName: m.materialName,
            specification: m.specification ?? "",
            quantity: String(m.plannedQuantity),
            unit: m.unit ?? "",
          }));
        }
      }
      return initial;
    }
  );
  const [dirtyTaskIds, setDirtyTaskIds] = useState<Set<number>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function markDirty(taskId: number) {
    setDirtyTaskIds((prev) => (prev.has(taskId) ? prev : new Set(prev).add(taskId)));
  }

  function updateLine(taskId: number, key: string, patch: Partial<DraftLine>) {
    setDraftByTask((prev) => ({
      ...prev,
      [taskId]: prev[taskId].map((line) =>
        line.key === key ? { ...line, ...patch } : line
      ),
    }));
    markDirty(taskId);
  }

  function removeLine(taskId: number, key: string) {
    setDraftByTask((prev) => ({
      ...prev,
      [taskId]: prev[taskId].filter((line) => line.key !== key),
    }));
    markDirty(taskId);
  }

  function addLine(taskId: number) {
    setDraftByTask((prev) => ({
      ...prev,
      [taskId]: [
        ...(prev[taskId] ?? []),
        { key: nextKey(), materialName: "", specification: "", quantity: "", unit: "" },
      ],
    }));
    markDirty(taskId);
  }

  async function handleSave() {
    setError(null);
    setPending(true);
    const results = await Promise.all(
      Array.from(dirtyTaskIds).map((taskId) =>
        updateTaskMaterialAssignments(
          taskId,
          projectId,
          (draftByTask[taskId] ?? []).map((line) => ({
            materialName: line.materialName,
            specification: line.specification || null,
            plannedQuantity: Number(line.quantity) || 0,
            unit: line.unit || null,
          }))
        )
      )
    );
    setPending(false);
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      setError(failed.error);
      return;
    }
    onClose();
  }

  const grandTotal = categories.reduce(
    (sum, c) => sum + c.tasks.reduce((s, t) => s + t.materialEstimate, 0),
    0
  );

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-zinc-500">
        Every task&apos;s planned materials across the whole project — the
        same shape a Bill of Materials import fills in. Correct anything
        that looks off, or add/remove materials directly, then save.
      </p>

      <div className="flex flex-col gap-6">
        {categories.map((category) => {
          const tasks = category.tasks.filter(
            (t) => !t.isMilestone || t.totalEstimateCost > 0
          );
          if (tasks.length === 0) return null;
          return (
            <div key={category.id} className="flex flex-col gap-3">
              <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                {category.name}
              </p>
              {tasks.map((task) => {
                const lines = draftByTask[task.id] ?? [];
                return (
                  <div
                    key={task.id}
                    className="rounded-lg border border-zinc-200 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-zinc-700">
                        {task.name}
                      </p>
                      <p className="text-sm font-semibold text-zinc-900">
                        {formatCurrency(task.materialEstimate)}
                      </p>
                    </div>

                    {lines.length > 0 && (
                      <div className="mt-2 overflow-hidden rounded-md border border-zinc-200">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
                            <tr>
                              <th className="border-b border-zinc-200 px-3 py-2">
                                Material
                              </th>
                              <th className="border-b border-zinc-200 px-3 py-2">
                                Specification
                              </th>
                              <th className="border-b border-zinc-200 px-3 py-2 text-right">
                                Quantity
                              </th>
                              <th className="border-b border-zinc-200 px-3 py-2">
                                Unit
                              </th>
                              <th className="w-8 border-b border-zinc-200 px-2 py-2" />
                            </tr>
                          </thead>
                          <tbody>
                            {lines.map((line) => (
                              <tr
                                key={line.key}
                                className="border-b border-zinc-100 last:border-b-0"
                              >
                                <td className="px-2 py-1">
                                  <input
                                    type="text"
                                    value={line.materialName}
                                    onChange={(e) =>
                                      updateLine(task.id, line.key, {
                                        materialName: e.target.value,
                                      })
                                    }
                                    placeholder="Material"
                                    className="w-full rounded border border-transparent px-1.5 py-1 text-sm hover:border-zinc-200 focus:border-zinc-300 focus:bg-zinc-50 focus:outline-none"
                                  />
                                </td>
                                <td className="px-2 py-1">
                                  <input
                                    type="text"
                                    value={line.specification}
                                    onChange={(e) =>
                                      updateLine(task.id, line.key, {
                                        specification: e.target.value,
                                      })
                                    }
                                    placeholder="—"
                                    className="w-full rounded border border-transparent px-1.5 py-1 text-sm hover:border-zinc-200 focus:border-zinc-300 focus:bg-zinc-50 focus:outline-none"
                                  />
                                </td>
                                <td className="px-2 py-1 text-right">
                                  <input
                                    type="number"
                                    min={0}
                                    value={line.quantity}
                                    onChange={(e) =>
                                      updateLine(task.id, line.key, {
                                        quantity: e.target.value,
                                      })
                                    }
                                    className="w-20 rounded border border-transparent px-1.5 py-1 text-right text-sm hover:border-zinc-200 focus:border-zinc-300 focus:bg-zinc-50 focus:outline-none"
                                  />
                                </td>
                                <td className="px-2 py-1">
                                  <input
                                    type="text"
                                    value={line.unit}
                                    onChange={(e) =>
                                      updateLine(task.id, line.key, {
                                        unit: e.target.value,
                                      })
                                    }
                                    placeholder="—"
                                    className="w-20 rounded border border-transparent px-1.5 py-1 text-sm hover:border-zinc-200 focus:border-zinc-300 focus:bg-zinc-50 focus:outline-none"
                                  />
                                </td>
                                <td className="px-1 py-1">
                                  <button
                                    type="button"
                                    onClick={() => removeLine(task.id, line.key)}
                                    aria-label="Remove material"
                                    className="cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-red-50 hover:text-red-600"
                                  >
                                    <Trash2 className="size-3.5" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => addLine(task.id)}
                      className="mt-2 flex cursor-pointer items-center gap-1 text-xs font-medium text-zinc-500 transition hover:text-zinc-800"
                    >
                      <Plus className="size-3.5" />
                      Add material
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-zinc-200 pt-4">
        <div className="text-sm">
          <span className="font-medium text-zinc-500">
            Total Material Cost (Project)
          </span>{" "}
          <span className="font-semibold text-zinc-900">
            {formatCurrency(grandTotal)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={pending || dirtyTaskIds.size === 0}
            className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
