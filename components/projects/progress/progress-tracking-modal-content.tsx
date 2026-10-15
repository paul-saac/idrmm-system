"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, X } from "lucide-react";
import { ModalHeaderAddon } from "@/components/ui/modal";
import type { LatestOverride, TaskProgressToday } from "@/lib/task-progress/data";
import type { Worker } from "@/lib/workers/data";
import { formatHours, weekdayIndex } from "@/lib/workers/schedule";
import {
  COST_COMPONENTS,
  ZERO_COSTS,
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
 * short figure (e.g. total so far over planned, "₱500 / ₱1,000") on the
 * right. */
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

// Hours typed for one person — blank counts as 0 (absent); null flags
// anything that isn't 0–24.
function parseHours(value: string): number | null {
  if (!value.trim()) return 0;
  const hours = Number(value);
  return Number.isFinite(hours) && hours >= 0 && hours <= 24 ? hours : null;
}

/** "Who worked today": the task's assigned crew (and anyone added who
 * helped), each with the hours they worked — starting from today's hours
 * in their own Working Days (0 on a day off) — at their own Default Rate,
 * which is what the day's labor cost comes to. Subcontractors aren't
 * counted (they're billed per contract, under Other cost). */
function Attendance({
  rows,
  team,
  hours,
  onHours,
  onAdd,
  onRemove,
  laborToday,
  laborDetail,
  subcontractorsAssigned,
}: {
  rows: { worker: Worker; helper: boolean }[];
  /** Everyone who could be added as a helper. */
  team: Worker[];
  /** Hours typed per person, by worker id. */
  hours: Record<number, string>;
  onHours: (workerId: number, value: string) => void;
  onAdd: (workerId: number) => void;
  onRemove: (workerId: number) => void;
  laborToday: number;
  laborDetail?: ReactNode;
  subcontractorsAssigned: boolean;
}) {
  const today = weekdayIndex();
  const listed = new Set(rows.map((row) => row.worker.id));
  const addable = team.filter((worker) => !listed.has(worker.id));
  const totalHours = rows.reduce((sum, row) => sum + (parseHours(hours[row.worker.id] ?? "") ?? 0), 0);
  const missingRate = rows.some(
    (row) => (parseHours(hours[row.worker.id] ?? "") ?? 0) > 0 && row.worker.hourlyRate === null
  );

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-zinc-600">Who worked today</p>
        <div className="flex items-center gap-3">
          {laborDetail && (
            <span className="text-[11px] text-zinc-400 tabular-nums">{laborDetail}</span>
          )}
          <span className="text-xs text-zinc-500 tabular-nums">{formatHours(totalHours)}</span>
          <span className="text-sm font-semibold text-zinc-900 tabular-nums">
            Labor {formatPeso(laborToday)}
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-200 px-3 py-4 text-center text-sm text-zinc-400">
          Nobody&apos;s assigned yet — add whoever worked today.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200">
          {rows.map(({ worker, helper }) => {
            const worked = parseHours(hours[worker.id] ?? "");
            const dayOff = (worker.workHours[today] ?? 0) === 0;
            return (
              <li key={worker.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-zinc-900">
                    {worker.fullName}
                    {helper && <span className="ml-1.5 text-xs text-zinc-400">Helper</span>}
                    {dayOff && <span className="ml-1.5 text-xs text-zinc-400">Day off</span>}
                  </p>
                  {worker.title && <p className="truncate text-xs text-zinc-400">{worker.title}</p>}
                </div>
                <div
                  className={`flex w-24 shrink-0 items-center rounded-md border bg-white transition focus-within:ring-2 focus-within:ring-zinc-200 ${
                    worked === null ? "border-red-300" : "border-zinc-200 focus-within:border-zinc-400"
                  }`}
                >
                  <input
                    type="text"
                    inputMode="decimal"
                    value={hours[worker.id] ?? ""}
                    onChange={(e) => onHours(worker.id, e.target.value)}
                    placeholder="0"
                    aria-label={`Hours ${worker.fullName} worked today`}
                    className="w-full min-w-0 bg-transparent py-1.5 pl-2.5 text-right text-sm text-zinc-700 outline-none tabular-nums"
                  />
                  <span className="shrink-0 pr-2.5 pl-1 text-xs text-zinc-400">hrs</span>
                </div>
                <span className="w-20 shrink-0 text-right text-sm tabular-nums">
                  {worker.hourlyRate === null ? (
                    <span className="text-xs text-amber-600">No rate</span>
                  ) : (
                    <span className={(worked ?? 0) > 0 ? "text-zinc-900" : "text-zinc-300"}>
                      {formatPeso(worker.hourlyRate * (worked ?? 0))}
                    </span>
                  )}
                </span>
                {helper && (
                  <button
                    type="button"
                    onClick={() => onRemove(worker.id)}
                    title="Take off the list"
                    aria-label={`Take ${worker.fullName} off the list`}
                    className="shrink-0 cursor-pointer rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {addable.length > 0 && (
        <div className="relative w-fit">
          {/* Picking someone adds them as a helper, at today's hours. */}
          <select
            value=""
            onChange={(e) => onAdd(Number(e.target.value))}
            aria-label="Add someone who helped"
            className="cursor-pointer appearance-none rounded-md border border-zinc-200 bg-white py-1.5 pr-8 pl-3 text-sm text-zinc-700 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          >
            <option value="" disabled>
              + Add someone who helped
            </option>
            {addable.map((worker) => (
              <option key={worker.id} value={worker.id}>
                {worker.title ? `${worker.fullName} — ${worker.title}` : worker.fullName}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-zinc-400" />
        </div>
      )}

      {missingRate && (
        <p className="text-xs text-amber-600">
          Someone here has no default rate yet, so they count as ₱0 — set it on the Team page.
        </p>
      )}
      {subcontractorsAssigned && (
        <p className="text-xs text-zinc-500">
          Subcontractors aren&apos;t counted here — add their billing under Other cost.
        </p>
      )}
    </section>
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
 * and materials used — and % complete is quantity done to date over
 * planned quantity, else cost to date over planned cost (see
 * computeProgressBreakdown, lib/task-progress/calculate.ts).
 *
 * Automatic progress: a past working day nobody saved counts its planned
 * share on its own (computeDailyPlan — planned ÷ working days, e.g.
 * ₱1,000 of material over 4 days → ₱250); today only once it's over. So
 * an unsaved day's inputs start blank, and saving records just what was
 * typed. Reopening a day already saved starts from what was saved.
 *
 * Labor isn't typed: it's who worked today (Attendance), the hours each
 * one put in at their own Default Rate — the assigned crew, at today's
 * hours in their own Working Days, to start — and the server prices it
 * the same way when it's saved.
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
  crew,
  team,
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
  /** Who's assigned to this task (or phase) — today's attendance starts
   * from them. */
  crew: Worker[];
  /** The whole Team — anyone else who helped can be added. */
  team: Worker[];
  /** Opened from a notification — highlight its Last override. */
  highlightLatest?: boolean;
  onSave: (input: {
    quantityCompletedToday: number;
    costs: CostAmounts;
    materialsUsed: { name: string; unit: string | null; quantity: number }[];
    attendance: { workerId: number; hours: number }[];
  }) => Promise<ProgressActionResult>;
  onClose: () => void;
}) {
  const router = useRouter();
  const savedToday = progressToday.today;
  const schedule = { plannedStartDate, plannedEndDate, workingDays, holidays };

  // An unsaved day starts blank (0): today counts automatically only once
  // it's over, so nothing's recorded for it but what's typed here.
  const [quantityInput, setQuantityInput] = useState(() =>
    toInput(savedToday ? savedToday.quantityCompleted : 0)
  );
  const [costInputs, setCostInputs] = useState<Record<CostComponent, string>>(() => {
    const start = savedToday ? savedToday.costs : ZERO_COSTS;
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
      initial[material.key] = toInput(savedToday?.materialUsage[material.key] ?? 0);
    }
    return initial;
  });
  // Today's attendance: what's saved for today, else the assigned crew
  // (employees — subcontractors are billed per contract) at today's hours
  // in their own Working Days.
  // Only skilled workers are paid by the hour (management and engineers
  // are salaried; subcontractors, per contract).
  const crewEmployees = crew.filter(
    (worker) => worker.employmentType !== "subcontractor" && worker.category === "skilled"
  );
  const [hours, setHours] = useState<Record<number, string>>(() => {
    const today = weekdayIndex();
    const initial: Record<number, string> = {};
    const saved = progressToday.todayAttendance;
    // A day saved before attendance existed (typed labor, nobody listed)
    // starts like a new day.
    const fresh = !savedToday || (saved.length === 0 && savedToday.costs.labor > 0);
    for (const worker of crewEmployees) {
      initial[worker.id] = fresh ? toInput(worker.workHours[today] ?? 0) : "";
    }
    if (!fresh) {
      for (const mark of saved) {
        if (mark.workerId !== null) initial[mark.workerId] = toInput(mark.hours);
      }
    }
    return initial;
  });
  const teamById = new Map(team.map((worker) => [worker.id, worker]));
  const crewIds = new Set(crewEmployees.map((worker) => worker.id));
  const attendanceRows = [
    ...crewEmployees.map((worker) => ({ worker, helper: false })),
    ...Object.keys(hours)
      .map(Number)
      .filter((id) => !crewIds.has(id))
      .flatMap((id) => {
        const worker = teamById.get(id);
        return worker ? [{ worker, helper: true }] : [];
      })
      .sort((a, b) => a.worker.fullName.localeCompare(b.worker.fullName)),
  ];
  const hoursWorked = attendanceRows.map(({ worker }) => ({
    workerId: worker.id,
    hours: parseHours(hours[worker.id] ?? ""),
  }));
  const laborToday = attendanceRows.reduce(
    (sum, { worker }, index) => sum + (worker.hourlyRate ?? 0) * (hoursWorked[index].hours ?? 0),
    0
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const quantity = parseAmount(quantityInput);
  const costs = {
    labor: laborToday as number | null,
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

  // Up to yesterday — saved earlier days, and each past day with no
  // update at its planned share — without today's log (saved or typed).
  const priorMaterialUsage: Record<string, number> = { ...progressToday.cumulativeMaterialUsage };
  for (const [key, used] of Object.entries(savedToday?.materialUsage ?? {})) {
    priorMaterialUsage[key] = (priorMaterialUsage[key] ?? 0) - used;
  }
  const beforeToday = computeProgressBreakdown({
    ...schedule,
    plannedCosts,
    estimatedQuantity,
    plannedMaterials,
    anchor: {
      cumulativeQuantityCompleted:
        progressToday.cumulativeQuantityCompleted - (savedToday?.quantityCompleted ?? 0),
      cumulativeMaterialUsage: priorMaterialUsage,
      cumulativeCosts: {
        labor: progressToday.cumulativeCosts.labor - (savedToday?.costs.labor ?? 0),
        material: progressToday.cumulativeCosts.material - (savedToday?.costs.material ?? 0),
        equipment: progressToday.cumulativeCosts.equipment - (savedToday?.costs.equipment ?? 0),
        other: progressToday.cumulativeCosts.other - (savedToday?.costs.other ?? 0),
      },
      loggedDates: progressToday.loggedDates,
    },
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
    if (hoursWorked.some((entry) => entry.hours === null)) {
      setError("Hours worked must be between 0 and 24.");
      return;
    }

    setPending(true);
    const result = await onSave({
      quantityCompletedToday: quantity,
      costs: {
        labor: laborToday,
        material: costs.material!,
        equipment: costs.equipment!,
        other: costs.other!,
      },
      attendance: hoursWorked
        .filter((entry) => (entry.hours ?? 0) > 0)
        .map((entry) => ({ workerId: entry.workerId, hours: entry.hours! })),
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
      {/* What's counted up to yesterday — saved earlier days, and each
          past day with no update at its planned share — before today's
          log below adds to it (the fields' totals include today). */}
      <section className="rounded-md border border-sky-200 bg-sky-50 p-4">
        <p className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs font-semibold text-zinc-700">
          <span className="flex items-center gap-2">
            Up to yesterday
            {/* Days with no update count their planned share (automatic
                progress) — so this is partly the plan, not only what's
                been logged. */}
            {beforeToday.automaticDays > 0 && (
              <span
                title="Days with no update count their planned share (automatic progress)."
                className="rounded-sm bg-white px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 ring-1 ring-sky-200"
              >
                Planned
              </span>
            )}
          </span>
          <span className="tabular-nums">{beforeToday.percentComplete.toFixed(2)}% complete</span>
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3">
          <div className="flex justify-between gap-2">
            <dt className="text-zinc-500">Quantity</dt>
            <dd className="font-medium text-zinc-900">
              {formatQuantity(beforeToday.quantityToDate)}
              {unit ? ` ${unit}` : ""}
            </dd>
          </div>
          {COST_COMPONENTS.map((component) => (
            <div key={component} className="flex justify-between gap-2">
              <dt className="text-zinc-500">{COST_LABEL[component]}</dt>
              <dd className="font-medium text-zinc-900">
                {formatPeso(beforeToday.costsToDate[component])}
              </dd>
            </div>
          ))}
        </dl>
        {beforeToday.automaticDays > 0 && (
          <p className="mt-2 text-xs text-zinc-500">
            Includes {beforeToday.automaticDays} past{" "}
            {beforeToday.automaticDays === 1 ? "day" : "days"} with no update, counted as
            planned.
          </p>
        )}
      </section>
      {/* Edge to edge: -mx-6 takes back the modal body's own px-6. */}
      <div aria-hidden="true" className="-mx-6 border-t border-zinc-200" />
      {/* Everything below is today's own record — an override of today,
          not the running total above. */}
      <div className="-mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-zinc-900">
          Today&apos;s log ·{" "}
          {new Date().toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          })}
        </h3>
        <p className="text-xs text-zinc-400">Saving records it as today&apos;s override</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          htmlFor="progress-quantity"
          label="Quantity completed today"
          // The total with today (Up to yesterday plus what's typed) over
          // planned, live; amber once it's past the plan.
          detail={
            estimatedQuantity > 0 ? (
              <span
                title="Total with today / planned"
                className={
                  breakdown.quantityToDate > estimatedQuantity ? "text-amber-600" : ""
                }
              >
                {formatQuantity(breakdown.quantityToDate)} / {formatQuantity(estimatedQuantity)}
                {unit ? ` ${unit}` : ""}
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

        {/* Labor's its own section below — who worked, not a typed amount. */}
        {COST_COMPONENTS.filter((component) => component !== "labor").map((component) => {
          const toDate = breakdown.costsToDate[component];
          const planned = plannedCosts[component];
          return (
            <Field
              key={component}
              htmlFor={`progress-${component}`}
              label={COST_LABEL[component]}
              // The total with today over planned — red once it's over
              // the plan.
              detail={
                planned > 0 ? (
                  <span
                    title="Total with today / planned"
                    className={toDate > planned + 0.005 ? "font-semibold text-red-600" : ""}
                  >
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

      <Attendance
        rows={attendanceRows}
        team={team.filter(
          (worker) => worker.employmentType !== "subcontractor" && worker.category === "skilled"
        )}
        hours={hours}
        onHours={(workerId, value) => setHours((prev) => ({ ...prev, [workerId]: value }))}
        onAdd={(workerId) =>
          setHours((prev) => ({
            ...prev,
            // Their hours for today — a full 8 when it's their day off.
            [workerId]: toInput(teamById.get(workerId)?.workHours[weekdayIndex()] || 8),
          }))
        }
        onRemove={(workerId) =>
          setHours((prev) => {
            const next = { ...prev };
            delete next[workerId];
            return next;
          })
        }
        laborToday={laborToday}
        laborDetail={
          plannedCosts.labor > 0 ? (
            // The total with today over planned, like the fields above;
            // red once it's over the plan.
            <span
              title="Total with today / planned"
              className={
                breakdown.costsToDate.labor > plannedCosts.labor + 0.005
                  ? "font-semibold text-red-600"
                  : ""
              }
            >
              {formatPeso(breakdown.costsToDate.labor)} / {formatPeso(plannedCosts.labor)}
            </span>
          ) : undefined
        }
        subcontractorsAssigned={crew.some((worker) => worker.employmentType === "subcontractor")}
      />

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
