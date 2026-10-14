"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ModalHeaderAddon } from "@/components/ui/modal";
import type { LatestOverride, TaskProgressToday } from "@/lib/task-progress/data";
import {
  COST_COMPONENTS,
  computeDailyPlan,
  computeProgressBreakdown,
  toIsoDate,
  type CostAmounts,
  type CostComponent,
  type PlannedMaterial,
  type ProgressAnchor,
  type ScheduleStatus,
} from "@/lib/task-progress/calculate";

type ProgressActionResult = { error?: string; success?: boolean };

const SCHEDULE_STATUS_LABEL: Record<ScheduleStatus, string> = {
  ahead: "Ahead of schedule",
  on_track: "On track",
  behind: "Behind schedule",
};

const SCHEDULE_STATUS_STYLE: Record<ScheduleStatus, string> = {
  ahead: "bg-sky-50 text-sky-700",
  on_track: "bg-emerald-50 text-emerald-700",
  behind: "bg-red-50 text-red-600",
};

const COST_LABEL: Record<CostComponent, string> = {
  labor: "Labor cost",
  material: "Material cost",
  equipment: "Equipment cost",
  other: "Other cost",
};

function formatPercent(value: number | null) {
  return value === null ? "—" : `${value.toFixed(0)}%`;
}

function formatQuantity(value: number) {
  return value.toLocaleString("en-PH", { maximumFractionDigits: 2 });
}

function formatPeso(value: number) {
  return `₱${value.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

// A pre-filled value, to the centavo — blank for 0 so the "0" hint shows.
function toInput(value: number) {
  return value > 0 ? String(Math.round(value * 100) / 100) : "";
}

// Blank counts as 0; null flags anything that isn't a real, non-negative
// number.
function parseAmount(value: string): number | null {
  if (!value.trim()) return 0;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

/** One labeled input in the modal's grid — the label on the left, a
 * short running figure (e.g. "₱500 / ₱1,000") on the right. */
function Field({
  htmlFor,
  label,
  detail,
  children,
}: {
  htmlFor: string;
  label: ReactNode;
  detail?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-h-5 items-center justify-between gap-2">
        <label htmlFor={htmlFor} className="truncate text-xs font-medium text-zinc-500">
          {label}
        </label>
        {detail && (
          <span className="shrink-0 text-[11px] text-zinc-400 tabular-nums">{detail}</span>
        )}
      </div>
      {children}
    </div>
  );
}

/** A number input with a peso sign or unit inside the box. */
function AmountInput({
  id,
  value,
  onChange,
  prefix,
  unit,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  prefix?: string;
  unit?: string | null;
}) {
  return (
    <div className="flex items-center rounded-md border border-zinc-200 bg-white transition focus-within:border-zinc-400 focus-within:ring-2 focus-within:ring-zinc-200">
      {prefix && <span className="shrink-0 pl-3 text-sm text-zinc-400">{prefix}</span>}
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        className={`w-full min-w-0 bg-transparent py-2 text-sm text-zinc-700 outline-none tabular-nums ${
          prefix ? "pr-3 pl-1.5" : "px-3"
        }`}
      />
      {unit && <span className="shrink-0 pr-3 text-sm text-zinc-400">{unit}</span>}
    </div>
  );
}

/** The most recently overridden day — the one the Gantt chart's orange
 * dot marks: when, who saved it, and what was entered. Highlighted (and
 * scrolled to) when the modal was opened from a notification about it. */
function LastOverride({
  latest,
  unit,
  plannedMaterials,
  highlight,
}: {
  latest: LatestOverride;
  unit: string | null;
  plannedMaterials: PlannedMaterial[];
  highlight: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight]);
  const day =
    latest.entryDate === toIsoDate(new Date())
      ? "Today"
      : new Date(`${latest.entryDate}T00:00:00`).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
  const materials = plannedMaterials
    .map((material) => ({
      name: material.name,
      unit: material.unit,
      quantity: latest.materialUsage[material.key] ?? 0,
    }))
    .filter((material) => material.quantity > 0);

  return (
    <section
      ref={ref}
      className={`rounded-md border p-4 ${
        highlight
          ? "border-orange-300 bg-orange-50 ring-2 ring-orange-200"
          : "border-zinc-200 bg-zinc-50"
      }`}
    >
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-zinc-700">
        <span aria-hidden className="size-1.5 rounded-full bg-orange-500" />
        Last override · {day}
        {latest.savedByName && (
          <span className="font-normal text-zinc-500">by {latest.savedByName}</span>
        )}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3">
        <div className="flex justify-between gap-2">
          <dt className="text-zinc-500">Quantity</dt>
          <dd className="font-medium text-zinc-900">
            {formatQuantity(latest.quantityCompleted)}
            {unit ? ` ${unit}` : ""}
          </dd>
        </div>
        {COST_COMPONENTS.map((component) => (
          <div key={component} className="flex justify-between gap-2">
            <dt className="text-zinc-500">{COST_LABEL[component]}</dt>
            <dd className="font-medium text-zinc-900">{formatPeso(latest.costs[component])}</dd>
          </div>
        ))}
      </dl>
      {materials.length > 0 && (
        <p className="mt-2 text-xs text-zinc-500">
          Materials used:{" "}
          <span className="text-zinc-900">
            {materials
              .map(
                (material) =>
                  `${material.name} ${formatQuantity(material.quantity)}${
                    material.unit ? ` ${material.unit}` : ""
                  }`
              )
              .join(", ")}
          </span>
        </p>
      )}
    </section>
  );
}

/**
 * Daily Progress Update for one task (or task-less category), for today.
 * A day's record is what it spent on each of the task's four cost
 * components (labor, material, equipment, other), plus the quantity done
 * and materials used — and % complete is cost to date over planned cost
 * (the cost-to-cost method, see computeProgressBreakdown,
 * lib/task-progress/calculate.ts).
 *
 * Automatic progress: every input starts from today's planned share
 * (computeDailyPlan — planned ÷ working days, e.g. ₱1,000 of labor over 4
 * days → ₱250), and a past working day nobody saved counts that same
 * share on its own. Editing the inputs and saving overrides the day.
 * Reopening a day already saved starts from what was saved instead.
 */
export function ProgressTrackingModalContent({
  estimatedQuantity,
  unit,
  plannedStartDate,
  plannedEndDate,
  plannedMaterials,
  plannedCosts,
  workingDays,
  holidays,
  progressToday,
  highlightLatest = false,
  onSave,
  onClose,
}: {
  estimatedQuantity: number;
  unit: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  plannedMaterials: PlannedMaterial[];
  /** The task's own planned cost per component — what % complete is
   * measured against. */
  plannedCosts: CostAmounts;
  workingDays: readonly number[];
  holidays: readonly string[];
  progressToday: TaskProgressToday;
  /** Opened from a notification — highlight its Last override. */
  highlightLatest?: boolean;
  onSave: (input: {
    quantityCompletedToday: number;
    costs: CostAmounts;
    materialsUsed: { name: string; unit: string | null; quantity: number }[];
  }) => Promise<ProgressActionResult>;
  onClose: () => void;
}) {
  const router = useRouter();
  const savedToday = progressToday.today;
  const schedule = { plannedStartDate, plannedEndDate, workingDays, holidays };

  // Today's automatic values — where an unsaved day's inputs start.
  const [dailyPlan] = useState(() =>
    computeDailyPlan({
      ...schedule,
      plannedCosts,
      estimatedQuantity,
      plannedMaterials,
      date: new Date(),
    })
  );

  const [quantityInput, setQuantityInput] = useState(() =>
    toInput(savedToday ? savedToday.quantityCompleted : dailyPlan.quantity)
  );
  const [costInputs, setCostInputs] = useState<Record<CostComponent, string>>(() => {
    const start = savedToday ? savedToday.costs : dailyPlan.costs;
    return {
      labor: toInput(start.labor),
      material: toInput(start.material),
      equipment: toInput(start.equipment),
      other: toInput(start.other),
    };
  });
  const [materialInputs, setMaterialInputs] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const material of plannedMaterials) {
      initial[material.key] = toInput(
        savedToday
          ? (savedToday.materialUsage[material.key] ?? 0)
          : (dailyPlan.materials[material.key] ?? 0)
      );
    }
    return initial;
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const quantity = parseAmount(quantityInput);
  const costs = {
    labor: parseAmount(costInputs.labor),
    material: parseAmount(costInputs.material),
    equipment: parseAmount(costInputs.equipment),
    other: parseAmount(costInputs.other),
  };
  const materialsUsed = plannedMaterials.map((material) => ({
    key: material.key,
    name: material.name,
    unit: material.unit,
    quantity: parseAmount(materialInputs[material.key] ?? ""),
  }));

  // Saved totals with today's saved amounts swapped for what's typed now
  // — today counts as logged, so it's never also counted automatically.
  const anchor: ProgressAnchor = {
    cumulativeQuantityCompleted:
      progressToday.cumulativeQuantityCompleted -
      (savedToday?.quantityCompleted ?? 0) +
      (quantity ?? 0),
    cumulativeMaterialUsage: { ...progressToday.cumulativeMaterialUsage },
    cumulativeCosts: {
      labor: progressToday.cumulativeCosts.labor - (savedToday?.costs.labor ?? 0) + (costs.labor ?? 0),
      material:
        progressToday.cumulativeCosts.material -
        (savedToday?.costs.material ?? 0) +
        (costs.material ?? 0),
      equipment:
        progressToday.cumulativeCosts.equipment -
        (savedToday?.costs.equipment ?? 0) +
        (costs.equipment ?? 0),
      other: progressToday.cumulativeCosts.other - (savedToday?.costs.other ?? 0) + (costs.other ?? 0),
    },
    loggedDates: [...progressToday.loggedDates, toIsoDate(new Date())],
  };
  for (const material of materialsUsed) {
    anchor.cumulativeMaterialUsage[material.key] =
      (progressToday.cumulativeMaterialUsage[material.key] ?? 0) -
      (savedToday?.materialUsage[material.key] ?? 0) +
      (material.quantity ?? 0);
  }

  // Same shared function getCostEstimate calls server-side, so this
  // preview always matches what the Gantt chart shows after saving.
  const breakdown = computeProgressBreakdown({
    ...schedule,
    plannedCosts,
    estimatedQuantity,
    plannedMaterials,
    anchor,
    today: new Date(),
  });

  async function handleSave() {
    setError(null);
    if (quantity === null) {
      setError("Quantity completed must be 0 or more.");
      return;
    }
    if (COST_COMPONENTS.some((component) => costs[component] === null)) {
      setError("Costs must be 0 or more.");
      return;
    }
    if (materialsUsed.some((material) => material.quantity === null)) {
      setError("Materials used must be 0 or more.");
      return;
    }

    setPending(true);
    const result = await onSave({
      quantityCompletedToday: quantity,
      costs: {
        labor: costs.labor!,
        material: costs.material!,
        equipment: costs.equipment!,
        other: costs.other!,
      },
      materialsUsed: materialsUsed.map((material) => ({
        name: material.name,
        unit: material.unit,
        quantity: material.quantity!,
      })),
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
    <div className="flex h-full min-h-full flex-col gap-6">
      {/* Live — follows what's typed below, beside the modal's own title. */}
      {breakdown.scheduleStatus && (
        <ModalHeaderAddon>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${SCHEDULE_STATUS_STYLE[breakdown.scheduleStatus]}`}
          >
            {SCHEDULE_STATUS_LABEL[breakdown.scheduleStatus]}
          </span>
        </ModalHeaderAddon>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          htmlFor="progress-quantity"
          label="Quantity completed today"
          detail={
            estimatedQuantity > 0 ? (
              <span
                className={
                  breakdown.quantityToDate > estimatedQuantity ? "text-amber-600" : ""
                }
              >
                {formatQuantity(breakdown.quantityToDate)} / {formatQuantity(estimatedQuantity)}
              </span>
            ) : undefined
          }
        >
          <AmountInput
            id="progress-quantity"
            value={quantityInput}
            onChange={setQuantityInput}
            unit={unit}
          />
        </Field>

        {COST_COMPONENTS.map((component) => {
          const toDate = breakdown.costsToDate[component];
          const planned = plannedCosts[component];
          return (
            <Field
              key={component}
              htmlFor={`progress-${component}`}
              label={COST_LABEL[component]}
              detail={
                planned > 0 ? (
                  <span className={toDate > planned + 0.005 ? "font-semibold text-red-600" : ""}>
                    {formatPeso(toDate)} / {formatPeso(planned)}
                  </span>
                ) : undefined
              }
            >
              <AmountInput
                id={`progress-${component}`}
                value={costInputs[component]}
                onChange={(value) =>
                  setCostInputs((prev) => ({ ...prev, [component]: value }))
                }
                prefix="₱"
              />
            </Field>
          );
        })}
      </div>

      {plannedMaterials.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-zinc-600">Materials used today</p>
            {breakdown.materialsPercent !== null && (
              <span className="text-xs font-semibold text-zinc-900">
                {formatPercent(breakdown.materialsPercent)} of planned used
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {plannedMaterials.map((material, index) => {
              const used = breakdown.materialUsageToDate[material.key] ?? 0;
              const overPlan =
                material.plannedQuantity > 0 && used > material.plannedQuantity + 0.005;
              // By position — a material key can contain spaces, which an
              // id can't.
              const id = `progress-material-${index}`;
              return (
                <Field
                  key={material.key}
                  htmlFor={id}
                  label={<span title={material.name}>{material.name}</span>}
                  detail={
                    <span className={overPlan ? "font-semibold text-red-600" : ""}>
                      {formatQuantity(used)} / {formatQuantity(material.plannedQuantity)}
                    </span>
                  }
                >
                  <AmountInput
                    id={id}
                    value={materialInputs[material.key] ?? ""}
                    onChange={(value) =>
                      setMaterialInputs((prev) => ({ ...prev, [material.key]: value }))
                    }
                    unit={material.unit}
                  />
                </Field>
              );
            })}
          </div>
        </section>
      )}

      {progressToday.latest && (
        <LastOverride
          latest={progressToday.latest}
          unit={unit}
          plannedMaterials={plannedMaterials}
          highlight={highlightLatest}
        />
      )}

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
