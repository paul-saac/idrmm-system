"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TaskProgressToday } from "@/lib/task-progress/data";
import {
  computeProgressBreakdown,
  type PlannedMaterial,
} from "@/lib/task-progress/calculate";

type ProgressActionResult = { error?: string; success?: boolean };

function formatPercent(value: number | null) {
  return value === null ? "—" : `${value.toFixed(0)}%`;
}

function formatQuantity(value: number) {
  return value.toLocaleString("en-PH", { maximumFractionDigits: 2 });
}

/**
 * Progress Tracking Override for one task (or task-less category), for
 * today. Materials used (against the task's own Material Breakdown
 * lines), workers, and elapsed time each produce a component percent;
 * their blend is the task's computed progress, shown as accomplished
 * weight (task weight x percent complete). Typing an accomplished weight
 * directly overrides the blend; editing materials or workers reverts it
 * to computed, same rule Material Breakdown's own Amount cells follow.
 *
 * The override is typed in weight points but saved as a task percent
 * (typed / weight x 100), so re-weighting the task later rescales its
 * accomplished share instead of changing how complete the work is.
 */
export function ProgressTrackingModalContent({
  weight,
  plannedStartDate,
  plannedEndDate,
  plannedMaterials,
  plannedWorkerCount,
  workingDays,
  progressToday,
  onSave,
  onClose,
}: {
  weight: number;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  plannedMaterials: PlannedMaterial[];
  plannedWorkerCount: number;
  workingDays: readonly number[];
  progressToday: TaskProgressToday;
  onSave: (input: {
    laborHeadcount: number;
    materialsUsed: { name: string; unit: string | null; quantity: number }[];
    percentCompleteOverride: number | null;
  }) => Promise<ProgressActionResult>;
  onClose: () => void;
}) {
  const router = useRouter();
  const savedToday = progressToday.today;

  const [laborInput, setLaborInput] = useState(
    savedToday ? String(savedToday.laborHeadcount) : ""
  );
  const [materialInputs, setMaterialInputs] = useState<Record<string, string>>(
    () => {
      const initial: Record<string, string> = {};
      for (const material of plannedMaterials) {
        const saved = savedToday?.materialUsage[material.key];
        initial[material.key] = saved ? String(saved) : "";
      }
      return initial;
    }
  );
  const [accomplishedInput, setAccomplishedInput] = useState(
    savedToday?.percentCompleteOverride != null && weight > 0
      ? ((savedToday.percentCompleteOverride / 100) * weight).toFixed(2)
      : ""
  );
  const [accomplishedFocused, setAccomplishedFocused] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedLabor = Number(laborInput) || 0;
  const priorLabor =
    progressToday.cumulativeLaborHeadcount - (savedToday?.laborHeadcount ?? 0);

  // Every material's running total including what's typed for today —
  // today's already-saved amount is swapped out, not double-counted.
  const liveMaterialUsage: Record<string, number> = {};
  for (const material of plannedMaterials) {
    const prior =
      (progressToday.cumulativeMaterialUsage[material.key] ?? 0) -
      (savedToday?.materialUsage[material.key] ?? 0);
    liveMaterialUsage[material.key] =
      prior + (Number(materialInputs[material.key]) || 0);
  }

  const trimmedAccomplished = accomplishedInput.trim();
  const parsedAccomplished =
    trimmedAccomplished === "" ? null : Number(trimmedAccomplished);
  const overridePercent =
    weight > 0 && parsedAccomplished !== null && Number.isFinite(parsedAccomplished)
      ? (parsedAccomplished / weight) * 100
      : null;

  // Same shared function getCostEstimate calls server-side, so this
  // preview always matches what's shown on the Gantt chart after saving.
  const breakdown = computeProgressBreakdown({
    plannedStartDate,
    plannedEndDate,
    plannedMaterials,
    plannedWorkerCount,
    workingDays,
    anchor: {
      cumulativeMaterialUsage: liveMaterialUsage,
      cumulativeLaborHeadcount: priorLabor + parsedLabor,
      latestPercentCompleteOverride: overridePercent,
    },
    today: new Date(),
  });

  const accomplishedValue = ((breakdown.blendedPercent / 100) * weight).toFixed(2);

  function handleMaterialChange(key: string, value: string) {
    setMaterialInputs((prev) => ({ ...prev, [key]: value }));
    setAccomplishedInput("");
  }

  function handleLaborChange(value: string) {
    setLaborInput(value);
    setAccomplishedInput("");
  }

  async function handleSave() {
    setError(null);
    if (parsedLabor < 0) {
      setError("Workers can't be negative.");
      return;
    }
    const materialsUsed = plannedMaterials.map((material) => ({
      name: material.name,
      unit: material.unit,
      quantity: Number(materialInputs[material.key]) || 0,
    }));
    if (materialsUsed.some((material) => material.quantity < 0)) {
      setError("Material quantity used can't be negative.");
      return;
    }
    if (
      trimmedAccomplished !== "" &&
      (parsedAccomplished === null ||
        !Number.isFinite(parsedAccomplished) ||
        parsedAccomplished < 0 ||
        parsedAccomplished > weight)
    ) {
      setError(`Accomplished weight must be between 0 and ${weight.toFixed(2)}.`);
      return;
    }

    setPending(true);
    const result = await onSave({
      laborHeadcount: parsedLabor,
      materialsUsed,
      percentCompleteOverride: overridePercent,
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
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-zinc-600">Materials used today</p>
          <span className="text-xs font-semibold text-zinc-900">
            {formatPercent(breakdown.materialsPercent)}
          </span>
        </div>
        {plannedMaterials.length === 0 ? (
          <div className="rounded border border-dashed border-zinc-200 px-3 py-2 text-xs text-zinc-400">
            No materials assigned — add them in Material Breakdown to log
            usage here.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-zinc-200">
            <table className="w-full table-fixed text-left text-sm">
              <colgroup>
                <col />
                <col style={{ width: 96 }} />
                <col style={{ width: 96 }} />
                <col style={{ width: 132 }} />
              </colgroup>
              <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
                <tr>
                  <th className="border-r border-b border-zinc-200 px-3 py-2">
                    Material
                  </th>
                  <th className="border-r border-b border-zinc-200 px-3 py-2 text-right">
                    Planned
                  </th>
                  <th className="border-r border-b border-zinc-200 px-3 py-2 text-right">
                    Total used
                  </th>
                  <th className="border-b border-zinc-200 px-3 py-2 text-right">
                    Used today
                  </th>
                </tr>
              </thead>
              <tbody>
                {plannedMaterials.map((material) => {
                  const unitSuffix = material.unit ? ` ${material.unit}` : "";
                  return (
                    <tr
                      key={material.key}
                      className="border-b border-zinc-100 last:border-b-0"
                    >
                      <td
                        className="truncate border-r border-zinc-200 px-3 py-1.5 text-xs text-zinc-700"
                        title={material.name}
                      >
                        {material.name}
                      </td>
                      <td className="border-r border-zinc-200 px-3 py-1.5 text-right text-xs text-zinc-500">
                        {formatQuantity(material.plannedQuantity)}
                        {unitSuffix}
                      </td>
                      <td className="border-r border-zinc-200 px-3 py-1.5 text-right text-xs text-zinc-500">
                        {formatQuantity(liveMaterialUsage[material.key] ?? 0)}
                        {unitSuffix}
                      </td>
                      <td className="px-1.5 py-1">
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            value={materialInputs[material.key] ?? ""}
                            onChange={(e) =>
                              handleMaterialChange(material.key, e.target.value)
                            }
                            placeholder="0"
                            aria-label={`${material.name} used today`}
                            className="w-full min-w-0 rounded border border-zinc-200 px-2 py-1 text-right text-sm"
                          />
                          {material.unit && (
                            <span className="shrink-0 text-xs text-zinc-400">
                              {material.unit}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-zinc-600">Labor</p>
            <span className="text-xs font-semibold text-zinc-900">
              {formatPercent(breakdown.laborPercent)}
            </span>
          </div>
          <label
            htmlFor="progress-labor"
            className="text-xs font-medium text-zinc-500"
          >
            Workers today
          </label>
          <div className="flex items-center gap-2">
            <input
              id="progress-labor"
              type="number"
              min={0}
              value={laborInput}
              onChange={(e) => handleLaborChange(e.target.value)}
              placeholder="0"
              className="w-full min-w-0 rounded border border-zinc-200 px-2.5 py-1.5 text-sm"
            />
            <span className="shrink-0 text-sm text-zinc-400">workers</span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-zinc-600">Time</p>
            <span className="text-xs font-semibold text-zinc-900">
              {formatPercent(breakdown.timePercent)}
            </span>
          </div>
          <p className="text-xs font-medium text-zinc-500">
            Elapsed (from schedule)
          </p>
          {breakdown.totalWorkingDays !== null ? (
            <div className="rounded border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm text-zinc-600">
              {breakdown.elapsedWorkingDays} of {breakdown.totalWorkingDays} days
            </div>
          ) : (
            <div className="rounded border border-dashed border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-400">
              No planned dates yet
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5 rounded-md bg-zinc-50 px-3 py-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <label
              htmlFor="progress-accomplished"
              className="font-medium text-zinc-600"
            >
              Accomplished weight
            </label>
            {breakdown.isOverridden && (
              <>
                <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
                  manual
                </span>
                <button
                  type="button"
                  onClick={() => setAccomplishedInput("")}
                  className="cursor-pointer text-[11px] font-medium text-zinc-400 underline-offset-2 transition hover:text-zinc-700 hover:underline"
                >
                  Reset
                </button>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <input
              id="progress-accomplished"
              type="text"
              inputMode="decimal"
              disabled={weight <= 0}
              value={
                accomplishedFocused && accomplishedInput !== ""
                  ? accomplishedInput
                  : accomplishedValue
              }
              onFocus={() => setAccomplishedFocused(true)}
              onBlur={() => setAccomplishedFocused(false)}
              onChange={(e) => setAccomplishedInput(e.target.value)}
              className="w-20 rounded border border-zinc-200 bg-white px-2 py-1 text-right text-sm font-semibold text-zinc-900 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
            />
            <span className="text-zinc-400">/ {weight.toFixed(2)}</span>
          </div>
        </div>
        <div className="flex items-start justify-between gap-3 text-xs">
          <span className="text-zinc-400">
            {weight > 0
              ? "Type a value to override, or leave it following Materials, Labor, and Time."
              : "Assign this task a weight in the Gantt chart's Weight column first."}
          </span>
          <span className="shrink-0 font-semibold text-zinc-700">
            {breakdown.blendedPercent.toFixed(2)}% complete
          </span>
        </div>
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
