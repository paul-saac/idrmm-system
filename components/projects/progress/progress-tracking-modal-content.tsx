"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import type { ProjectMaterial } from "@/lib/materials/data";
import type { TaskProgressToday } from "@/lib/task-progress/data";

type ProgressActionResult = { error?: string; success?: boolean };

let keySeq = 0;
function nextKey() {
  keySeq += 1;
  return `usage-${keySeq}`;
}

type DraftMaterialUsage = {
  key: string;
  materialId: number | null;
  quantity: string;
};

/**
 * Opened by a single click on a task's own bar in the Gantt Chart (see
 * handleBarClick in gantt-chart-view.tsx) — the Progress Tracking
 * Override: "the user inputs how much quantity was completed, materials
 * were consumed, and labor was spent within the day." Percent complete
 * itself is never typed directly here (or anywhere — see
 * CostEstimateView's own doc comment on why the old freely-typable cell
 * was removed): quantity completed is what actually drives it
 * (quantityCompleted / estimatedQuantity, the same relationship the
 * separate Daily-Log-driven Progress Overview tab already uses),
 * materials/labor are recorded alongside it for accountability and — for
 * materials specifically — a real project_materials stock deduction on
 * save (see recordTaskProgress/recordCategoryProgress), not additional
 * inputs to the percentage formula itself: consuming materials or
 * logging a crew isn't proof of finished work the way a completed
 * quantity is.
 *
 * Generalized to accept either a task or a task-less category (see
 * gantt-chart-view.tsx's own `progressModal` discriminated union) — this
 * component itself only ever needs the entity's id, estimatedQuantity/
 * unit, and an `onSave` callback the caller wires to either
 * recordTaskProgress or recordCategoryProgress, same "caller supplies
 * the save action" shape AssignWorkersModalContent already uses.
 *
 * Always operates on *today* (see recordTaskProgress's own doc comment
 * — no date picker, this isn't a historical backfill tool). Reopening
 * later the same day pre-fills whatever was already saved today
 * (progressToday.today), so correcting a same-day mistake is just
 * editing and resaving, not creating a duplicate entry.
 */
export function ProgressTrackingModalContent({
  estimatedQuantity,
  unit,
  materials,
  progressToday,
  onSave,
  onClose,
}: {
  estimatedQuantity: number;
  unit: string | null;
  materials: ProjectMaterial[];
  progressToday: TaskProgressToday;
  onSave: (input: {
    quantityCompletedToday: number;
    laborHeadcount: number;
    materialsUsed: { materialId: number; quantity: number }[];
  }) => Promise<ProgressActionResult>;
  onClose: () => void;
}) {
  const router = useRouter();
  const priorCumulative =
    progressToday.cumulativeQuantityCompleted -
    (progressToday.today?.quantityCompleted ?? 0);

  const [quantityToday, setQuantityToday] = useState(
    progressToday.today ? String(progressToday.today.quantityCompleted) : ""
  );
  const [laborHeadcount, setLaborHeadcount] = useState(
    progressToday.today ? String(progressToday.today.laborHeadcount) : ""
  );
  const [materialRows, setMaterialRows] = useState<DraftMaterialUsage[]>(
    () =>
      progressToday.today?.materials.map((m) => ({
        key: nextKey(),
        materialId: m.materialId,
        quantity: String(m.quantity),
      })) ?? []
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const materialById = new Map(materials.map((m) => [m.id, m]));

  function addMaterialRow() {
    setMaterialRows((prev) => [
      ...prev,
      { key: nextKey(), materialId: materials[0]?.id ?? null, quantity: "" },
    ]);
  }

  function updateMaterialRow(key: string, patch: Partial<DraftMaterialUsage>) {
    setMaterialRows((prev) =>
      prev.map((row) => (row.key === key ? { ...row, ...patch } : row))
    );
  }

  function removeMaterialRow(key: string) {
    setMaterialRows((prev) => prev.filter((row) => row.key !== key));
  }

  const parsedQuantityToday = Number(quantityToday) || 0;
  const newCumulative = priorCumulative + parsedQuantityToday;
  // Exact fraction, not rounded — see computeAutoPercentComplete's own
  // doc comment (lib/task-progress/calculate.ts) for why; formatted for
  // display only at the point it's rendered below.
  const previewPercent =
    estimatedQuantity > 0
      ? Math.min(100, Math.max(0, (newCumulative / estimatedQuantity) * 100))
      : 0;

  async function handleSave() {
    setError(null);
    if (parsedQuantityToday < 0) {
      setError("Quantity completed can't be negative.");
      return;
    }
    const headcount = Number(laborHeadcount) || 0;
    if (headcount < 0) {
      setError("Labor headcount can't be negative.");
      return;
    }
    const materialsUsed: { materialId: number; quantity: number }[] = [];
    for (const row of materialRows) {
      if (row.materialId === null) continue;
      const quantity = Number(row.quantity) || 0;
      if (quantity <= 0) continue;
      materialsUsed.push({ materialId: row.materialId, quantity });
    }

    setPending(true);
    const result = await onSave({
      quantityCompletedToday: parsedQuantityToday,
      laborHeadcount: headcount,
      materialsUsed,
    });
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    <div className="flex h-full min-h-full flex-col gap-5">
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="progress-quantity"
            className="text-xs font-medium text-zinc-500"
          >
            Quantity completed today
          </label>
          <div className="flex items-center gap-2">
            <input
              id="progress-quantity"
              type="number"
              min={0}
              value={quantityToday}
              onChange={(e) => setQuantityToday(e.target.value)}
              placeholder="0"
              className="w-full min-w-0 rounded border border-zinc-200 px-2.5 py-1.5 text-sm"
            />
            {unit && <span className="shrink-0 text-sm text-zinc-400">{unit}</span>}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="progress-labor"
            className="text-xs font-medium text-zinc-500"
          >
            Labor spent today
          </label>
          <div className="flex items-center gap-2">
            <input
              id="progress-labor"
              type="number"
              min={0}
              value={laborHeadcount}
              onChange={(e) => setLaborHeadcount(e.target.value)}
              placeholder="0"
              className="w-full min-w-0 rounded border border-zinc-200 px-2.5 py-1.5 text-sm"
            />
            <span className="shrink-0 text-sm text-zinc-400">workers</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-zinc-500">Materials consumed today</p>
        {materialRows.length > 0 && (
          <div className="flex flex-col gap-2">
            {materialRows.map((row) => {
              const material = row.materialId !== null ? materialById.get(row.materialId) : undefined;
              return (
                <div key={row.key} className="flex items-center gap-2">
                  <select
                    value={row.materialId ?? ""}
                    onChange={(e) =>
                      updateMaterialRow(row.key, {
                        materialId: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    className="min-w-0 flex-1 rounded border border-zinc-200 px-2.5 py-1.5 text-sm"
                  >
                    {materials.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.materialName}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    value={row.quantity}
                    onChange={(e) =>
                      updateMaterialRow(row.key, { quantity: e.target.value })
                    }
                    placeholder="Qty"
                    className="w-24 rounded border border-zinc-200 px-2.5 py-1.5 text-sm"
                  />
                  <span className="w-12 shrink-0 text-xs text-zinc-400">
                    {material?.unit ?? ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeMaterialRow(row.key)}
                    aria-label="Remove material"
                    className="shrink-0 cursor-pointer rounded p-1.5 text-zinc-400 transition hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {materials.length === 0 ? (
          <p className="text-xs text-zinc-400">
            No materials recorded for this project yet — add some from the
            Materials Monitoring tab first.
          </p>
        ) : (
          <button
            type="button"
            onClick={addMaterialRow}
            className="flex cursor-pointer items-center gap-1 self-start text-xs font-medium text-zinc-500 transition hover:text-zinc-800"
          >
            <Plus className="size-3.5" />
            Add material
          </button>
        )}
      </div>

      <div className="flex items-center justify-between rounded-md bg-zinc-50 px-3 py-2 text-sm">
        <span className="font-medium text-zinc-500">New percent complete</span>
        <span className="font-semibold text-zinc-900">
          {previewPercent.toFixed(2)}%
        </span>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="mt-auto flex items-center justify-end gap-3">
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
          disabled={pending}
          className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
