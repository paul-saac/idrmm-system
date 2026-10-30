"use client";

import { EmptyState } from "@/components/ui/empty-state";
import Image from "next/image";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  FileDown,
  HistoryIcon,
  Loader2,
  Flag,
  Package,
  Paperclip,
  PanelRight,
  Plus,
  Receipt,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { Modal, ModalFooter, ModalHeaderActions, ModalHeaderAddon } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InitialsAvatar } from "@/components/ui/list-table";
import { MaterialStockPickerModal } from "@/components/projects/materials/material-stock-picker-modal";
import { WorkerPickerModal } from "./worker-picker-modal";
import { IncidentReportPanel } from "./incident-report-panel";
import { IncidentDetailModal } from "./incident-detail-modal";
import type { IncidentContext } from "@/lib/incidents/model";
import { INCIDENT_SEVERITIES, INCIDENT_TYPES, type Incident } from "@/lib/incidents/model";
import { listTodayIncidents } from "@/lib/incidents/actions";
import { loadMaterialPurchases } from "@/lib/materials/purchase-actions";
import {
  computeMaterialStocks,
  type MaterialStockItem,
} from "@/lib/materials/purchases-model";
import type { LatestOverride, TaskProgressToday } from "@/lib/task-progress/data";
import type { OverrideLog } from "@/lib/progress-logs/types";
import { downloadDailyLogPdf } from "@/lib/progress-logs/daily-log-pdf";
import type { Worker } from "@/lib/workers/data";
import { formatHours, weekdayIndex } from "@/lib/workers/schedule";
import {
  COST_COMPONENTS,
  computeProgressBreakdown,
  itemizedMaterialCost,
  itemizedOtherCost,
  materialKey,
  otherCostKey,
  toIsoDate,
  unplannedMaterialCost,
  ZERO_COSTS,
  type CostAmounts,
  type CostComponent,
  type PlannedMaterial,
  type PlannedOtherCost,
  type ProgressAnchor,
  type ScheduleStatus,
  type UnplannedMaterial,
  type UnplannedOtherCost,
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

const MATERIAL_COLUMNS = "grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-3 px-4";

// A material not on the task's own lines: what it is, its unit, how
// much, at what unit cost, what that comes to, and its remove button.
const UNPLANNED_COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_5rem_6.5rem_2.25rem] items-center gap-2 px-4";

const OTHER_COST_COLUMNS = "grid grid-cols-[minmax(0,1fr)_9rem] items-center gap-3 px-4";
const UNPLANNED_OTHER_COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_9rem_2.25rem] items-center gap-2 px-4";

const CELL_INPUT =
  "h-[34px] w-full min-w-0 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-700 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200";

/** One typed row of a material used that isn't on the task's own lines. */
type UnplannedRow = { id: number; name: string; unit: string; quantity: string; unitCost: string };
type UnplannedOtherRow = { id: number; name: string; amount: string };

const COST_LABEL: Record<CostComponent, string> = {
  labor: "Labor cost",
  material: "Material cost",
  equipment: "Equipment cost",
  other: "Other cost",
};

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

/** One labeled input in the modal's grid — its label above, and under it
 * a short figure (e.g. the total with today over planned, "₱500 / ₱1,000
 * planned"). */
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
      <label htmlFor={htmlFor} className="truncate text-sm font-medium text-zinc-800">
        {label}
      </label>
      {children}
      {detail && <p className="text-xs text-zinc-500 tabular-nums">{detail}</p>}
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
  compact = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  prefix?: string;
  unit?: string | null;
  /** A table cell's size — the same as Who worked today's hours box. */
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center rounded-md border border-zinc-200 bg-white transition focus-within:border-zinc-400 focus-within:ring-2 focus-within:ring-zinc-200 ${compact ? "h-[34px]" : ""}`}>
      {prefix && <span className="shrink-0 pl-3 text-sm text-zinc-400">{prefix}</span>}
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        className={`w-full min-w-0 bg-transparent text-sm text-zinc-700 outline-none tabular-nums ${
          compact ? "py-1.5 pl-2.5" : prefix ? "py-2 pr-3 pl-1.5" : "px-3 py-2"
        }`}
      />
      {unit && (
        <span
          className={`shrink-0 text-zinc-400 ${compact ? "pr-2.5 pl-1 text-xs" : "pr-3 text-sm"}`}
        >
          {unit}
        </span>
      )}
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

/** Paid by the hour: skilled employees (management and engineers are
 * salaried; subcontractors are billed per contract, under Other cost). */
function paidHourly(worker: Worker) {
  return worker.employmentType !== "subcontractor" && worker.category === "skilled";
}

// Team member | Rate | Hours | Cost — shared by the header and each row.
const LABOR_COLUMNS = "grid grid-cols-[minmax(0,1fr)_6rem_7rem_7rem] items-center gap-3 px-4";

/** "Labor today": whoever's assigned to the task (and anyone added who
 * helped), each with the actual hours entered at their Default Rate. The
 * day's labor cost is their total; the server prices it the same way on save. */
function LaborToday({
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
  /** Everyone paid hourly who could be added as a helper. */
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const listed = new Set(rows.map((row) => row.worker.id));
  const addable = team.filter((worker) => !listed.has(worker.id));
  const missingRate = rows.some(
    (row) => (parseHours(hours[row.worker.id] ?? "") ?? 0) > 0 && row.worker.hourlyRate === null
  );

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold text-zinc-900">Labor costs</h3>
        <span className="text-base font-semibold text-zinc-900 tabular-nums">
          Labor {formatPeso(laborToday)}
        </span>
      </div>

      {rows.length > 0 && (
        <div className="overflow-hidden rounded-md border border-zinc-200 bg-white">
          <div
            className={`${LABOR_COLUMNS} border-b border-zinc-200 bg-zinc-50 py-2 text-xs font-medium text-zinc-500`}
          >
            <span>Worker</span>
            <span>Rate</span>
            <span>Hours</span>
            <span>Cost</span>
          </div>
          <ul className="divide-y divide-zinc-100">
            {rows.map(({ worker, helper }) => {
              const worked = parseHours(hours[worker.id] ?? "");
              const dayOff = (worker.workHours[today] ?? 0) === 0;
              return (
                <li key={worker.id} className={`${LABOR_COLUMNS} py-2.5 text-sm`}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <InitialsAvatar name={worker.fullName} />
                    <div className="min-w-0">
                      <p className="truncate text-zinc-900" title={worker.fullName}>
                        {worker.fullName}
                        {helper && <span className="ml-1.5 text-xs text-zinc-400">Helper</span>}
                        {dayOff && <span className="ml-1.5 text-xs text-zinc-400">Day off</span>}
                      </p>
                      {worker.title && (
                        <p className="truncate text-xs text-zinc-500">{worker.title}</p>
                      )}
                    </div>
                    {helper && (
                      <button
                        type="button"
                        onClick={() => onRemove(worker.id)}
                        title="Remove"
                        aria-label={`Remove ${worker.fullName}`}
                        className="shrink-0 cursor-pointer rounded p-0.5 text-zinc-400 transition hover:bg-red-50 hover:text-red-600"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>
                  <span className="truncate text-xs text-zinc-500 tabular-nums">
                    {worker.hourlyRate === null ? (
                      <span className="text-amber-600">No rate</span>
                    ) : (
                      `${formatPeso(worker.hourlyRate)}/hr`
                    )}
                  </span>
                  <div
                    className={`flex items-center rounded-md border bg-white transition focus-within:ring-2 focus-within:ring-zinc-200 ${
                      worked === null ? "border-red-300" : "border-zinc-200 focus-within:border-zinc-400"
                    }`}
                  >
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={hours[worker.id] ?? ""}
                      onChange={(e) => onHours(worker.id, e.target.value)}
                      placeholder="0"
                      aria-label={`Hours ${worker.fullName} worked today`}
                      className="w-full min-w-0 bg-transparent py-1.5 pl-2.5 text-sm text-zinc-700 outline-none tabular-nums"
                    />
                    <span className="shrink-0 pr-2.5 pl-1 text-xs text-zinc-400">hrs</span>
                  </div>
                  {/* Worked out, not typed — a grayed, read-only box. */}
                  <span
                    aria-label={`${worker.fullName}'s cost today`}
                    className="flex items-center rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm tabular-nums"
                  >
                    <span className={(worked ?? 0) > 0 ? "text-zinc-600" : "text-zinc-400"}>
                      {formatPeso((worker.hourlyRate ?? 0) * (worked ?? 0))}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {addable.length > 0 ? (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            aria-label="Add workforce"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded py-1 px-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-900"
          >
            <Plus aria-hidden className="size-4 text-zinc-700" />
            <span>Add</span>
          </button>
        ) : (
          <span />
        )}
        {laborDetail && <span className="text-xs text-zinc-500 tabular-nums">{laborDetail}</span>}
      </div>

      <WorkerPickerModal
        open={pickerOpen}
        workers={addable}
        onSelect={(worker) => {
          onAdd(worker.id);
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />

      {missingRate && (
        <p className="text-xs text-amber-600">
          Someone here has no hourly rate yet, so they count as ₱0 — set it on the Team page.
        </p>
      )}
      {subcontractorsAssigned && (
        <p className="text-xs text-zinc-500">
          Subcontractors aren&apos;t counted by the hour — add their billing under Other cost.
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
  onDelete,
}: {
  latest: LatestOverride;
  unit: string | null;
  plannedMaterials: PlannedMaterial[];
  highlight: boolean;
  /** Admins and super admins only — removes this override (asks first). */
  onDelete?: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (highlight && !ref.current?.closest("[inert]")) {
      ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
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
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete this override"
            title="Delete this override"
            className="ml-auto cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
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

function formatDay(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "Oct 16, 2026, 3:42 PM" — in the viewer's own time zone. */
function formatDateTime(timestamp: string) {
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function deleteOverrideMessage(entryDate: string) {
  const update =
    entryDate === toIsoDate(new Date()) ? "Today's update" : `The ${formatDay(entryDate)} update`;
  return `${update} will be removed, with everything logged on it, and taken off the override history. That day goes back to counting its planned share automatically.`;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// How many of the newest history entries show before "Show all".
const HISTORY_PREVIEW = 5;

// The history cards' short labels — they sit two to a row in a narrow
// column.
const HISTORY_COST_LABEL: Record<CostComponent, string> = {
  labor: "Labor",
  material: "Material",
  equipment: "Equipment",
  other: "Other",
};

const HISTORY_COST_ORDER: CostComponent[] = ["material", "labor", "other", "equipment"];
const EMPTY_INCIDENTS: Incident[] = [];

/** One override in full, under its opened card — who worked (their hours
 * and cost then), what was used, and the day's total, for review. */
function OverrideLogDetails({ log }: { log: OverrideLog }) {
  const sections: { title: string; empty: string; rows: [string, string][] }[] = [
    // Only for a day labor was logged as hours.
    ...((log.attendance ?? []).length > 0
      ? [
          {
            title: "Labor",
            empty: "",
            rows: (log.attendance ?? []).map((worker): [string, string] => [
              `${worker.name} · ${formatHours(worker.hours)}`,
              formatPeso(worker.hours * worker.rate),
            ]),
          },
        ]
      : []),
    {
      title: "Materials used",
      empty: "None logged",
      rows: log.materialsUsed.map((material): [string, string] => {
        const amount = `${formatQuantity(material.quantity)}${material.unit ? ` ${material.unit}` : ""}`;
        // One not on the task's own lines, with what it came to at its
        // own unit cost.
        return material.unitCost === null || material.unitCost === undefined
          ? [material.name, amount]
          : [
              `${material.name} (unplanned)`,
              `${amount} · ${formatPeso(material.quantity * material.unitCost)}`,
            ];
      }),
    },
    ...((log.equipmentCosts ?? []).length > 0
      ? [
          {
            title: "Equipment costs",
            empty: "",
            rows: (log.equipmentCosts ?? []).map((item): [string, string] => [
              item.unplanned ? `${item.name} (unplanned)` : item.name,
              formatPeso(item.amount),
            ]),
          },
        ]
      : []),
    ...((log.otherCosts ?? []).length > 0
      ? [
          {
            title: "Other costs",
            empty: "",
            rows: (log.otherCosts ?? []).map((item): [string, string] => [
              item.unplanned ? `${item.name} (unplanned)` : item.name,
              formatPeso(item.amount),
            ]),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-3 text-xs">
      {sections.map((section) => (
        <section key={section.title} className="overflow-hidden rounded border border-zinc-200">
          <h4 className="bg-zinc-100 px-3 py-2 font-semibold text-zinc-800">{section.title}</h4>
          {section.title === "Labor" ? (
            <table className="w-full text-left">
              <thead className="border-b border-zinc-100 text-zinc-500"><tr><th className="px-3 py-2 font-medium">Worker</th><th className="px-3 py-2 text-right font-medium">Hours worked</th><th className="px-3 py-2 text-right font-medium">Amount</th></tr></thead>
              <tbody className="divide-y divide-zinc-100">{log.attendance.map((worker, index) => <tr key={index}><td className="px-3 py-2 text-zinc-600">{worker.name}</td><td className="px-3 py-2 text-right tabular-nums">{formatHours(worker.hours)}</td><td className="px-3 py-2 text-right tabular-nums">{formatPeso(worker.hours * worker.rate)}</td></tr>)}</tbody>
            </table>
          ) : section.rows.length === 0 ? (
            <p className="px-3 py-2 text-zinc-400">{section.empty}</p>
          ) : (
            <div>
            <div className="flex justify-between border-b border-zinc-100 px-3 py-2 text-zinc-500"><span>Description</span><span>{section.title === "Materials used" ? "Quantity / cost" : "Amount"}</span></div>
            <ul className="divide-y divide-zinc-100">
              {section.rows.map(([label, value], index) => (
                <li key={index} className="flex justify-between gap-3 px-3 py-2">
                  <span className="min-w-0 truncate text-zinc-600" title={label}>
                    {label}
                  </span>
                  <span className="shrink-0 text-zinc-900 tabular-nums">{value}</span>
                </li>
              ))}
            </ul>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

type BreakdownSection = {
  title: string;
  empty: string;
  rows: [string, string][];
};

/** Expandable breakdown inside the Planned and Actual summary containers. */
function StandingBreakdownDetails({
  sections,
}: {
  sections: BreakdownSection[];
}) {
  return (
    <div className="flex flex-col gap-3 text-xs">
      {sections.map((section) => (
        <div key={section.title} className="flex flex-col gap-1">
          <p className="font-medium text-zinc-700">{section.title}</p>
          <div className="py-0.5">
            {section.rows.length === 0 ? (
              <p className="text-zinc-400">{section.empty}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {section.rows.map(([label, value], index) => (
                  <li key={index} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate text-zinc-600" title={label}>
                      {label}
                    </span>
                    <span className="shrink-0 text-zinc-900 tabular-nums">{value}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The history column before anything is saved. */
function EmptyHistory() {
  return (
    <div className="flex flex-col items-center px-2 pt-6 pb-2 text-center">
      <p className="text-sm font-semibold text-zinc-700">No logs yet</p>
      <p className="mt-1 max-w-60 text-xs text-zinc-500">
        Each saved daily log shows up here, with who saved it and when.
      </p>
    </div>
  );
}

/** The history column's heading — over the timeline, or what's there
 * instead before anything's saved. */
function HistoryHeading() {
  return (
    <div className="-mx-6 border-b border-zinc-200 px-6 pb-3">
      <h3 className="flex items-center gap-2 text-base font-semibold text-zinc-900">
        <HistoryIcon aria-hidden className="size-4 text-zinc-400" />
        Log history
      </h3>
    </div>
  );
}

/**
 * The log history — every save of this task's (or phase's) Daily
 * Progress Updates, newest first: who, exactly when, and what was
 * entered. Deleted overrides aren't in it (see listOverrideLogs). The
 * version each day counts now (its newest save, while the day still has
 * its update) gets the green check — and is the one an admin can delete.
 * The newest entry is highlighted (and scrolled to) when the window was
 * opened from a notification.
 */
function OverrideHistory({
  logs,
  loggedDates,
  unit,
  highlightLatest,
  highlightEntryDate,
  onDelete,
  projectId,
  projectName,
  incidentContext,
  currentIncidents,
}: {
  logs: OverrideLog[];
  /** Days that still have a saved update. */
  loggedDates: readonly string[];
  unit: string | null;
  highlightLatest: boolean;
  highlightEntryDate?: string;
  onDelete?: (entryDate: string) => void;
  projectId?: number;
  projectName: string;
  incidentContext?: IncidentContext;
  currentIncidents: Incident[];
}) {
  // An actual progress entry is unique per item and day. The append-only
  // history can contain multiple re-saves for that day, so choose its
  // newest matching save.
  const targetIndex = highlightEntryDate
    ? logs.findIndex((log) => log.entryDate === highlightEntryDate)
    : highlightLatest
      ? 0
      : -1;
  const targetLog = targetIndex >= 0 ? logs[targetIndex] : null;
  const targetLogId = targetLog?.id ?? null;
  const targetNeedsReveal = targetIndex >= HISTORY_PREVIEW;
  const [showAll, setShowAll] = useState(false);
  const [selectedLogId, setSelectedLogId] = useState<number | null>(null);
  const [historyIncidents, setHistoryIncidents] = useState<Record<string, Incident[]>>({});
  const historyDates = [...new Set(logs.map(log => log.entryDate))].sort().join(",");
  const historyContextKind = incidentContext?.kind;
  const historyContextId = incidentContext?.id;
  useEffect(() => {
    if (!projectId || !historyContextKind || !historyContextId || !historyDates) return;
    let cancelled = false;
    Promise.all(historyDates.split(",").map(async date => {
      const result = await listTodayIncidents(projectId, { kind: historyContextKind, id: historyContextId }, date);
      return [date, result.items] as const;
    })).then(entries => { if (!cancelled) setHistoryIncidents(Object.fromEntries(entries)); }).catch(() => { /* Opening a record retries with a visible error if needed. */ });
    return () => { cancelled = true; };
  }, [projectId, historyContextKind, historyContextId, historyDates, currentIncidents]);
  const [highlightedId, setHighlightedId] = useState<number | null>(targetLogId);
  const targetRef = useRef<HTMLLIElement>(null);
  useLayoutEffect(() => {
    if (targetLogId === null || targetRef.current?.closest("[inert]")) return;
    targetRef.current?.scrollIntoView({ block: "center", behavior: "instant" });
  }, [targetLogId]);
  useEffect(() => {
    if (targetLogId === null) return;
    const timeout = window.setTimeout(() => setHighlightedId(null), 2500);
    return () => window.clearTimeout(timeout);
  }, [targetLogId]);

  const logged = new Set(loggedDates);
  const seenDays = new Set<string>();
  const currentIds = new Set<number>();
  for (const log of logs) {
    if (seenDays.has(log.entryDate)) continue;
    seenDays.add(log.entryDate);
    if (log.action === "saved" && logged.has(log.entryDate)) currentIds.add(log.id);
  }
  const shown = showAll || targetNeedsReveal ? logs : logs.slice(0, HISTORY_PREVIEW);
  const selectedLog = selectedLogId === null ? null : logs.find((log) => log.id === selectedLogId) ?? null;

  return (
    <section className="flex flex-col gap-5">
      <HistoryHeading />
      {/* A timeline, newest on top: a marker per save on a line down to
          the next — green for the one that counts now, gray before it. */}
      <ol className="flex flex-col">
        {shown.map((log, index) => {
          const current = currentIds.has(log.id);
          const highlighted = highlightedId === log.id;
          const last = index === shown.length - 1;
          return (
            <li
              key={log.id}
              ref={log.id === targetLogId ? targetRef : undefined}
              className={`relative flex gap-3 ${last ? "" : "pb-5"}`}
            >
              {/* From this marker's bottom edge (its mt-1 + 16px) to the
                  next one's top (-bottom-1 reaches past this item into the
                  next one's mt-1) — one unbroken line between them. */}
              {!last && (
                <span
                  aria-hidden
                  className="absolute top-5 -bottom-1 left-2 w-px -translate-x-1/2 bg-zinc-300"
                />
              )}
              {/* The circle's CSS (perfectly round — an SVG circle filling
                  its own box gets its edges trimmed), the check an SVG the
                  same size on top, its outline centered exactly (4.5–11.5
                  across, 5.5–10.5 down); mt-1 centers it on the header
                  row's text. */}
              <span
                aria-hidden
                className={`mt-1 size-4 shrink-0 rounded-full ${
                  current ? "bg-emerald-100 ring-1 ring-emerald-200" : "bg-zinc-400"
                }`}
              >
                <svg viewBox="0 0 16 16" className={`block size-4 ${current ? "text-emerald-700" : "text-white"}`}>
                  <path
                    d="M4.5 8 7 10.5l4.5-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-semibold text-zinc-900">Saved</span>
                  <span className="text-xs text-zinc-500 tabular-nums">
                    {formatDateTime(log.createdAt)}
                  </span>
                  {current && onDelete && (
                    <button
                      type="button"
                      onClick={() => onDelete(log.entryDate)}
                      aria-label="Delete this override"
                      title="Delete this override"
                      className="ml-auto cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>

                {/* The card opens the full record in a centered modal. */}
                <div
                  className={`mt-2 overflow-hidden rounded-md border bg-white ${
                    highlighted ? "border-emerald-100 ring-2 ring-emerald-50" : "border-zinc-200"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedLogId(log.id)}
                    className="block w-full cursor-pointer p-4 text-left transition hover:bg-zinc-50"
                  >
                    <span className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
                      <span className="contents">
                        <span className="text-zinc-500">Quantity</span>
                        <span className="text-right font-medium text-zinc-900 tabular-nums">{formatQuantity(log.quantityCompleted)}{unit ? ` ${unit}` : ""}</span>
                        <span aria-hidden />
                        <span aria-hidden />
                      </span>
                      {HISTORY_COST_ORDER.map((component) => (
                        <span key={component} className="contents">
                          <span className="text-zinc-500">{HISTORY_COST_LABEL[component]}</span>
                          <span className="text-right font-medium text-zinc-900 tabular-nums">{formatPeso(log.costs[component])}</span>
                        </span>
                      ))}
                    </span>
                    <span className="mt-3 flex items-center gap-2.5 border-t border-zinc-100 pt-3">
                      <InitialsAvatar name={log.savedByName ?? "?"} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-zinc-500">
                          Saved by{" "}
                          <span className="font-semibold text-zinc-900">
                            {log.savedByName ?? "an unknown account"}
                          </span>
                        </span>
                        {log.savedByRole && (
                          <span className="block truncate text-[11px] text-zinc-400">
                            {log.savedByRole}
                          </span>
                        )}
                      </span>
                      <ChevronRight aria-hidden className="size-4 shrink-0 text-zinc-400" />
                    </span>
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {logs.length > HISTORY_PREVIEW && !targetNeedsReveal && (
        <button
          type="button"
          onClick={() => setShowAll((all) => !all)}
          className="cursor-pointer self-start text-xs font-medium text-zinc-500 transition hover:text-zinc-900"
        >
          {showAll ? "Show less" : `Show all ${logs.length}`}
        </button>
      )}
      <SavedProgressLogModal
        key={selectedLog?.id ?? "none"}
        log={selectedLog}
        unit={unit}
        projectId={projectId}
        projectName={projectName}
        incidentContext={incidentContext}
        fallbackIncidents={selectedLog ? historyIncidents[selectedLog.entryDate] ?? currentIncidents.filter(incident => incident.log_date === selectedLog.entryDate) : EMPTY_INCIDENTS}
        onClose={() => setSelectedLogId(null)}
      />
    </section>
  );
}

function SavedProgressLogModal({
  log,
  unit,
  projectId,
  projectName,
  incidentContext,
  fallbackIncidents,
  onClose,
}: {
  log: OverrideLog | null;
  unit: string | null;
  projectId?: number;
  projectName: string;
  incidentContext?: IncidentContext;
  fallbackIncidents: Incident[];
  onClose: () => void;
}) {
  const [incidents, setIncidents] = useState<Incident[]>(fallbackIncidents);
  const [error, setError] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState("");

  const entryDate = log?.entryDate;
  const contextKind = incidentContext?.kind;
  const contextId = incidentContext?.id;

  useEffect(() => {
    if (!entryDate || !projectId || !contextKind || !contextId) return;

    let cancelled = false;
    listTodayIncidents(projectId, { kind: contextKind, id: contextId }, entryDate)
      .then((result) => {
        if (cancelled) return;
        if (!result.error) setIncidents(result.items);
        setError(result.error ?? "");
      })
      .catch(() => {
        if (!cancelled) setError("Could not load incident reports for this log.");
      });

    return () => {
      cancelled = true;
    };
  }, [entryDate, projectId, contextKind, contextId, fallbackIncidents]);


  async function downloadReport() {
    if (!log || pdfBusy) return;
    setPdfBusy(true);
    setPdfError("");
    try {
      await downloadDailyLogPdf({
        projectName,
        workItemName: incidentContext?.name ?? "Progress item",
        unit,
        log,
        incidents,
      });
    } catch (cause) {
      console.error("[downloadDailyLogPdf]", cause);
      setPdfError("Could not create the PDF. Please try again.");
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <>
      <Modal
        open={log !== null}
        onClose={onClose}
        title={log ? formatDay(log.entryDate) : "Log history"}
        description={
          log
            ? `Logged by ${log.savedByName ?? "Unknown account"}`
            : undefined
        }
        icon={<HistoryIcon className="size-4" />}
        bareIcon
        variant="centered"
        size="wide"
      >
        {log && (
          <article className="flex flex-col gap-4">
            <section className="overflow-hidden rounded border border-zinc-200">
              <h4 className="bg-zinc-100 px-3 py-2 text-[13px] font-semibold text-zinc-800">Work progress and cost summary</h4>
              <dl className="grid grid-cols-2 gap-x-8 gap-y-2 px-3 py-3 text-[13px]">
              <div className="flex justify-between gap-3">
                <dt className="text-zinc-500">Quantity</dt>
                <dd className="font-medium tabular-nums">
                  {formatQuantity(log.quantityCompleted)}
                  {unit ? ` ${unit}` : ""}
                </dd>
              </div>
              <div aria-hidden />
              {HISTORY_COST_ORDER.map((component) => (
                <div key={component} className="flex justify-between gap-3">
                  <dt className="text-zinc-500">{HISTORY_COST_LABEL[component]}</dt>
                  <dd className="font-medium tabular-nums">
                    {formatPeso(log.costs[component])}
                  </dd>
                </div>
              ))}
              </dl>
            </section>
            <OverrideLogDetails log={log} />
            <section className="overflow-hidden rounded border border-zinc-200">
              <div className="flex items-center gap-2 bg-zinc-100 px-3 py-2">
                <Flag className="size-4 text-amber-600" />
                <h4 className="text-[13px] font-semibold text-zinc-800">
                  Incident reports
                </h4>
              </div>
              {error ? (
                <p className="px-3 py-3 text-xs text-red-600">{error}</p>
              ) : incidents.length === 0 ? (
                <EmptyState compact className="px-3 py-3 text-xs text-zinc-400">
                  No incidents reported for this log.
                </EmptyState>
              ) : (
                <div className="space-y-3 p-3">
                  {incidents.map((incident) => {
                    const files = incident.attachments;
                    return (
                      <article
                        key={incident.id}
                        className="rounded-md border border-zinc-200 bg-white px-4 py-3 text-xs"
                      >
                        <span className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate font-medium text-zinc-700">{INCIDENT_TYPES[incident.incident_type]}</span>
                          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600">{INCIDENT_SEVERITIES[incident.severity]}</span>
                        </span>
                        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                          <dt className="font-medium text-zinc-500">Occurred</dt><dd>{formatDay(incident.occurred_on)} · {incident.occurred_time.slice(0, 5)}</dd>
                          <dt className="font-medium text-zinc-500">Location</dt><dd>{incident.location || "Not recorded"}</dd>
                          <dt className="font-medium text-zinc-500">What happened</dt><dd className="whitespace-pre-wrap break-words leading-relaxed">{incident.description}</dd>
                          <dt className="font-medium text-zinc-500">Reported by</dt><dd>{incident.reporter_name || "Project member"}</dd>
                          <dt className="font-medium text-zinc-500">Submitted</dt><dd>{formatDateTime(incident.created_at)}</dd>
                        </dl>
                        {files.length > 0 && (
                          <div className="mt-3 border-t border-zinc-100 pt-3">
                            <p className="font-semibold text-zinc-700">Attachments ({files.length})</p>
                            <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                              {files.map((file) => (
                                <li key={file.path} className="min-w-0 overflow-hidden rounded border border-zinc-200 bg-zinc-50/50 text-xs">
                                  {file.url && file.type.startsWith("image/") ? <a href={file.url} target="_blank" rel="noopener noreferrer" className="relative block aspect-[4/3]"><Image src={file.url} alt={file.name} fill unoptimized sizes="260px" className="object-cover" /></a> : file.url && file.type === "application/pdf" ? <iframe src={file.url} title={file.name} className="h-40 w-full bg-white" /> : <div className="flex h-40 items-center justify-center"><Paperclip className="size-6 text-zinc-400" /></div>}
                                  <div className="flex items-center gap-2 px-2.5 py-2">
                                  {file.url ? (
                                    <a href={file.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-zinc-700 underline underline-offset-4 hover:text-blue-600 font-medium">
                                      {file.name}
                                    </a>
                                  ) : (
                                    <span className="min-w-0 flex-1 truncate text-zinc-500">{file.name}</span>
                                  )}
                                  {file.size ? (
                                    <span className="ml-auto shrink-0 text-[11px] text-zinc-400 tabular-nums">
                                      {formatFileSize(file.size)}
                                    </span>
                                  ) : null}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
            {pdfError && <p role="alert" className="text-xs text-red-600">{pdfError}</p>}
          </article>
        )}
        <ModalFooter>
          <button type="button" onClick={downloadReport} disabled={!log || pdfBusy} className="ml-auto inline-flex items-center gap-2 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50">
            {pdfBusy ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
            {pdfBusy ? "Creating PDF…" : "Download as a report"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zinc-200 px-4 py-2 text-sm"
          >
            Close
          </button>
        </ModalFooter>
      </Modal>
    </>
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
 * Automatic progress: a working day nobody saved counts its planned share
 * on its own (computeDailyPlan — planned ÷ working days, e.g. ₱1,000 of
 * material over 4 days → ₱250) — today too, from the moment it starts
 * (12:00 AM). So an unsaved day's inputs start from that share, and
 * saving records what's typed instead. Reopening a day already saved
 * starts from what was saved.
 *
 * Labor comes from Labor today when anyone's listed there — the hours each
 * assigned skilled worker (or helper) put in, at their own Default Rate;
 * the server prices it the same way on save. With nobody listed, it's
 * typed like equipment and other cost.
 */
export function ProgressTrackingModalContent({
  readOnly = false,
  estimatedQuantity,
  unit,
  plannedStartDate,
  plannedEndDate,
  plannedMaterials,
  plannedEquipmentCosts = [],
  plannedOtherCosts = [],
  plannedCosts,
  workingDays,
  holidays,
  progressToday,
  materialPrices = [],
  equipmentCostSuggestions = [],
  otherCostSuggestions = [],
  crew = [],
  team = [],
  highlightLatest = false,
  highlightEntryDate,
  overrideHistory,
  projectId,
  projectName,
  incidentContext,
  materialStocks,
  onSave,
  onDeleteOverride,
  loadOverrideHistory,
  onClose,
}: {
  /** Equipment records show saved progress and history without editing controls. */
  readOnly?: boolean;
  estimatedQuantity: number;
  unit: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  plannedMaterials: PlannedMaterial[];
  plannedEquipmentCosts?: PlannedOtherCost[];
  plannedOtherCosts?: PlannedOtherCost[];
  /** The task's own planned cost per component — what % complete is
   * measured against. */
  plannedCosts: CostAmounts;
  workingDays: readonly number[];
  holidays: readonly string[];
  progressToday: TaskProgressToday;
  /** The project's estimate material lines — suggested for a material
   * used that isn't on this task's own lines, the unit cost filled in
   * from the one picked. */
  materialPrices?: { name: string; unit: string | null; unitCost: number }[];
  equipmentCostSuggestions?: { name: string; amount: number }[];
  otherCostSuggestions?: { name: string; amount: number }[];
  /** Who's assigned to this task (or phase) — Labor today lists them. */
  crew?: Worker[];
  /** The whole Team — anyone else who helped can be added. */
  team?: Worker[];
  /** Opened from a notification — highlight its Last override. */
  highlightLatest?: boolean;
  /** A date selected from the Equipment Cost record. */
  highlightEntryDate?: string;
  /** Preloaded project data, so the Log history is visible on first paint. */
  overrideHistory: OverrideLog[];
  projectId?: number;
  projectName: string;
  incidentContext?: IncidentContext;
  materialStocks?: readonly MaterialStockItem[];
  onSave: (input: {
    quantityCompletedToday: number;
    costs: CostAmounts;
    materialsUsed: { name: string; unit: string | null; quantity: number }[];
    unplannedMaterials: UnplannedMaterial[];
    equipmentCostsUsed?: { name: string; amount: number }[];
    unplannedEquipmentCosts?: UnplannedOtherCost[];
    otherCostsUsed?: { name: string; amount: number }[];
    unplannedOtherCosts?: UnplannedOtherCost[];
    attendance: { workerId: number; hours: number }[];
  }) => Promise<ProgressActionResult>;
  /** Deletes a day's override — given for admins and super admins only,
   * who then get its Delete. */
  onDeleteOverride?: (entryDate: string) => Promise<ProgressActionResult>;
  /** Optional fallback for a future caller that does not preload history. */
  loadOverrideHistory?: () => Promise<OverrideLog[]>;
  onClose: () => void;
}) {
  const router = useRouter();
  const savedToday = progressToday.today;
  const [reportingIncident, setReportingIncident] = useState(false);
  const [summaryCollapsed, setSummaryCollapsed] = useState(true);
  const [summaryHasToggled, setSummaryHasToggled] = useState(false);
  const [incidentsOpen, setIncidentsOpen] = useState(false);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [incidentsLoading, setIncidentsLoading] = useState(true);
  const [incidentsError, setIncidentsError] = useState("");
  const [incidentRefresh, setIncidentRefresh] = useState(0);
  const [selectedIncidentId, setSelectedIncidentId] = useState<number | null>(null);
  const incidentOpen = reportingIncident && !readOnly && !!projectId && !!incidentContext;
  const incidentContextKind = incidentContext?.kind;
  const incidentContextId = incidentContext?.id;

  useEffect(() => {
    if (readOnly || !projectId || !incidentContextKind || !incidentContextId) return;
    let cancelled = false;
    listTodayIncidents(projectId, { kind: incidentContextKind, id: incidentContextId })
      .then((result) => {
        if (cancelled) return;
        setIncidents(result.items);
        setIncidentsError(result.error ?? "");
      })
      .catch(() => { if (!cancelled) setIncidentsError("Could not load today's incident reports."); })
      .finally(() => { if (!cancelled) setIncidentsLoading(false); });
    return () => { cancelled = true; };
  }, [readOnly, projectId, incidentContextKind, incidentContextId, incidentRefresh]);

  const [stockModalRowId, setStockModalRowId] = useState<number | null>(null);
  const [fetchedStocks, setFetchedStocks] = useState<MaterialStockItem[] | null>(null);

  useEffect(() => {
    if (materialStocks && materialStocks.length > 0) return;
    if (!projectId) return;
    let cancelled = false;
    loadMaterialPurchases(projectId)
      .then((purchases) => {
        if (cancelled) return;
        setFetchedStocks(computeMaterialStocks(purchases, []));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [materialStocks, projectId]);

  const effectiveMaterialStocks = useMemo(() => {
    if (materialStocks && materialStocks.length > 0) return materialStocks;
    return fetchedStocks ?? [];
  }, [materialStocks, fetchedStocks]);

  const assignedMaterialNames = useMemo(() => {
    return new Set(plannedMaterials.map((m) => m.name.trim().toLowerCase()));
  }, [plannedMaterials]);

  const assignedMaterialKeys = useMemo(() => {
    return new Set(plannedMaterials.map((m) => materialKey(m.name, m.unit)));
  }, [plannedMaterials]);

  // Exclude materials already assigned to this task from the unplanned stock picker
  const unassignedStocks = useMemo(() => {
    return effectiveMaterialStocks.filter((stock) => {
      const name = stock.name.trim().toLowerCase();
      if (assignedMaterialNames.has(name)) return false;
      const key = materialKey(stock.name, stock.unit);
      if (assignedMaterialKeys.has(key)) return false;
      return true;
    });
  }, [effectiveMaterialStocks, assignedMaterialNames, assignedMaterialKeys]);

  // An override's Delete — the day it's for while its confirmation is
  // open; then the window closes like Save does, so it reopens from
  // what's left.
  const [deleteDate, setDeleteDate] = useState<string | null>(null);
  const [deletingOverride, setDeletingOverride] = useState(false);
  const [deleteOverrideError, setDeleteOverrideError] = useState<string | null>(null);

  function askToDelete(entryDate: string) {
    setDeleteOverrideError(null);
    setDeleteDate(entryDate);
  }

  async function handleDeleteOverride() {
    if (readOnly || !deleteDate || !onDeleteOverride) return;
    setDeletingOverride(true);
    setDeleteOverrideError(null);
    const result = await onDeleteOverride(deleteDate);
    setDeletingOverride(false);
    if (result.error) {
      setDeleteOverrideError(result.error);
      return;
    }
    setDeleteDate(null);
    router.refresh();
    onClose();
  }

  // The override history is already present when this modal opens.
  const [history, setHistory] = useState<OverrideLog[]>(overrideHistory);
  useEffect(() => {
    if (!loadOverrideHistory) return;
    let active = true;
    loadOverrideHistory().then((logs) => {
      if (active) setHistory(logs);
    });
    return () => {
      active = false;
    };
    // Once, when the window opens — the loader's a new function each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const schedule = { plannedStartDate, plannedEndDate, workingDays, holidays };

  // Where the task stands as saved, before anything typed here — every
  // saved log (today's too, once saved), with nothing added for unlogged
  // days: the standing the Gantt chart shows. The Actual box reads
  // it, so it holds still while today's log is typed.
  const [savedStanding] = useState(() =>
    computeProgressBreakdown({
      ...schedule,
      plannedCosts,
      estimatedQuantity,
      plannedMaterials,
      plannedEquipmentCosts,
      plannedOtherCosts,
      anchor: progressToday,
      today: new Date(),
    })
  );

  // With Material Breakdown lines (ones with a planned quantity), the
  // day's material cost is just the Materials used today table's total —
  // each line's quantity × its unit cost, the way the server prices it on
  // save. Without any, it's typed.
  const itemizedMaterials = plannedMaterials.filter((material) => material.plannedQuantity > 0);
  const hasItemizedMaterials = itemizedMaterials.length > 0;
  const itemizedPlanned = itemizedMaterials.reduce((sum, material) => sum + material.plannedValue, 0);

  const itemizedEquipmentCosts = plannedEquipmentCosts.filter((item) => item.plannedAmount > 0);
  const hasItemizedEquipmentCosts = itemizedEquipmentCosts.length > 0;
  const itemizedEquipmentPlanned = itemizedEquipmentCosts.reduce(
    (sum, item) => sum + item.plannedAmount,
    0
  );

  const itemizedOtherCosts = plannedOtherCosts.filter((item) => item.plannedAmount > 0);
  const hasItemizedOtherCosts = itemizedOtherCosts.length > 0;
  const itemizedOtherPlanned = itemizedOtherCosts.reduce(
    (sum, item) => sum + item.plannedAmount,
    0
  );

  const [quantityInput, setQuantityInput] = useState(() =>
    savedToday ? toInput(savedToday.quantityCompleted) : ""
  );
  const [costInputs, setCostInputs] = useState<Record<CostComponent, string>>(() => {
    return {
      labor: savedToday ? toInput(savedToday.costs.labor) : "",
      // Only typed without Material Breakdown lines.
      material: savedToday && !hasItemizedMaterials ? toInput(savedToday.costs.material) : "",
      equipment: savedToday && !hasItemizedEquipmentCosts ? toInput(savedToday.costs.equipment) : "",
      other: savedToday && !hasItemizedOtherCosts ? toInput(savedToday.costs.other) : "",
    };
  });
  const [materialInputs, setMaterialInputs] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const material of plannedMaterials) {
      initial[material.key] = savedToday
        ? toInput(savedToday.materialUsage[material.key] ?? 0)
        : "";
    }
    return initial;
  });
  const [equipmentCostInputs, setEquipmentCostInputs] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    const savedMap = savedToday?.equipmentCostSpend ?? {};
    const hasSavedItems =
      Object.keys(savedMap).length > 0 ||
      (savedToday?.unplannedEquipmentCosts?.length ?? 0) > 0;
    for (const item of plannedEquipmentCosts) {
      if (savedToday) {
        if (hasSavedItems || savedToday.costs.equipment === 0) {
          initial[item.key] = toInput(savedMap[item.key] ?? 0);
        } else {
          const share =
            itemizedEquipmentPlanned > 0 ? item.plannedAmount / itemizedEquipmentPlanned : 0;
          initial[item.key] = toInput(savedToday.costs.equipment * share);
        }
      } else {
        initial[item.key] = "";
      }
    }
    return initial;
  });
  const [unplannedEquipmentRows, setUnplannedEquipmentRows] = useState<UnplannedOtherRow[]>(() =>
    (savedToday?.unplannedEquipmentCosts ?? []).map((item, index) => ({
      id: index,
      name: item.name,
      amount: toInput(item.amount),
    }))
  );
  const nextUnplannedEquipmentId = useRef(unplannedEquipmentRows.length);
  const [otherCostInputs, setOtherCostInputs] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    const savedMap = savedToday?.otherCostSpend ?? {};
    const hasSavedItems =
      Object.keys(savedMap).length > 0 ||
      (savedToday?.unplannedOtherCosts?.length ?? 0) > 0;
    for (const item of plannedOtherCosts) {
      if (savedToday) {
        if (hasSavedItems || savedToday.costs.other === 0) {
          initial[item.key] = toInput(savedMap[item.key] ?? 0);
        } else {
          const share =
            itemizedOtherPlanned > 0 ? item.plannedAmount / itemizedOtherPlanned : 0;
          initial[item.key] = toInput(savedToday.costs.other * share);
        }
      } else {
        initial[item.key] = "";
      }
    }
    return initial;
  });
  const [unplannedOtherRows, setUnplannedOtherRows] = useState<UnplannedOtherRow[]>(() =>
    (savedToday?.unplannedOtherCosts ?? []).map((item, index) => ({
      id: index,
      name: item.name,
      amount: toInput(item.amount),
    }))
  );
  const nextUnplannedOtherId = useRef(unplannedOtherRows.length);
  // Materials used that aren't on the task's own lines — each typed: what
  // it is, its unit, how much, and at what unit cost (0073). Today's saved
  // ones, else none.
  const [unplannedRows, setUnplannedRows] = useState<UnplannedRow[]>(() =>
    (savedToday?.unplannedMaterials ?? []).map((material, index) => ({
      id: index,
      name: material.name,
      unit: material.unit ?? "",
      quantity: toInput(material.quantity),
      unitCost: toInput(material.unitCost),
    }))
  );
  const nextUnplannedId = useRef(unplannedRows.length);

  // Labor today: only saved attendance is restored. New logs start blank so
  // scheduled hours are not mistaken for actual hours worked.
  const crewHourly = crew.filter(paidHourly);
  const [hours, setHours] = useState<Record<number, string>>(() => {
    const initial: Record<number, string> = {};
    const saved = progressToday.todayAttendance;
    for (const worker of crewHourly) {
      initial[worker.id] = "";
    }
    if (savedToday) {
      for (const mark of saved) {
        if (mark.workerId !== null) initial[mark.workerId] = toInput(mark.hours);
      }
    }
    return initial;
  });
  const teamById = new Map(team.map((worker) => [worker.id, worker]));
  const crewIds = new Set(crewHourly.map((worker) => worker.id));
  const laborRows = [
    ...crewHourly.map((worker) => ({ worker, helper: false })),
    ...Object.keys(hours)
      .map(Number)
      .filter((id) => !crewIds.has(id))
      .flatMap((id) => {
        const worker = teamById.get(id);
        return worker ? [{ worker, helper: true }] : [];
      })
      .sort((a, b) => a.worker.fullName.localeCompare(b.worker.fullName)),
  ];
  const hoursWorked = laborRows.map(({ worker }) => ({
    workerId: worker.id,
    hours: parseHours(hours[worker.id] ?? ""),
  }));
  // Labor's priced from hours once anyone's listed; typed otherwise.
  const laborFromHours = laborRows.length > 0;
  const laborToday = laborRows.reduce(
    (sum, { worker }, index) => sum + (worker.hourlyRate ?? 0) * (hoursWorked[index].hours ?? 0),
    0
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The estimate's materials to suggest — less this task's own lines,
  // which have their own rows above.
  const ownMaterialKeys = new Set(plannedMaterials.map((material) => material.key));
  const suggestions = materialPrices.filter(
    (price) => !ownMaterialKeys.has(materialKey(price.name, price.unit))
  );

  function updateUnplanned(id: number, patch: Partial<UnplannedRow>) {
    setUnplannedRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  // A name picked from the estimate fills in its unit and unit cost, when
  // they're still blank.
  function renameUnplanned(row: UnplannedRow, name: string) {
    const matches = suggestions.filter(
      (price) => price.name.trim().toLowerCase() === name.trim().toLowerCase()
    );
    const match =
      matches.find(
        (price) => (price.unit ?? "").trim().toLowerCase() === row.unit.trim().toLowerCase()
      ) ?? matches[0];
    updateUnplanned(row.id, {
      name,
      ...(match && !row.unit.trim() ? { unit: match.unit ?? "" } : {}),
      ...(match && !row.unitCost.trim() ? { unitCost: toInput(match.unitCost) } : {}),
    });
  }

  function addUnplanned() {
    const id = nextUnplannedId.current++;
    setUnplannedRows((prev) => [...prev, { id, name: "", unit: "", quantity: "", unitCost: "" }]);
  }

  const ownEquipmentCostKeys = new Set(plannedEquipmentCosts.map((item) => item.key));
  const defaultEquipmentCostKinds = [
    { name: "Equipment rental", amount: 0 },
    { name: "Maintenance", amount: 0 },
    { name: "Repair", amount: 0 },
    { name: "Fuel & lubricants", amount: 0 },
    { name: "Hauling & delivery", amount: 0 },
  ];
  const equipmentSuggestions = [
    ...equipmentCostSuggestions.filter((item) => !ownEquipmentCostKeys.has(otherCostKey(item.name))),
    ...defaultEquipmentCostKinds.filter(
      (kind) =>
        !ownEquipmentCostKeys.has(otherCostKey(kind.name)) &&
        !equipmentCostSuggestions.some((item) => otherCostKey(item.name) === otherCostKey(kind.name))
    ),
  ];

  function updateUnplannedEquipment(id: number, patch: Partial<UnplannedOtherRow>) {
    setUnplannedEquipmentRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
  }

  function renameUnplannedEquipment(row: UnplannedOtherRow, name: string) {
    const match = equipmentSuggestions.find(
      (item) => otherCostKey(item.name) === otherCostKey(name) && item.amount > 0
    );
    updateUnplannedEquipment(row.id, {
      name,
      ...(match && !row.amount.trim() ? { amount: toInput(match.amount) } : {}),
    });
  }

  function addUnplannedEquipment() {
    const id = nextUnplannedEquipmentId.current++;
    setUnplannedEquipmentRows((prev) => {
      if (prev.length === 0 && !hasItemizedEquipmentCosts && costInputs.equipment.trim()) {
        setCostInputs((c) => ({ ...c, equipment: "" }));
        return [...prev, { id, name: "", amount: costInputs.equipment }];
      }
      return [...prev, { id, name: "", amount: "" }];
    });
  }

  const ownOtherCostKeys = new Set(plannedOtherCosts.map((item) => item.key));
  const otherSuggestions = otherCostSuggestions.filter(
    (item) => !ownOtherCostKeys.has(otherCostKey(item.name))
  );

  function updateUnplannedOther(id: number, patch: Partial<UnplannedOtherRow>) {
    setUnplannedOtherRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
  }

  function renameUnplannedOther(row: UnplannedOtherRow, name: string) {
    const match = otherSuggestions.find(
      (item) => otherCostKey(item.name) === otherCostKey(name)
    );
    updateUnplannedOther(row.id, {
      name,
      ...(match && !row.amount.trim() ? { amount: toInput(match.amount) } : {}),
    });
  }

  function addUnplannedOther() {
    const id = nextUnplannedOtherId.current++;
    setUnplannedOtherRows((prev) => {
      if (prev.length === 0 && !hasItemizedOtherCosts && costInputs.other.trim()) {
        setCostInputs((c) => ({ ...c, other: "" }));
        return [...prev, { id, name: "", amount: costInputs.other }];
      }
      return [...prev, { id, name: "", amount: "" }];
    });
  }

  const quantity = parseAmount(quantityInput);
  const materialsUsed = plannedMaterials.map((material) => ({
    key: material.key,
    name: material.name,
    unit: material.unit,
    quantity: parseAmount(materialInputs[material.key] ?? ""),
  }));
  const usedToday: Record<string, number> = {};
  for (const material of materialsUsed) usedToday[material.key] = material.quantity ?? 0;
  const unplannedMaterials = unplannedRows.map((row) => ({
    id: row.id,
    name: row.name.trim(),
    unit: row.unit.trim() || null,
    quantity: parseAmount(row.quantity),
    unitCost: parseAmount(row.unitCost),
  }));
  // What today's materials not on the list come to, each at its own unit
  // cost.
  const unplannedToday = unplannedMaterials.reduce(
    (sum, material) => sum + (material.quantity ?? 0) * (material.unitCost ?? 0),
    0
  );
  // Typed only without Material Breakdown lines —
  // null flags something that isn't a real amount.
  const typedMaterial = 0;
  const materialToday = 0;

  const equipmentCostsUsed = plannedEquipmentCosts.map((item) => ({
    key: item.key,
    name: item.name,
    amount: parseAmount(equipmentCostInputs[item.key] ?? ""),
  }));
  const equipmentSpentToday: Record<string, number> = {};
  for (const item of equipmentCostsUsed) equipmentSpentToday[item.key] = item.amount ?? 0;
  const unplannedEquipmentCosts = unplannedEquipmentRows.map((row) => ({
    id: row.id,
    name: row.name.trim(),
    amount: parseAmount(row.amount),
  }));
  const unplannedEquipmentToday = unplannedEquipmentCosts.reduce(
    (sum, item) => sum + (item.amount ?? 0),
    0
  );
  const equipmentFromItems = hasItemizedEquipmentCosts || unplannedEquipmentRows.length > 0;
  const typedEquipment = equipmentFromItems ? 0 : parseAmount(costInputs.equipment);
  const equipmentToday =
    itemizedOtherCost(plannedEquipmentCosts, equipmentSpentToday) +
    (typedEquipment ?? 0) +
    unplannedEquipmentToday;
  const equipmentInvalid =
    equipmentCostsUsed.some((item) => item.amount === null) ||
    unplannedEquipmentCosts.some((item) => item.amount === null) ||
    typedEquipment === null;

  const otherCostsUsed = plannedOtherCosts.map((item) => ({
    key: item.key,
    name: item.name,
    amount: parseAmount(otherCostInputs[item.key] ?? ""),
  }));
  const otherSpentToday: Record<string, number> = {};
  for (const item of otherCostsUsed) otherSpentToday[item.key] = item.amount ?? 0;
  const unplannedOtherCosts = unplannedOtherRows.map((row) => ({
    id: row.id,
    name: row.name.trim(),
    amount: parseAmount(row.amount),
  }));
  const unplannedOtherToday = unplannedOtherCosts.reduce(
    (sum, item) => sum + (item.amount ?? 0),
    0
  );
  const otherFromItems = hasItemizedOtherCosts || unplannedOtherRows.length > 0;
  const typedOther = otherFromItems ? 0 : parseAmount(costInputs.other);
  const otherToday =
    itemizedOtherCost(plannedOtherCosts, otherSpentToday) +
    (typedOther ?? 0) +
    unplannedOtherToday;
  const otherInvalid =
    otherCostsUsed.some((item) => item.amount === null) ||
    unplannedOtherCosts.some((item) => item.amount === null) ||
    typedOther === null;

  const costs = {
    labor: laborFromHours ? laborToday : parseAmount(costInputs.labor),
    material: typedMaterial === null ? null : materialToday,
    equipment: equipmentInvalid ? null : equipmentToday,
    other: otherInvalid ? null : otherToday,
  };

  // Saved totals with today's saved amounts swapped for what's typed now
  // — a local preview only, until the user saves.
  const anchor: ProgressAnchor = {
    cumulativeQuantityCompleted:
      progressToday.cumulativeQuantityCompleted -
      (savedToday?.quantityCompleted ?? 0) +
      (quantity ?? 0),
    cumulativeMaterialUsage: { ...progressToday.cumulativeMaterialUsage },
    cumulativeEquipmentCostSpend: { ...(progressToday.cumulativeEquipmentCostSpend ?? {}) },
    cumulativeOtherCostSpend: { ...(progressToday.cumulativeOtherCostSpend ?? {}) },
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
    cumulativeUnplannedMaterialCost:
      (progressToday.cumulativeUnplannedMaterialCost ?? 0) -
      unplannedMaterialCost(savedToday?.unplannedMaterials ?? []) +
      unplannedToday,
    loggedDates: [...progressToday.loggedDates, toIsoDate(new Date())],
  };
  for (const material of materialsUsed) {
    anchor.cumulativeMaterialUsage[material.key] =
      (progressToday.cumulativeMaterialUsage[material.key] ?? 0) -
      (savedToday?.materialUsage[material.key] ?? 0) +
      (material.quantity ?? 0);
  }
  for (const item of equipmentCostsUsed) {
    anchor.cumulativeEquipmentCostSpend![item.key] =
      (progressToday.cumulativeEquipmentCostSpend?.[item.key] ?? 0) -
      (savedToday?.equipmentCostSpend?.[item.key] ?? 0) +
      (item.amount ?? 0);
  }
  for (const item of otherCostsUsed) {
    anchor.cumulativeOtherCostSpend![item.key] =
      (progressToday.cumulativeOtherCostSpend?.[item.key] ?? 0) -
      (savedToday?.otherCostSpend?.[item.key] ?? 0) +
      (item.amount ?? 0);
  }

  // Same shared function getCostEstimate calls server-side, so this
  // preview always matches what the Gantt chart shows after saving.
  const breakdown = readOnly ? savedStanding : computeProgressBreakdown({
    ...schedule,
    plannedCosts,
    estimatedQuantity,
    plannedMaterials,
    plannedEquipmentCosts,
    plannedOtherCosts,
    anchor,
    today: new Date(),
  });

  // The listed materials recorded so far, each at its unit cost,
  // and what's gone on materials
  // not on the list, today's included.

  // Check if any override progress has been entered (either saved in history
  // or entered in today's log inputs).
  const hasSavedOverride =
    savedToday !== null ||
    progressToday.loggedDates.length > 0 ||
    history.some((log) => log.action === "saved");

  const hasEnteredToday =
    Boolean(quantityInput.trim() && (parseAmount(quantityInput) ?? 0) > 0) ||
    COST_COMPONENTS.some(
      (c) => Boolean(costInputs[c].trim()) && (parseAmount(costInputs[c]) ?? 0) > 0
    ) ||
    Object.values(materialInputs).some(
      (v) => Boolean(v.trim()) && (parseAmount(v) ?? 0) > 0
    ) ||
    Object.values(equipmentCostInputs).some(
      (v) => Boolean(v.trim()) && (parseAmount(v) ?? 0) > 0
    ) ||
    Object.values(otherCostInputs).some(
      (v) => Boolean(v.trim()) && (parseAmount(v) ?? 0) > 0
    ) ||
    Object.values(hours).some((v) => (parseHours(v) ?? 0) > 0) ||
    unplannedRows.some((r) => (parseAmount(r.quantity) ?? 0) > 0) ||
    unplannedEquipmentRows.some((r) => (parseAmount(r.amount) ?? 0) > 0) ||
    unplannedOtherRows.some((r) => (parseAmount(r.amount) ?? 0) > 0);

  const hasOverrideProgress = hasSavedOverride || hasEnteredToday;

  // The plan so far — through today, the same working days Expected
  // progress counts: each part's planned total × that share, what every
  // day up to and including today should add up to. All of it once the
  // task's last day has come. (Material: the Material Breakdown lines'
  // total when it has any — what's used is priced from them.)
  const plannedShare = (breakdown.timePercent ?? 0) / 100;
  const plannedToDate = {
    quantity: estimatedQuantity * plannedShare,
    costs: {
      labor: plannedCosts.labor * plannedShare,
      material: (hasItemizedMaterials ? itemizedPlanned : plannedCosts.material) * plannedShare,
      equipment: plannedCosts.equipment * plannedShare,
      other: plannedCosts.other * plannedShare,
    },
  };

  // The Actual box — starts at 0 until an override progress has been entered
  // (saved in history or typed into today's log). Once entered, it fills with
  // the actual progress standing.
  const actualStanding = hasEnteredToday && !readOnly ? breakdown : savedStanding;
  const actualToDate = hasOverrideProgress
    ? {
        quantity: actualStanding.quantityToDate,
        percent: actualStanding.percentComplete,
        costs: {
          ...actualStanding.costsToDate,
          material: hasItemizedMaterials
            ? itemizedMaterialCost(plannedMaterials, actualStanding.materialUsageToDate) +
              (progressToday.cumulativeUnplannedMaterialCost ?? 0) +
              (hasEnteredToday ? unplannedToday : 0)
            : actualStanding.costsToDate.material,
        },
      }
    : {
        quantity: 0,
        percent: 0,
        costs: ZERO_COSTS,
      };

  const [plannedOpen, setPlannedOpen] = useState(false);
  const [actualOpen, setActualOpen] = useState(false);

  // Breakdown sections for the Planned dropdown card.
  const plannedLaborRows: [string, string][] = [
    ...crewHourly.map((worker): [string, string] => [
      worker.title ? `${worker.fullName} · ${worker.title}` : worker.fullName,
      worker.hourlyRate !== null ? `${formatPeso(worker.hourlyRate)}/hr` : "No rate",
    ]),
    ...(plannedCosts.labor > 0
      ? ([
          [
            "Planned labor",
            `${formatPeso(plannedToDate.costs.labor)} / ${formatPeso(plannedCosts.labor)}`,
          ],
        ] as [string, string][])
      : []),
  ];

  const plannedMaterialRows: [string, string][] = hasItemizedMaterials
    ? itemizedMaterials.map((material): [string, string] => {
        const plannedQty = material.plannedQuantity * plannedShare;
        const plannedVal = material.plannedValue * plannedShare;
        const unitLabel = material.unit ? ` ${material.unit}` : "";
        return [
          material.name,
          `${formatQuantity(plannedQty)} / ${formatQuantity(material.plannedQuantity)}${unitLabel} · ${formatPeso(plannedVal)}`,
        ];
      })
    : plannedCosts.material > 0
      ? [
          [
            "Planned material",
            `${formatPeso(plannedToDate.costs.material)} / ${formatPeso(plannedCosts.material)}`,
          ],
        ]
      : [];

  const plannedEquipmentRows: [string, string][] = hasItemizedEquipmentCosts
    ? itemizedEquipmentCosts.map((item): [string, string] => [
        item.name,
        `${formatPeso(item.plannedAmount * plannedShare)} / ${formatPeso(item.plannedAmount)}`,
      ])
    : plannedCosts.equipment > 0
      ? [
          [
            "Planned equipment",
            `${formatPeso(plannedToDate.costs.equipment)} / ${formatPeso(plannedCosts.equipment)}`,
          ],
        ]
      : [];

  const plannedOtherRows: [string, string][] = hasItemizedOtherCosts
    ? itemizedOtherCosts.map((item): [string, string] => [
        item.name,
        `${formatPeso(item.plannedAmount * plannedShare)} / ${formatPeso(item.plannedAmount)}`,
      ])
    : plannedCosts.other > 0
      ? [
          [
            "Planned other cost",
            `${formatPeso(plannedToDate.costs.other)} / ${formatPeso(plannedCosts.other)}`,
          ],
        ]
      : [];

  const plannedBreakdownSections: BreakdownSection[] = [
    { title: "Labor breakdown", empty: "None planned", rows: plannedLaborRows },
    { title: "Materials used (as planned)", empty: "None planned", rows: plannedMaterialRows },
    { title: "Equipment costs", empty: "None planned", rows: plannedEquipmentRows },
    { title: "Other costs", empty: "None planned", rows: plannedOtherRows },
  ];

  // Active saved logs (latest per logged entryDate) for aggregating
  // actual attendance and unplanned items in the Actual dropdown card.
  const loggedDateSet = new Set(progressToday.loggedDates);
  const seenLogDates = new Set<string>();
  const activeSavedLogs: OverrideLog[] = [];
  for (const log of history) {
    if (seenLogDates.has(log.entryDate)) continue;
    seenLogDates.add(log.entryDate);
    if (log.action === "saved" && loggedDateSet.has(log.entryDate)) {
      activeSavedLogs.push(log);
    }
  }

  const workerActualMap = new Map<string, { name: string; hours: number; cost: number }>();
  for (const log of activeSavedLogs) {
    for (const att of log.attendance ?? []) {
      const key = att.name.trim().toLowerCase();
      const existing = workerActualMap.get(key);
      const cost = att.hours * att.rate;
      if (existing) {
        existing.hours += att.hours;
        existing.cost += cost;
      } else {
        workerActualMap.set(key, { name: att.name, hours: att.hours, cost });
      }
    }
  }
  const actualLaborRows: [string, string][] = Array.from(workerActualMap.values()).map((w) => [
    `${w.name} · ${formatHours(w.hours)}`,
    formatPeso(w.cost),
  ]);
  const loggedLaborTotal = Array.from(workerActualMap.values()).reduce((s, w) => s + w.cost, 0);
  const unitemizedActualLabor = actualToDate.costs.labor - loggedLaborTotal;
  if (actualLaborRows.length === 0 && actualToDate.costs.labor > 0) {
    actualLaborRows.push(["Labor to date", formatPeso(actualToDate.costs.labor)]);
  } else if (actualLaborRows.length > 0 && unitemizedActualLabor > 0.005) {
    actualLaborRows.push(["Automatic / direct labor", formatPeso(unitemizedActualLabor)]);
  }

  const unplannedMatMap = new Map<
    string,
    { name: string; unit: string | null; quantity: number; cost: number }
  >();
  for (const log of activeSavedLogs) {
    for (const m of log.materialsUsed ?? []) {
      if (m.unitCost === null || m.unitCost === undefined || m.quantity <= 0) continue;
      const key = `${materialKey(m.name, m.unit ?? null)}|${m.unitCost}`;
      const existing = unplannedMatMap.get(key);
      const cost = m.quantity * m.unitCost;
      if (existing) {
        existing.quantity += m.quantity;
        existing.cost += cost;
      } else {
        unplannedMatMap.set(key, {
          name: m.name,
          unit: m.unit ?? null,
          quantity: m.quantity,
          cost,
        });
      }
    }
  }
  const actualMaterialRows: [string, string][] = [
    ...itemizedMaterials.map((material): [string, string] => {
      const used = savedStanding.materialUsageToDate[material.key] ?? 0;
      const unitCost =
        material.plannedQuantity > 0 ? material.plannedValue / material.plannedQuantity : 0;
      const unitLabel = material.unit ? ` ${material.unit}` : "";
      return [
        material.name,
        `${formatQuantity(used)} / ${formatQuantity(material.plannedQuantity)}${unitLabel} · ${formatPeso(used * unitCost)}`,
      ];
    }),
    ...Array.from(unplannedMatMap.values()).map((m): [string, string] => [
      `${m.name} (unplanned)`,
      `${formatQuantity(m.quantity)}${m.unit ? ` ${m.unit}` : ""} · ${formatPeso(m.cost)}`,
    ]),
  ];
  if (actualMaterialRows.length === 0 && actualToDate.costs.material > 0) {
    actualMaterialRows.push(["Material to date", formatPeso(actualToDate.costs.material)]);
  }

  const unplannedEqMap = new Map<string, { name: string; amount: number }>();
  for (const log of activeSavedLogs) {
    for (const item of log.equipmentCosts ?? []) {
      if (!item.unplanned || item.amount <= 0) continue;
      const key = otherCostKey(item.name);
      const existing = unplannedEqMap.get(key);
      if (existing) existing.amount += item.amount;
      else unplannedEqMap.set(key, { name: item.name, amount: item.amount });
    }
  }
  const actualEquipmentRows: [string, string][] = [
    ...itemizedEquipmentCosts.map((item): [string, string] => {
      const spent = savedStanding.equipmentCostSpendToDate[item.key] ?? 0;
      return [item.name, `${formatPeso(spent)} / ${formatPeso(item.plannedAmount)}`];
    }),
    ...Array.from(unplannedEqMap.values()).map((item): [string, string] => [
      `${item.name} (unplanned)`,
      formatPeso(item.amount),
    ]),
  ];
  const itemizedActualEq =
    itemizedEquipmentCosts.reduce(
      (s, item) => s + (savedStanding.equipmentCostSpendToDate[item.key] ?? 0),
      0
    ) + Array.from(unplannedEqMap.values()).reduce((s, item) => s + item.amount, 0);
  const remainingActualEq = actualToDate.costs.equipment - itemizedActualEq;
  if (actualEquipmentRows.length === 0 && actualToDate.costs.equipment > 0) {
    actualEquipmentRows.push(["Equipment to date", formatPeso(actualToDate.costs.equipment)]);
  } else if (actualEquipmentRows.length > 0 && remainingActualEq > 0.005) {
    actualEquipmentRows.push(["Automatic / direct equipment", formatPeso(remainingActualEq)]);
  }

  const unplannedOtherMap = new Map<string, { name: string; amount: number }>();
  for (const log of activeSavedLogs) {
    for (const item of log.otherCosts ?? []) {
      if (!item.unplanned || item.amount <= 0) continue;
      const key = otherCostKey(item.name);
      const existing = unplannedOtherMap.get(key);
      if (existing) existing.amount += item.amount;
      else unplannedOtherMap.set(key, { name: item.name, amount: item.amount });
    }
  }
  const actualOtherRows: [string, string][] = [
    ...itemizedOtherCosts.map((item): [string, string] => {
      const spent = savedStanding.otherCostSpendToDate[item.key] ?? 0;
      return [item.name, `${formatPeso(spent)} / ${formatPeso(item.plannedAmount)}`];
    }),
    ...Array.from(unplannedOtherMap.values()).map((item): [string, string] => [
      `${item.name} (unplanned)`,
      formatPeso(item.amount),
    ]),
  ];
  const itemizedActualOther =
    itemizedOtherCosts.reduce(
      (s, item) => s + (savedStanding.otherCostSpendToDate[item.key] ?? 0),
      0
    ) + Array.from(unplannedOtherMap.values()).reduce((s, item) => s + item.amount, 0);
  const remainingActualOther = actualToDate.costs.other - itemizedActualOther;
  if (actualOtherRows.length === 0 && actualToDate.costs.other > 0) {
    actualOtherRows.push(["Other cost to date", formatPeso(actualToDate.costs.other)]);
  } else if (actualOtherRows.length > 0 && remainingActualOther > 0.005) {
    actualOtherRows.push(["Automatic / direct other cost", formatPeso(remainingActualOther)]);
  }

  const actualBreakdownSections: BreakdownSection[] = [
    {
      title: "Labor breakdown",
      empty: "None logged",
      rows: hasOverrideProgress ? actualLaborRows : [],
    },
    {
      title: "Materials used",
      empty: "None used",
      rows: hasOverrideProgress ? actualMaterialRows : [],
    },
    {
      title: "Equipment costs",
      empty: "None logged",
      rows: hasOverrideProgress ? actualEquipmentRows : [],
    },
    {
      title: "Other costs",
      empty: "None logged",
      rows: hasOverrideProgress ? actualOtherRows : [],
    },
  ];

  async function handleSave() {
    if (readOnly) return;
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
    if (unplannedMaterials.some((material) => material.quantity === null || material.unitCost === null)) {
      setError("An unplanned material needs a quantity and unit cost of 0 or more.");
      return;
    }
    if (unplannedMaterials.some((material) => (material.quantity ?? 0) > 0 && !material.name)) {
      setError("Name each unplanned material used.");
      return;
    }
    if (equipmentCostsUsed.some((item) => item.amount === null) || unplannedEquipmentCosts.some((item) => item.amount === null)) {
      setError("Equipment costs must be 0 or more.");
      return;
    }
    if (unplannedEquipmentCosts.some((item) => (item.amount ?? 0) > 0 && !item.name)) {
      setError("Enter a description for each added equipment cost item.");
      return;
    }
    if (otherCostsUsed.some((item) => item.amount === null) || unplannedOtherCosts.some((item) => item.amount === null)) {
      setError("Other costs must be 0 or more.");
      return;
    }
    if (unplannedOtherCosts.some((item) => (item.amount ?? 0) > 0 && !item.name)) {
      setError("Name each added other cost item.");
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
        labor: costs.labor!,
        // Just the typed part — the server prices what's used itself.
        material: typedMaterial!,
        equipment: typedEquipment!,
        other: typedOther!,
      },
      materialsUsed: materialsUsed.map((material) => ({
        name: material.name,
        unit: material.unit,
        quantity: material.quantity!,
      })),
      // Priced on save too, each at its own unit cost; nothing used, not
      // sent.
      unplannedMaterials: unplannedMaterials
        .filter((material) => (material.quantity ?? 0) > 0)
        .map((material) => ({
          name: material.name,
          unit: material.unit,
          quantity: material.quantity!,
          unitCost: material.unitCost!,
        })),
      equipmentCostsUsed: equipmentCostsUsed.map((item) => ({
        name: item.name,
        amount: item.amount!,
      })),
      unplannedEquipmentCosts: unplannedEquipmentCosts
        .filter((item) => (item.amount ?? 0) > 0)
        .map((item) => ({
          name: item.name,
          amount: item.amount!,
        })),
      otherCostsUsed: otherCostsUsed.map((item) => ({
        name: item.name,
        amount: item.amount!,
      })),
      unplannedOtherCosts: unplannedOtherCosts
        .filter((item) => (item.amount ?? 0) > 0)
        .map((item) => ({
          name: item.name,
          amount: item.amount!,
        })),
      // Who worked and for how long — the server prices labor from it
      // (each one's own Default Rate). Absent (0 hrs), not sent.
      attendance: hoursWorked
        .filter((entry) => (entry.hours ?? 0) > 0)
        .map((entry) => ({ workerId: entry.workerId, hours: entry.hours! })),
    });
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
    onClose();
  }

  let logSectionIndex = 0;
  const nextLogSectionBg = () => (logSectionIndex++ % 2 === 0 ? "bg-zinc-50" : "bg-white");

  return (
    // Equipment records use one scrolling column; editing keeps the
    // form and history side by side on wide screens.
    <div data-progress-summary-collapsed={readOnly ? undefined : summaryCollapsed && !incidentOpen ? "true" : "false"} data-progress-summary-animated={!readOnly && summaryHasToggled ? "true" : undefined} className={[
      "compact-text relative h-full overflow-y-auto",
      !readOnly && "lg:grid lg:overflow-hidden",
      !readOnly && (summaryCollapsed && !incidentOpen
        ? "lg:grid-cols-1"
        : "lg:grid-cols-[minmax(0,1fr)_28rem]"),
    ].filter(Boolean).join(" ")}>
      {/* Live — follows what's typed below, beside the modal's own title. */}
      {breakdown.scheduleStatus && (
        <ModalHeaderAddon>
          {!incidentOpen && (
          <span
            className={`rounded px-2 py-0.5 text-xs font-semibold ${SCHEDULE_STATUS_STYLE[breakdown.scheduleStatus]}`}
          >
            {SCHEDULE_STATUS_LABEL[breakdown.scheduleStatus]}
          </span>
          )}
        </ModalHeaderAddon>
      )}
      {!readOnly && (
        <ModalHeaderActions>
          <button
            type="button"
            aria-expanded={incidentOpen ? undefined : !summaryCollapsed}
            aria-controls={incidentOpen ? undefined : "progress-summary-panel"}
            aria-label={incidentOpen ? "Close" : summaryCollapsed ? "Show Planned, Actual, and Log history" : "Hide Planned, Actual, and Log history"}
            onClick={incidentOpen ? onClose : () => {
              setSummaryHasToggled(true);
              setSummaryCollapsed((collapsed) => !collapsed);
            }}
            className="cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
          >
            {incidentOpen ? <X aria-hidden className="size-5" /> : <PanelRight aria-hidden className="size-5" />}
          </button>
        </ModalHeaderActions>
      )}

      {!readOnly && (
        <div className="flex min-w-0 flex-col divide-y divide-zinc-200 lg:overflow-y-auto">
          {/* Today's own record — an override of today. Each field's figure
              is the total with today over planned, live. */}
          <section className={`flex flex-col gap-4 px-6 py-5 ${nextLogSectionBg()}`}>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <h3 className="text-base font-semibold text-zinc-900">Today&apos;s log</h3>
              <span className="flex items-center gap-1.5 text-sm text-zinc-700">
                <CalendarDays aria-hidden className="size-4 text-zinc-400" />
                {new Date().toLocaleDateString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
            <Field
              htmlFor="progress-quantity"
              label="Quantity completed today"
            >
              <AmountInput
                id="progress-quantity"
                value={quantityInput}
                onChange={setQuantityInput}
                unit={unit}
              />
            </Field>

            {COST_COMPONENTS.map((component) => {
              // Itemized material's its own section too (Materials used
              // today) — priced from what's used.
              if (component === "material") return null;

              // Labor from Labor today's hours — worked out, not typed.
              if (component === "labor" && laborFromHours) {
                return (
                  <Field
                    key={component}
                    htmlFor="progress-labor"
                    label={COST_LABEL[component]}
                  >
                    <div
                      id="progress-labor"
                      title="Hours worked × each worker's hourly rate — from Labor costs below."
                      className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm tabular-nums"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="text-zinc-400">₱</span>
                        <span className={laborToday > 0 ? "text-zinc-700" : "text-zinc-400"}>
                          {laborToday.toLocaleString("en-PH", { maximumFractionDigits: 2 })}
                        </span>
                      </span>
                      <span className="text-xs text-zinc-400">From hours</span>
                    </div>
                  </Field>
                );
              }

              // Equipment cost from Equipment costs today items — worked out, not typed.
              if (component === "equipment" && equipmentFromItems) {
                return (
                  <Field
                    key={component}
                    htmlFor="progress-equipment"
                    label={COST_LABEL[component]}
                  >
                    <div
                      id="progress-equipment"
                      title="Sum of today's itemized equipment costs — from Equipment costs below."
                      className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm tabular-nums"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="text-zinc-400">₱</span>
                        <span className={equipmentToday > 0 ? "text-zinc-700" : "text-zinc-400"}>
                          {equipmentToday.toLocaleString("en-PH", { maximumFractionDigits: 2 })}
                        </span>
                      </span>
                      <span className="text-xs text-zinc-400">From items</span>
                    </div>
                  </Field>
                );
              }

              // Other cost from Other costs today items — worked out, not typed.
              if (component === "other" && otherFromItems) {
                return (
                  <Field
                    key={component}
                    htmlFor="progress-other"
                    label={COST_LABEL[component]}
                  >
                    <div
                      id="progress-other"
                      title="Sum of today's itemized other costs — from Other costs below."
                      className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm tabular-nums"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="text-zinc-400">₱</span>
                        <span className={otherToday > 0 ? "text-zinc-700" : "text-zinc-400"}>
                          {otherToday.toLocaleString("en-PH", { maximumFractionDigits: 2 })}
                        </span>
                      </span>
                      <span className="text-xs text-zinc-400">From items</span>
                    </div>
                  </Field>
                );
              }

              return (
                <Field
                  key={component}
                  htmlFor={`progress-${component}`}
                  label={COST_LABEL[component]}
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
        </section>

        {/* Labor today: the assigned skilled workers' hours, each at their
            own hourly rate — the day's labor cost. */}
        {(laborRows.length > 0 || team.length > 0) && (
          <div className={`px-6 py-5 ${nextLogSectionBg()}`}>
            <LaborToday
              rows={laborRows}
              team={team}
              hours={hours}
              onHours={(workerId, value) => setHours((prev) => ({ ...prev, [workerId]: value }))}
              onAdd={(workerId) =>
                setHours((prev) => ({
                  ...prev,
                  [workerId]: "",
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
                  <span
                    className={
                      breakdown.costsToDate.labor > plannedCosts.labor + 0.005
                        ? "font-semibold text-red-600"
                        : ""
                    }
                  >
                    {formatPeso(breakdown.costsToDate.labor)} / {formatPeso(plannedCosts.labor)} planned
                  </span>
                ) : undefined
              }
              subcontractorsAssigned={crew.some((worker) => worker.employmentType === "subcontractor")}
            />
          </div>
        )}

        {/* Equipment costs today: assigned equipment cost items from the
            task/phase's Equipment Cost Breakdown, plus any extra equipment
            cost rows added on the spot (rental, maintenance, repair, fuel,
            etc.) — their sum reflects on Today's log Equipment cost field. */}
        <section className={`flex flex-col gap-4 px-6 py-5 ${nextLogSectionBg()}`}>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h3 className="text-base font-semibold text-zinc-900">Equipment costs</h3>
            <span className="text-base font-semibold text-zinc-900 tabular-nums">
              Equipment {formatPeso(costs.equipment ?? 0)}
            </span>
          </div>

          {hasItemizedEquipmentCosts || unplannedEquipmentRows.length > 0 ? (
            <div className="overflow-hidden rounded-md border border-zinc-200 bg-white">
              {hasItemizedEquipmentCosts && (
                <>
                  <div
                    className={`${OTHER_COST_COLUMNS} border-b border-zinc-200 bg-zinc-50 py-2 text-xs font-medium text-zinc-500`}
                  >
                    <span>Equipment cost</span>
                    <span>Amount</span>
                  </div>
                  <ul className="divide-y divide-zinc-100">
                    {plannedEquipmentCosts.map((item, index) => {
                      if (item.plannedAmount <= 0) return null;
                      const spent = breakdown.equipmentCostSpendToDate[item.key] ?? 0;
                      const overPlan = spent > item.plannedAmount + 0.005;
                      const id = `progress-equipment-cost-${index}`;
                      return (
                        <li key={item.key} className={`${OTHER_COST_COLUMNS} py-2.5 text-sm`}>
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span
                              aria-hidden
                              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500"
                            >
                              <Wrench className="size-3.5" />
                            </span>
                            <div className="min-w-0">
                              <label
                                htmlFor={id}
                                title={item.name}
                                className="block truncate text-zinc-900"
                              >
                                {item.name}
                              </label>
                              <p
                                className={`truncate text-xs tabular-nums ${
                                  overPlan ? "font-semibold text-red-600" : "text-zinc-500"
                                }`}
                              >
                                {formatPeso(spent)} / {formatPeso(item.plannedAmount)} planned
                              </p>
                            </div>
                          </div>
                          <AmountInput
                            id={id}
                            value={equipmentCostInputs[item.key] ?? ""}
                            onChange={(value) =>
                              setEquipmentCostInputs((prev) => ({ ...prev, [item.key]: value }))
                            }
                            prefix="₱"
                            compact
                          />
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}

              {unplannedEquipmentRows.length > 0 && (
                <>
                  <div
                    className={`${UNPLANNED_OTHER_COLUMNS} ${
                      hasItemizedEquipmentCosts ? "border-y" : "border-b"
                    } border-zinc-200 bg-zinc-50 py-2 text-xs font-medium text-zinc-500`}
                  >
                    <span>{hasItemizedEquipmentCosts ? "Unplanned" : "Equipment cost"}</span>
                    <span>Amount</span>
                    <span className="sr-only">Remove</span>
                  </div>
                  <ul className="divide-y divide-zinc-100">
                    {unplannedEquipmentRows.map((row) => (
                      <li key={row.id} className={`${UNPLANNED_OTHER_COLUMNS} py-2.5 text-sm`}>
                        <input
                          value={row.name}
                          onChange={(e) => renameUnplannedEquipment(row, e.target.value)}
                          list="progress-equipment-cost-suggestions"
                          autoComplete="off"
                          placeholder="e.g., Rental, Maintenance, Repair"
                          aria-label="Equipment cost description"
                          className={CELL_INPUT}
                        />
                        <AmountInput
                          id={`progress-unplanned-equipment-${row.id}`}
                          value={row.amount}
                          onChange={(value) => updateUnplannedEquipment(row.id, { amount: value })}
                          prefix="₱"
                          compact
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setUnplannedEquipmentRows((prev) =>
                              prev.filter((other) => other.id !== row.id)
                            )
                          }
                          aria-label={`Remove ${row.name || "this equipment cost"}`}
                          title="Remove"
                          className="flex cursor-pointer items-center justify-center rounded p-1 text-zinc-400 transition hover:bg-red-50 hover:text-red-600"
                        >
                          <X className="size-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : null}

          <datalist id="progress-equipment-cost-suggestions">
            {equipmentSuggestions.map((item) => (
              <option key={otherCostKey(item.name)} value={item.name}>
                {item.amount > 0 ? formatPeso(item.amount) : undefined}
              </option>
            ))}
          </datalist>

          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <button
              type="button"
              onClick={addUnplannedEquipment}
              className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-900"
            >
              <Plus className="size-4" />
              Add
            </button>
            {plannedCosts.equipment > 0 && (
              <p
                className={`text-xs tabular-nums ${
                  breakdown.costsToDate.equipment > plannedCosts.equipment + 0.005
                    ? "font-semibold text-red-600"
                    : "text-zinc-500"
                }`}
              >
                {formatPeso(breakdown.costsToDate.equipment)} / {formatPeso(plannedCosts.equipment)} planned
              </p>
            )}
          </div>
        </section>

        {/* Materials used today: each
            line's cost is what's used of it × its unit cost from the
            Material Breakdown, and the day's material cost is their total. */}
        {(
          <section className={`flex flex-col gap-4 px-6 py-5 ${nextLogSectionBg()}`}>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <h3 className="text-base font-semibold text-zinc-900">Materials used</h3>
            </div>

            {(hasItemizedMaterials || unplannedRows.length > 0) && (
            <div className="overflow-hidden rounded-md border border-zinc-200 bg-white">
                {hasItemizedMaterials && (
                <>
                <div
                  className={`${MATERIAL_COLUMNS} border-b border-zinc-200 bg-zinc-50 py-2 text-xs font-medium text-zinc-500`}
                >
                  <span>Material</span>
                  <span>Actual Quantity</span>
                </div>
                <ul className="divide-y divide-zinc-100">
                  {plannedMaterials.map((material, index) => {
                    // A line without a planned quantity has nothing to count
                    // or price.
                    if (material.plannedQuantity <= 0) return null;
                    const used = breakdown.materialUsageToDate[material.key] ?? 0;
                    const overPlan = used > material.plannedQuantity + 0.005;
                    const unitLabel = material.unit ? ` ${material.unit}` : "";
                    // By position — a material key can contain spaces, which
                    // an id can't.
                    const id = `progress-material-${index}`;
                    return (
                      <li key={material.key} className={`${MATERIAL_COLUMNS} py-2.5 text-sm`}>
                        <div className="flex min-w-0 items-center gap-2.5">
                          {/* Where Who worked today has each person's
                              avatar — the same size, so both line up. */}
                          <span
                            aria-hidden
                            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500"
                          >
                            <Package className="size-3.5" />
                          </span>
                          <div className="min-w-0">
                            <label
                              htmlFor={id}
                              title={material.name}
                              className="block truncate text-zinc-900"
                            >
                              {material.name}
                            </label>
                            {/* The total with today over planned; red once
                                it's over the plan. */}
                            <p
                              className={`truncate text-xs tabular-nums ${
                                overPlan ? "font-semibold text-red-600" : "text-zinc-500"
                              }`}
                            >
                              {formatQuantity(used)} / {formatQuantity(material.plannedQuantity)}
                              {unitLabel} used
                            </p>
                          </div>
                        </div>
                        <AmountInput
                          id={id}
                          value={materialInputs[material.key] ?? ""}
                          onChange={(value) =>
                            setMaterialInputs((prev) => ({ ...prev, [material.key]: value }))
                          }
                          unit={material.unit}
                          compact
                        />
                      </li>
                    );
                  })}
                </ul>
                </>
                )}

                {/* Materials used that aren't on the task's own lines —
                    typed, each at its own unit cost; in the day's material
                    cost, but not its progress. */}
                {unplannedRows.length > 0 && (
                  <>
                    <div
                      className={`${UNPLANNED_COLUMNS} ${hasItemizedMaterials ? "border-y" : "border-b"} border-zinc-200 bg-zinc-50 py-2 text-xs font-medium text-zinc-500`}
                    >
                      <span>{hasItemizedMaterials ? "Unplanned" : "Material"}</span>
                      <span>Unit</span>
                      <span>Quantity</span>
                      <span className="sr-only">Remove</span>
                    </div>
                    <ul className="divide-y divide-zinc-100">
                      {unplannedRows.map((row) => {
                        return (
                          <li key={row.id} className={`${UNPLANNED_COLUMNS} py-2.5 text-sm`}>
                            <div className="flex min-w-0 items-center gap-1.5">
                              <input
                                value={row.name}
                                onChange={(e) => renameUnplanned(row, e.target.value)}
                                autoComplete="off"
                                placeholder="e.g., Common nails"
                                aria-label="Unplanned material"
                                className={CELL_INPUT}
                              />
                              <button
                                type="button"
                                onClick={() => setStockModalRowId(row.id)}
                                title="Select material from stock"
                                aria-label="Select material from stock"
                                className="flex size-[34px] shrink-0 cursor-pointer items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none"
                              >
                                <ChevronRight className="size-4" />
                              </button>
                            </div>
                            <input
                              value={row.unit}
                              onChange={(e) => updateUnplanned(row.id, { unit: e.target.value })}
                              autoComplete="off"
                              placeholder="Unit"
                              aria-label={`${row.name || "Material"} unit`}
                              className={CELL_INPUT}
                            />
                            <AmountInput
                              id={`progress-unplanned-quantity-${row.id}`}
                              value={row.quantity}
                              onChange={(value) => updateUnplanned(row.id, { quantity: value })}
                              compact
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setUnplannedRows((prev) => prev.filter((other) => other.id !== row.id))
                              }
                              aria-label={`Remove ${row.name || "this material"}`}
                              title="Remove"
                              className="flex size-[34px] cursor-pointer items-center justify-center rounded p-1 text-zinc-400 transition hover:bg-red-50 hover:text-red-600"
                            >
                              <X className="size-4" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <button
                  type="button"
                  onClick={addUnplanned}
                  className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-900"
                >
                  <Plus className="size-4" />
                  Add
                </button>
              </div>
            </section>
        )}

        {/* Other costs today: assigned other cost items from the task/phase's
            Other Cost Breakdown, plus any extra other cost rows added on the
            spot — their sum reflects on Today's log Other cost field. */}
        <section className={`flex flex-col gap-4 px-6 py-5 ${nextLogSectionBg()}`}>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h3 className="text-base font-semibold text-zinc-900">Other costs</h3>
            <span className="text-base font-semibold text-zinc-900 tabular-nums">
              Other {formatPeso(costs.other ?? 0)}
            </span>
          </div>

          {hasItemizedOtherCosts || unplannedOtherRows.length > 0 ? (
            <div className="overflow-hidden rounded-md border border-zinc-200 bg-white">
              {hasItemizedOtherCosts && (
                <>
                  <div
                    className={`${OTHER_COST_COLUMNS} border-b border-zinc-200 bg-zinc-50 py-2 text-xs font-medium text-zinc-500`}
                  >
                    <span>Other cost</span>
                    <span>Amount</span>
                  </div>
                  <ul className="divide-y divide-zinc-100">
                    {plannedOtherCosts.map((item, index) => {
                      if (item.plannedAmount <= 0) return null;
                      const spent = breakdown.otherCostSpendToDate[item.key] ?? 0;
                      const overPlan = spent > item.plannedAmount + 0.005;
                      const id = `progress-other-cost-${index}`;
                      return (
                        <li key={item.key} className={`${OTHER_COST_COLUMNS} py-2.5 text-sm`}>
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span
                              aria-hidden
                              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500"
                            >
                              <Receipt className="size-3.5" />
                            </span>
                            <div className="min-w-0">
                              <label
                                htmlFor={id}
                                title={item.name}
                                className="block truncate text-zinc-900"
                              >
                                {item.name}
                              </label>
                              <p
                                className={`truncate text-xs tabular-nums ${
                                  overPlan ? "font-semibold text-red-600" : "text-zinc-500"
                                }`}
                              >
                                {formatPeso(spent)} / {formatPeso(item.plannedAmount)} planned
                              </p>
                            </div>
                          </div>
                          <AmountInput
                            id={id}
                            value={otherCostInputs[item.key] ?? ""}
                            onChange={(value) =>
                              setOtherCostInputs((prev) => ({ ...prev, [item.key]: value }))
                            }
                            prefix="₱"
                            compact
                          />
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}

              {unplannedOtherRows.length > 0 && (
                <>
                  <div
                    className={`${UNPLANNED_OTHER_COLUMNS} ${
                      hasItemizedOtherCosts ? "border-y" : "border-b"
                    } border-zinc-200 bg-zinc-50 py-2 text-xs font-medium text-zinc-500`}
                  >
                    <span>{hasItemizedOtherCosts ? "Unplanned" : "Other cost"}</span>
                    <span>Amount</span>
                    <span className="sr-only">Remove</span>
                  </div>
                  <ul className="divide-y divide-zinc-100">
                    {unplannedOtherRows.map((row) => (
                      <li key={row.id} className={`${UNPLANNED_OTHER_COLUMNS} py-2.5 text-sm`}>
                        <input
                          value={row.name}
                          onChange={(e) => renameUnplannedOther(row, e.target.value)}
                          list="progress-other-cost-suggestions"
                          autoComplete="off"
                          placeholder="e.g., Plan revision"
                          aria-label="Other cost name"
                          className={CELL_INPUT}
                        />
                        <AmountInput
                          id={`progress-unplanned-other-${row.id}`}
                          value={row.amount}
                          onChange={(value) => updateUnplannedOther(row.id, { amount: value })}
                          prefix="₱"
                          compact
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setUnplannedOtherRows((prev) =>
                              prev.filter((other) => other.id !== row.id)
                            )
                          }
                          aria-label={`Remove ${row.name || "this other cost"}`}
                          title="Remove"
                          className="flex cursor-pointer items-center justify-center rounded p-1 text-zinc-400 transition hover:bg-red-50 hover:text-red-600"
                        >
                          <X className="size-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : null}

          <datalist id="progress-other-cost-suggestions">
            {otherSuggestions.map((item) => (
              <option key={otherCostKey(item.name)} value={item.name}>
                {formatPeso(item.amount)}
              </option>
            ))}
          </datalist>

          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <button
              type="button"
              onClick={addUnplannedOther}
              className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-900"
            >
              <Plus className="size-4" />
              Add
            </button>
            {plannedCosts.other > 0 && (
              <p
                className={`text-xs tabular-nums ${
                  breakdown.costsToDate.other > plannedCosts.other + 0.005
                    ? "font-semibold text-red-600"
                    : "text-zinc-500"
                }`}
              >
                {formatPeso(breakdown.costsToDate.other)} / {formatPeso(plannedCosts.other)} planned
              </p>
            )}
          </div>
        </section>

        <section className={`${nextLogSectionBg()}`}>
          <button
            type="button"
            aria-expanded={incidentOpen}
            aria-controls="progress-incident-form"
            onClick={() => {
              setReportingIncident((open) => !open);
              setIncidentsOpen(!incidentOpen);
            }}
            className="flex w-full cursor-pointer items-center justify-between gap-3 bg-amber-50/60 px-6 py-5 text-left text-amber-900 transition hover:bg-amber-100"
          >
            <span className="flex items-center gap-2">
              <Flag className="size-4 text-amber-700" />
              <span className="text-base font-semibold">Incidents</span>
              {!incidentsLoading && incidents.length > 0 && <span className="text-[11px] font-medium text-zinc-900 tabular-nums">{incidents.length}</span>}
            </span>
            <ChevronDown className={`size-4 text-amber-700 transition ${incidentOpen ? "rotate-180" : ""}`} />
          </button>
          {incidentsOpen && (incidentsError || incidents.length > 0) && (
            <div id="today-incidents" className="border-t border-zinc-200 px-6 py-4">
              {incidentsError ? <p className="text-sm text-red-600">{incidentsError}</p>
                : <div className="space-y-2">{incidents.map((incident) => (
                  <button key={incident.id} type="button" onClick={() => setSelectedIncidentId(incident.id)} className="flex w-full cursor-pointer items-center gap-3 rounded-md border border-zinc-200 bg-white px-4 py-3 text-left text-sm transition hover:bg-zinc-50">
                      <span className="min-w-0 truncate text-zinc-700">{INCIDENT_TYPES[incident.incident_type]}</span>
                      <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">{INCIDENT_SEVERITIES[incident.severity]}</span>
                      <ChevronRight className="ml-auto size-4 shrink-0 text-zinc-400" />
                  </button>
                ))}</div>}
            </div>
          )}
        </section>
      </div>
    )}

      {/* The right section: Planned and Actual status cards above,
          followed by the override history below. */}
      <aside id="progress-summary-panel" inert={!readOnly && summaryCollapsed && !incidentOpen} className={`history-text progress-summary ${incidentOpen ? "hidden" : !readOnly && summaryCollapsed ? "hidden lg:flex" : "flex"} flex-col gap-4 px-6 ${readOnly ? "py-5" : "border-t border-zinc-200 py-5 lg:overflow-y-auto lg:border-t-0 lg:border-l"}`}>
        {/* The plan so far over where the task actually stands — the same
            parts in the same columns, to read one against the other. */}
        <div className="-mx-6 -mt-5 flex flex-col border-b border-zinc-200">
          {/* The plan so far — each part's planned amount through today,
              from automatic progress, to compare today's log (and the days
              before it) against; Expected progress is the same share.
              Hidden until the task has a Start and End to plan from. */}
          {breakdown.totalWorkingDays !== null && (
            <section aria-label="Planned so far" className="bg-sky-50">
              <button
                type="button"
                onClick={() => setPlannedOpen((open) => !open)}
                aria-expanded={plannedOpen}
                className="block w-full cursor-pointer px-6 py-4 text-left transition hover:bg-sky-100/60"
              >
                <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="flex items-center gap-2">
                    <ClipboardList aria-hidden className="size-4 text-sky-700" />
                    <span
                      title="The plan so far, through today — from automatic progress."
                      className="rounded-sm bg-white px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 ring-1 ring-sky-200"
                    >
                      Planned
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span
                      title="Expected progress"
                      className="text-base font-bold text-sky-700 tabular-nums"
                    >
                      {(breakdown.timePercent ?? 0).toFixed(2)}%
                    </span>
                    <ChevronDown
                      aria-hidden
                      className={`size-4 shrink-0 text-sky-700 transition ${plannedOpen ? "rotate-180" : ""}`}
                    />
                  </span>
                </span>
                <span className={`mt-4 grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3 ${readOnly ? "lg:grid-cols-5" : ""}`}>
                  <span className="min-w-0">
                    <span className="block truncate text-xs text-zinc-500">Quantity</span>
                    <span className="mt-0.5 block text-sm font-semibold text-zinc-900 tabular-nums">
                      {formatQuantity(plannedToDate.quantity)}
                      {unit ? ` ${unit}` : ""}
                    </span>
                  </span>
                  {COST_COMPONENTS.map((component) => (
                    <span key={component} className="min-w-0">
                      <span className="block truncate text-xs text-zinc-500">{COST_LABEL[component]}</span>
                      <span className="mt-0.5 block text-sm font-semibold text-zinc-900 tabular-nums">
                        {formatPeso(plannedToDate.costs[component])}
                      </span>
                    </span>
                  ))}
                </span>
              </button>
              {plannedOpen && (
                <div className="border-t border-sky-200/80 px-6 pt-3 pb-4">
                  <StandingBreakdownDetails sections={plannedBreakdownSections} />
                </div>
              )}
            </section>
          )}

          {/* Where it actually stands, as saved — every saved log, each day
              without one at its planned share; Actual progress is its
              percent complete. Still while today's log is typed below. */}
          <section
            aria-label="Actual so far"
            className={`bg-orange-50 ${breakdown.totalWorkingDays !== null ? "border-t border-zinc-200" : ""}`}
          >
            <button
              type="button"
              onClick={() => setActualOpen((open) => !open)}
              aria-expanded={actualOpen}
              className="block w-full cursor-pointer px-6 py-4 text-left transition hover:bg-orange-100/60"
            >
              <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="flex items-center gap-2">
                  <ClipboardCheck aria-hidden className="size-4 text-orange-600" />
                  <span
                    title="Where it stands so far, through today — every saved log, each day without one at its planned share."
                    className="rounded-sm bg-white px-1.5 py-0.5 text-[10px] font-semibold text-orange-700 ring-1 ring-orange-200"
                  >
                    Actual
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    title="Actual progress"
                    className="text-base font-bold text-orange-600 tabular-nums"
                  >
                    {actualToDate.percent.toFixed(2)}%
                  </span>
                  <ChevronDown
                    aria-hidden
                    className={`size-4 shrink-0 text-orange-600 transition ${actualOpen ? "rotate-180" : ""}`}
                  />
                </span>
              </span>
              <span className={`mt-4 grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3 ${readOnly ? "lg:grid-cols-5" : ""}`}>
                <span className="min-w-0">
                  <span className="block truncate text-xs text-zinc-500">Quantity</span>
                  <span className="mt-0.5 block text-sm font-semibold text-zinc-900 tabular-nums">
                    {formatQuantity(actualToDate.quantity)}
                    {unit ? ` ${unit}` : ""}
                  </span>
                </span>
                {COST_COMPONENTS.map((component) => (
                  <span key={component} className="min-w-0">
                    <span className="block truncate text-xs text-zinc-500">{COST_LABEL[component]}</span>
                    <span className="mt-0.5 block text-sm font-semibold text-zinc-900 tabular-nums">
                      {formatPeso(actualToDate.costs[component])}
                    </span>
                  </span>
                ))}
              </span>
            </button>
            {actualOpen && (
              <div className="border-t border-orange-200/80 px-6 pt-3 pb-4">
                <StandingBreakdownDetails sections={actualBreakdownSections} />
              </div>
            )}
          </section>
        </div>

        {history.length > 0 ? (
          <OverrideHistory
            key={`${highlightLatest ? "latest" : "date"}:${highlightEntryDate ?? ""}`}
            logs={history}
            loggedDates={progressToday.loggedDates}
            unit={unit}
            highlightLatest={highlightLatest}
            highlightEntryDate={highlightEntryDate}
            onDelete={!readOnly && onDeleteOverride ? askToDelete : undefined}
            projectId={projectId}
            projectName={projectName}
            incidentContext={incidentContext}
            currentIncidents={incidents}
          />
        ) : (
          <section className="flex flex-col gap-3">
            <HistoryHeading />
            {progressToday.latest ? (
              <LastOverride
                latest={progressToday.latest}
                unit={unit}
                plannedMaterials={plannedMaterials}
                highlight={
                  highlightLatest || progressToday.latest.entryDate === highlightEntryDate
                }
                onDelete={
                  !readOnly && onDeleteOverride
                    ? () => askToDelete(progressToday.latest!.entryDate)
                    : undefined
                }
              />
            ) : (
              <EmptyHistory />
            )}
          </section>
        )}
      </aside>

      {!readOnly && projectId && incidentContext && <IncidentReportPanel projectId={projectId} context={incidentContext} active={incidentOpen} onSubmitted={() => { setReportingIncident(false); setIncidentsLoading(true); setIncidentRefresh((value) => value + 1); setIncidentsOpen(true); }} />}

      {projectId && <IncidentDetailModal projectId={projectId} id={selectedIncidentId} result={selectedIncidentId === null ? null : (() => { const incident = incidents.find(item => item.id === selectedIncidentId); return incident ? { incident, evidence: incident.attachments.map(file => ({ ...file, url: file.url ?? null })) } : null; })()} onClose={() => setSelectedIncidentId(null)} onDeleted={() => { setIncidents(current => current.filter(item => item.id !== selectedIncidentId)); setSelectedIncidentId(null); setIncidentsLoading(true); setIncidentRefresh((value) => value + 1); }} />}

      {/* Asks before deleting an override (admins only) — a centered
          dialog of its own, above this one. */}
      {!readOnly && onDeleteOverride && (
        <ConfirmDialog
          open={deleteDate !== null}
          title="Delete this override?"
          message={deleteDate ? deleteOverrideMessage(deleteDate) : ""}
          pending={deletingOverride}
          error={deleteOverrideError}
          onConfirm={handleDeleteOverride}
          onCancel={() => {
            if (deletingOverride) return;
            setDeleteDate(null);
            setDeleteOverrideError(null);
          }}
        />
      )}

      {/* Material Stock Selection Modal */}
      {!readOnly && (
        <MaterialStockPickerModal
          open={stockModalRowId !== null}
          stocks={unassignedStocks}
          selectedMaterialName={
            stockModalRowId !== null
              ? unplannedRows.find((r) => r.id === stockModalRowId)?.name
              : undefined
          }
          title="Select material from stock"
          description="Choose a material from current inventory stocks to record its usage today."
          variant="centered"
          onSelect={(stock) => {
            if (stockModalRowId !== null) {
              const row = unplannedRows.find((r) => r.id === stockModalRowId);
              const matches = suggestions.filter(
                (price) => price.name.trim().toLowerCase() === stock.name.trim().toLowerCase()
              );
              const match =
                matches.find(
                  (price) =>
                    (price.unit ?? "").trim().toLowerCase() ===
                    (stock.unit || row?.unit || "").trim().toLowerCase()
                ) ?? matches[0];

              updateUnplanned(stockModalRowId, {
                name: stock.name,
                unit: stock.unit || row?.unit || "",
                ...(match && (!row?.unitCost.trim() || row.unitCost === "0")
                  ? { unitCost: toInput(match.unitCost) }
                  : {}),
              });
              setStockModalRowId(null);
            }
          }}
          onClose={() => setStockModalRowId(null)}
        />
      )}

      {/* Along the window's bottom edge, however long it gets. */}
      {!readOnly && !incidentOpen && <ModalFooter>
        {error ? (
          <p role="alert" className="mr-auto text-sm text-red-600">
            {error}
          </p>
        ) : (
          <p className="mr-auto text-xs text-zinc-500">Changes apply to today&apos;s log only.</p>
        )}
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
          className="flex cursor-pointer items-center gap-1.5 rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Check aria-hidden className="size-4" />
          {pending ? "Saving..." : "Save"}
        </button>
      </ModalFooter>}
    </div>
  );
}
