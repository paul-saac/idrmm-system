"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  HistoryIcon,
  Package,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { ModalFooter, ModalHeaderAddon } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InitialsAvatar } from "@/components/ui/list-table";
import type { LatestOverride, TaskProgressToday } from "@/lib/task-progress/data";
import type { OverrideLog } from "@/lib/progress-logs/types";
import { UNIT_OPTIONS } from "@/lib/cost-estimate/units";
import {
  COST_COMPONENTS,
  computeProgressBreakdown,
  computeTodayPlan,
  itemizedMaterialCost,
  materialKey,
  toIsoDate,
  unplannedMaterialCost,
  type CostAmounts,
  type CostComponent,
  type PlannedMaterial,
  type ProgressAnchor,
  type ScheduleStatus,
  type UnplannedMaterial,
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

// Materials used today's Material | Quantity used | Cost — shared by its
// header and each row.
const MATERIAL_COLUMNS = "grid grid-cols-[minmax(0,1fr)_8rem_7rem] items-center gap-3 px-4";

// A material not on the task's own lines: what it is, its unit, how
// much, at what unit cost, what that comes to, and its remove button.
const UNPLANNED_COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_5rem_6.5rem_7rem_6.5rem_1.75rem] items-center gap-2 px-4";

const CELL_INPUT =
  "w-full min-w-0 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-700 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200";

/** One typed row of a material used that isn't on the task's own lines. */
type UnplannedRow = { id: number; name: string; unit: string; quantity: string; unitCost: string };

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

/** A full-width line between sections — -mx-6 takes back the modal
 * body's own px-6. */
function EdgeDivider() {
  return <div aria-hidden="true" className="-mx-6 border-t border-zinc-200" />;
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
    <div className="flex items-center rounded-md border border-zinc-200 bg-white transition focus-within:border-zinc-400 focus-within:ring-2 focus-within:ring-zinc-200">
      {prefix && <span className="shrink-0 pl-3 text-sm text-zinc-400">{prefix}</span>}
      <input
        id={id}
        type="text"
        inputMode="decimal"
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

/** One override in full, under its opened card — what was used, and the
 * day's total, for review. (Who worked isn't shown — the progress window
 * no longer logs it; labor's typed.) */
function OverrideLogDetails({ log }: { log: OverrideLog }) {
  const total = COST_COMPONENTS.reduce((sum, component) => sum + log.costs[component], 0);
  const sections: { title: string; empty: string; rows: [string, string][] }[] = [
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
              `${material.name} (not on the list)`,
              `${amount} · ${formatPeso(material.quantity * material.unitCost)}`,
            ];
      }),
    },
  ];

  return (
    <div className="flex flex-col gap-3 border-t border-zinc-100 bg-zinc-50 px-4 py-3 text-xs">
      {sections.map((section) => (
        <div key={section.title} className="flex flex-col gap-1">
          <p className="font-medium text-zinc-700">{section.title}</p>
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
      ))}
      <div className="flex justify-between gap-3 border-t border-zinc-200 pt-2 font-semibold text-zinc-900">
        <span>Total cost</span>
        <span className="tabular-nums">{formatPeso(total)}</span>
      </div>
    </div>
  );
}

/** The history column before anything's saved — a small drawing (an
 * empty log under a magnifying glass) and a line on what will show up. */
function EmptyHistory() {
  return (
    <div className="flex flex-col items-center px-2 pt-6 pb-2 text-center">
      <svg aria-hidden viewBox="0 0 200 160" className="h-32 w-40">
        {/* A soft backdrop, and the drawing's shadow. */}
        <path
          className="fill-zinc-100"
          d="M30 72C28 42 58 26 95 30c35 4 70-2 77 32 7 33-17 56-52 58-35 2-65 8-82-12C30 98 31 86 30 72Z"
        />
        <ellipse className="fill-zinc-100" cx="100" cy="146" rx="52" ry="4" />
        {/* The log — a clipboard with faint, empty lines. */}
        <rect
          className="fill-white stroke-zinc-400"
          x="62"
          y="30"
          width="66"
          height="84"
          rx="6"
          strokeWidth="2"
        />
        <rect
          className="fill-white stroke-zinc-400"
          x="83"
          y="24"
          width="24"
          height="12"
          rx="3"
          strokeWidth="2"
        />
        <g className="stroke-zinc-300" strokeWidth="2.5" strokeLinecap="round">
          <line x1="74" y1="52" x2="116" y2="52" />
          <line x1="74" y1="64" x2="110" y2="64" />
          <line x1="74" y1="76" x2="100" y2="76" />
        </g>
        {/* Looking for overrides — none yet. */}
        <circle className="fill-white/70 stroke-zinc-400" cx="122" cy="98" r="19" strokeWidth="2" />
        <line
          className="stroke-zinc-400"
          x1="136"
          y1="112"
          x2="149"
          y2="125"
          strokeWidth="5"
          strokeLinecap="round"
        />
        {/* Sparkles. */}
        <g className="stroke-zinc-400" strokeWidth="1.5" strokeLinecap="round">
          <path d="M50 38v8M46 42h8" />
          <path d="M158 34v8M154 38h8" />
          <path d="M46 112v6M43 115h6" />
        </g>
        <circle className="fill-zinc-300" cx="142" cy="22" r="2" />
      </svg>
      <p className="mt-3 text-sm font-semibold text-zinc-700">No logs yet</p>
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
    <h3 className="flex items-center gap-2 text-base font-semibold text-zinc-900">
      <HistoryIcon aria-hidden className="size-4 text-zinc-400" />
      Log history
    </h3>
  );
}

/**
 * The log history — every save of this task's (or phase's) Daily
 * Progress Updates, newest first: who, exactly when, and what was
 * entered. Deleted overrides aren't in it (see listOverrideLogs). The
 * version each day counts now (its newest save, while the day still has
 * its update) gets the orange check — and is the one an admin can delete.
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
}: {
  logs: OverrideLog[];
  /** Days that still have a saved update. */
  loggedDates: readonly string[];
  unit: string | null;
  highlightLatest: boolean;
  highlightEntryDate?: string;
  onDelete?: (entryDate: string) => void;
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
  // Which cards are open for review — the newest already, when the window
  // was opened from a notification about it.
  const [openIds, setOpenIds] = useState<ReadonlySet<number>>(
    () => new Set(targetLogId === null ? [] : [targetLogId])
  );
  const [highlightedId, setHighlightedId] = useState<number | null>(targetLogId);
  function toggle(id: number) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const targetRef = useRef<HTMLLIElement>(null);
  useLayoutEffect(() => {
    if (targetLogId === null) return;
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

  return (
    <section className="flex flex-col gap-3">
      <HistoryHeading />
      {/* A timeline, newest on top: a marker per save on a line down to
          the next — orange for the one that counts now, gray before it. */}
      <ol className="flex flex-col">
        {shown.map((log, index) => {
          const current = currentIds.has(log.id);
          const highlighted = highlightedId === log.id;
          const last = index === shown.length - 1;
          const open = openIds.has(log.id) || log.id === targetLogId;
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
                  current ? "bg-orange-500" : "bg-zinc-400"
                }`}
              >
                <svg viewBox="0 0 16 16" className="block size-4 text-white">
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

                {/* The card's a button: what was entered and who saved it,
                    opening to the whole log for review. */}
                <div
                  className={`mt-2 overflow-hidden rounded-md border bg-white ${
                    highlighted ? "border-orange-300 ring-2 ring-orange-200" : "border-zinc-200"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggle(log.id)}
                    aria-expanded={open}
                    className="block w-full cursor-pointer p-4 text-left transition hover:bg-zinc-50"
                  >
                    <span className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                      {[
                        ["Quantity", `${formatQuantity(log.quantityCompleted)}${unit ? ` ${unit}` : ""}`],
                        ...COST_COMPONENTS.map(
                          (component) =>
                            [HISTORY_COST_LABEL[component], formatPeso(log.costs[component])] as const
                        ),
                      ].map(([label, value]) => (
                        <span key={label} className="flex justify-between gap-2">
                          <span className="text-zinc-500">{label}</span>
                          <span className="font-medium text-zinc-900 tabular-nums">{value}</span>
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
                      <ChevronDown
                        aria-hidden
                        className={`size-4 shrink-0 text-zinc-400 transition ${open ? "rotate-180" : ""}`}
                      />
                    </span>
                  </button>

                  {open && <OverrideLogDetails log={log} />}
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
 * Automatic progress: a working day nobody saved counts its planned share
 * on its own (computeDailyPlan — planned ÷ working days, e.g. ₱1,000 of
 * material over 4 days → ₱250) — today too, from the moment it starts
 * (12:00 AM). So an unsaved day's inputs start from that share, and
 * saving records what's typed instead. Reopening a day already saved
 * starts from what was saved.
 *
 * Labor's typed, like equipment and other cost.
 */
export function ProgressTrackingModalContent({
  readOnly = false,
  estimatedQuantity,
  unit,
  plannedStartDate,
  plannedEndDate,
  plannedMaterials,
  plannedCosts,
  workingDays,
  holidays,
  progressToday,
  materialPrices = [],
  highlightLatest = false,
  highlightEntryDate,
  overrideHistory,
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
  /** Opened from a notification — highlight its Last override. */
  highlightLatest?: boolean;
  /** A date selected from the Equipment Cost record. */
  highlightEntryDate?: string;
  /** Preloaded project data, so the Log history is visible on first paint. */
  overrideHistory: OverrideLog[];
  onSave: (input: {
    quantityCompletedToday: number;
    costs: CostAmounts;
    materialsUsed: { name: string; unit: string | null; quantity: number }[];
    unplannedMaterials: UnplannedMaterial[];
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

  // Today's automatic values — already counted from 12:00 AM while
  // nothing's saved for today, never past what's left of the plan
  // (computeTodayPlan) — so an unsaved day's inputs start from them;
  // saving records what's here instead. Only used while today isn't saved,
  // so the saved totals here are every day's but today's.
  const [dailyPlan] = useState(() =>
    computeTodayPlan({
      ...schedule,
      plannedCosts,
      estimatedQuantity,
      plannedMaterials,
      anchor: {
        cumulativeQuantityCompleted: progressToday.cumulativeQuantityCompleted,
        cumulativeMaterialUsage: progressToday.cumulativeMaterialUsage,
        cumulativeCosts: progressToday.cumulativeCosts,
        cumulativeUnplannedMaterialCost: progressToday.cumulativeUnplannedMaterialCost,
        loggedDates: progressToday.loggedDates,
      },
      today: new Date(),
    })
  );

  // Where the task stands as saved, before anything typed here — every
  // saved log (today's too, once saved), each day without one counting its
  // planned share: the standing the Gantt chart shows. The Actual box reads
  // it, so it holds still while today's log is typed.
  const [savedStanding] = useState(() =>
    computeProgressBreakdown({
      ...schedule,
      plannedCosts,
      estimatedQuantity,
      plannedMaterials,
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

  const [quantityInput, setQuantityInput] = useState(() =>
    toInput(savedToday ? savedToday.quantityCompleted : dailyPlan.quantity)
  );
  const [costInputs, setCostInputs] = useState<Record<CostComponent, string>>(() => {
    const start = savedToday ? savedToday.costs : dailyPlan.costs;
    return {
      labor: toInput(start.labor),
      // Only typed without Material Breakdown lines.
      material: toInput(hasItemizedMaterials ? 0 : start.material),
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
  const typedMaterial = hasItemizedMaterials ? 0 : parseAmount(costInputs.material);
  const materialToday =
    itemizedMaterialCost(plannedMaterials, usedToday) + (typedMaterial ?? 0) + unplannedToday;
  const costs = {
    labor: parseAmount(costInputs.labor),
    material: typedMaterial === null ? null : materialToday,
    equipment: parseAmount(costInputs.equipment),
    other: parseAmount(costInputs.other),
  };

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

  // Same shared function getCostEstimate calls server-side, so this
  // preview always matches what the Gantt chart shows after saving.
  const breakdown = readOnly ? savedStanding : computeProgressBreakdown({
    ...schedule,
    plannedCosts,
    estimatedQuantity,
    plannedMaterials,
    anchor,
    today: new Date(),
  });

  // The listed materials so far (logged days, plus each unlogged day's
  // planned share), each at its unit cost — and what's gone on materials
  // not on the list, today's included.
  const itemizedToDate = itemizedMaterialCost(plannedMaterials, breakdown.materialUsageToDate);
  const unplannedToDate = anchor.cumulativeUnplannedMaterialCost ?? 0;

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

  // The Actual box — the task as saved (savedStanding), not what's typed
  // below; the figures under the inputs follow the typing instead. Its
  // material priced the way the plan's is: with Material Breakdown lines,
  // what's been used of them, plus what's gone on materials not on them.
  const actualToDate = {
    quantity: savedStanding.quantityToDate,
    percent: savedStanding.percentComplete,
    costs: {
      ...savedStanding.costsToDate,
      material: hasItemizedMaterials
        ? itemizedMaterialCost(plannedMaterials, savedStanding.materialUsageToDate) +
          (progressToday.cumulativeUnplannedMaterialCost ?? 0)
        : savedStanding.costsToDate.material,
    },
  };

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
      setError("A material not on the list needs a quantity and unit cost of 0 or more.");
      return;
    }
    if (unplannedMaterials.some((material) => (material.quantity ?? 0) > 0 && !material.name)) {
      setError("Name each material used that isn't on the list.");
      return;
    }

    setPending(true);
    const result = await onSave({
      quantityCompletedToday: quantity,
      costs: {
        labor: costs.labor!,
        // Just the typed part — the server prices what's used itself.
        material: typedMaterial!,
        equipment: costs.equipment!,
        other: costs.other!,
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
    // Equipment records use one scrolling column; editing keeps the
    // form and history side by side on wide screens.
    <div className={`compact-text h-full overflow-y-auto ${readOnly ? "" : "lg:grid lg:grid-cols-[minmax(0,1fr)_28rem] lg:overflow-hidden"}`}>
      {/* Live — follows what's typed below, beside the modal's own title. */}
      {breakdown.scheduleStatus && (
        <ModalHeaderAddon>
          <span
            className={`rounded px-2 py-0.5 text-xs font-semibold ${SCHEDULE_STATUS_STYLE[breakdown.scheduleStatus]}`}
          >
            {SCHEDULE_STATUS_LABEL[breakdown.scheduleStatus]}
          </span>
        </ModalHeaderAddon>
      )}

      {!readOnly && (
        <div className="flex flex-col gap-6 px-6 py-5 lg:overflow-y-auto">
          {/* Today's own record — an override of today. Each field's figure
              is the total with today over planned, live. */}
          <section className="flex flex-col gap-4">
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
              // Amber once the total's past the plan.
              detail={
                estimatedQuantity > 0 ? (
                  <span
                    className={
                      breakdown.quantityToDate > estimatedQuantity ? "font-semibold text-amber-600" : ""
                    }
                  >
                    {formatQuantity(breakdown.quantityToDate)} / {formatQuantity(estimatedQuantity)}
                    {unit ? ` ${unit}` : ""} planned
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
              // Red once the total's over the plan.
              const detail =
                planned > 0 ? (
                  <span className={toDate > planned + 0.005 ? "font-semibold text-red-600" : ""}>
                    {formatPeso(toDate)} / {formatPeso(planned)} planned
                  </span>
                ) : undefined;

              // Itemized material's its own section too (Materials used
              // today) — priced from what's used.
              if (component === "material" && hasItemizedMaterials) return null;

              return (
                <Field
                  key={component}
                  htmlFor={`progress-${component}`}
                  label={COST_LABEL[component]}
                  detail={detail}
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

        {/* Materials used today: each
            line's cost is what's used of it × its unit cost from the
            Material Breakdown, and the day's material cost is their total. */}
        {hasItemizedMaterials && (
          <>
            <EdgeDivider />
            <section className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <h3 className="text-base font-semibold text-zinc-900">Materials used today</h3>
                <span className="text-base font-semibold text-zinc-900 tabular-nums">
                  Material {formatPeso(materialToday)}
                </span>
              </div>

              <div className="overflow-hidden rounded-md border border-zinc-200">
                <div
                  className={`${MATERIAL_COLUMNS} border-b border-zinc-200 bg-zinc-50 py-2 text-xs font-medium text-zinc-500`}
                >
                  <span>Material</span>
                  <span>Quantity</span>
                  <span>Cost</span>
                </div>
                <ul className="divide-y divide-zinc-100">
                  {plannedMaterials.map((material, index) => {
                    // A line without a planned quantity has nothing to count
                    // or price.
                    if (material.plannedQuantity <= 0) return null;
                    const used = breakdown.materialUsageToDate[material.key] ?? 0;
                    const overPlan = used > material.plannedQuantity + 0.005;
                    const unitLabel = material.unit ? ` ${material.unit}` : "";
                    const cost =
                      (usedToday[material.key] ?? 0) *
                      (material.plannedValue / material.plannedQuantity);
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
                        {/* Worked out, not typed — a grayed, read-only box,
                            like each person's cost above. */}
                        <span
                          aria-label={`${material.name} cost today`}
                          className="flex items-center rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm tabular-nums"
                        >
                          <span className={cost > 0 ? "text-zinc-600" : "text-zinc-400"}>
                            {formatPeso(cost)}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>

                {/* Materials used that aren't on the task's own lines —
                    typed, each at its own unit cost; in the day's material
                    cost, but not its progress. */}
                {unplannedRows.length > 0 && (
                  <>
                    <div
                      className={`${UNPLANNED_COLUMNS} border-y border-zinc-200 bg-zinc-50 py-2 text-xs font-medium text-zinc-500`}
                    >
                      <span>Not on the list</span>
                      <span>Unit</span>
                      <span>Quantity</span>
                      <span>Unit cost</span>
                      <span>Cost</span>
                      <span className="sr-only">Remove</span>
                    </div>
                    <ul className="divide-y divide-zinc-100">
                      {unplannedRows.map((row, index) => {
                        const parsed = unplannedMaterials[index];
                        const cost = (parsed.quantity ?? 0) * (parsed.unitCost ?? 0);
                        return (
                          <li key={row.id} className={`${UNPLANNED_COLUMNS} py-2.5 text-sm`}>
                            <input
                              value={row.name}
                              onChange={(e) => renameUnplanned(row, e.target.value)}
                              list="progress-material-suggestions"
                              placeholder="e.g., Common nails"
                              aria-label="Material not on the list"
                              className={CELL_INPUT}
                            />
                            <input
                              value={row.unit}
                              onChange={(e) => updateUnplanned(row.id, { unit: e.target.value })}
                              list="progress-unit-options"
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
                            <AmountInput
                              id={`progress-unplanned-cost-${row.id}`}
                              value={row.unitCost}
                              onChange={(value) => updateUnplanned(row.id, { unitCost: value })}
                              prefix="₱"
                              compact
                            />
                            <span
                              aria-label={`${row.name || "Material"} cost today`}
                              className="flex items-center rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm tabular-nums"
                            >
                              <span className={cost > 0 ? "text-zinc-600" : "text-zinc-400"}>
                                {formatPeso(cost)}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setUnplannedRows((prev) => prev.filter((other) => other.id !== row.id))
                              }
                              aria-label={`Remove ${row.name || "this material"}`}
                              title="Remove"
                              className="flex cursor-pointer items-center justify-center rounded p-1 text-zinc-400 transition hover:bg-red-50 hover:text-red-600"
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

              {/* The estimate's materials and the usual units, suggested
                  as a material not on the list is typed. */}
              <datalist id="progress-material-suggestions">
                {suggestions.map((price) => (
                  <option key={materialKey(price.name, price.unit)} value={price.name}>
                    {`${price.unit ?? "—"} · ${formatPeso(price.unitCost)}`}
                  </option>
                ))}
              </datalist>
              <datalist id="progress-unit-options">
                {UNIT_OPTIONS.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>

              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <button
                  type="button"
                  onClick={addUnplanned}
                  className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-900"
                >
                  <Plus className="size-4" />
                  Add a material not on the list
                </button>
                {/* The materials' total with today (what's used so far of
                    the listed ones, each at its unit cost, and what's gone
                    on ones not on the list) over the listed ones' planned
                    value; red once it's over the plan. */}
                {itemizedPlanned > 0 && (
                  <p
                    className={`text-xs tabular-nums ${
                      itemizedToDate + unplannedToDate > itemizedPlanned + 0.005
                        ? "font-semibold text-red-600"
                        : "text-zinc-500"
                    }`}
                  >
                    {formatPeso(itemizedToDate + unplannedToDate)} / {formatPeso(itemizedPlanned)}{" "}
                    planned
                  </p>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    )}

      {/* The right section: Planned and Actual status cards above,
          followed by the override history below. */}
      <aside className={`history-text flex flex-col gap-4 px-6 ${readOnly ? "py-5" : "border-t border-zinc-200 py-5 lg:overflow-y-auto lg:border-t-0 lg:border-l"}`}>
        {/* The plan so far over where the task actually stands — the same
            parts in the same columns, to read one against the other. */}
        <div className="flex flex-col gap-3">
          {/* The plan so far — each part's planned amount through today,
              from automatic progress, to compare today's log (and the days
              before it) against; Expected progress is the same share.
              Hidden until the task has a Start and End to plan from. */}
          {breakdown.totalWorkingDays !== null && (
            <section aria-label="Planned so far" className="rounded-md border border-sky-200 bg-sky-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="flex items-center gap-2">
                  <ClipboardList aria-hidden className="size-4 text-sky-700" />
                  <span
                    title="The plan so far, through today — from automatic progress."
                    className="rounded-sm bg-white px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 ring-1 ring-sky-200"
                  >
                    Planned
                  </span>
                </span>
                <span
                  title="Expected progress"
                  className="text-base font-bold text-sky-700 tabular-nums"
                >
                  {(breakdown.timePercent ?? 0).toFixed(2)}%
                </span>
              </div>
              {plannedShare === 0 ? (
                <p className="mt-3 text-sm text-zinc-500">No work is planned yet — it hasn&apos;t started.</p>
              ) : (
                <dl className={`mt-4 grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3 ${readOnly ? "lg:grid-cols-5" : ""}`}>
                  <div className="min-w-0">
                    <dt className="truncate text-xs text-zinc-500">Quantity</dt>
                    <dd className="mt-0.5 text-sm font-semibold text-zinc-900 tabular-nums">
                      {formatQuantity(plannedToDate.quantity)}
                      {unit ? ` ${unit}` : ""}
                    </dd>
                  </div>
                  {COST_COMPONENTS.map((component) => (
                    <div key={component} className="min-w-0">
                      <dt className="truncate text-xs text-zinc-500">{COST_LABEL[component]}</dt>
                      <dd className="mt-0.5 text-sm font-semibold text-zinc-900 tabular-nums">
                        {formatPeso(plannedToDate.costs[component])}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          )}

          {/* Where it actually stands, as saved — every saved log, each day
              without one at its planned share; Actual progress is its
              percent complete. Still while today's log is typed below. */}
          <section aria-label="Actual so far" className="rounded-md border border-orange-200 bg-orange-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="flex items-center gap-2">
                <ClipboardCheck aria-hidden className="size-4 text-orange-600" />
                <span
                  title="Where it stands so far, through today — every saved log, each day without one at its planned share."
                  className="rounded-sm bg-white px-1.5 py-0.5 text-[10px] font-semibold text-orange-700 ring-1 ring-orange-200"
                >
                  Actual
                </span>
              </span>
              <span
                title="Actual progress"
                className="text-base font-bold text-orange-600 tabular-nums"
              >
                {actualToDate.percent.toFixed(2)}%
              </span>
            </div>
            <dl className={`mt-4 grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3 ${readOnly ? "lg:grid-cols-5" : ""}`}>
              <div className="min-w-0">
                <dt className="truncate text-xs text-zinc-500">Quantity</dt>
                <dd className="mt-0.5 text-sm font-semibold text-zinc-900 tabular-nums">
                  {formatQuantity(actualToDate.quantity)}
                  {unit ? ` ${unit}` : ""}
                </dd>
              </div>
              {COST_COMPONENTS.map((component) => (
                <div key={component} className="min-w-0">
                  <dt className="truncate text-xs text-zinc-500">{COST_LABEL[component]}</dt>
                  <dd className="mt-0.5 text-sm font-semibold text-zinc-900 tabular-nums">
                    {formatPeso(actualToDate.costs[component])}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </div>

        <EdgeDivider />
        {history.length > 0 ? (
          <OverrideHistory
            key={`${highlightLatest ? "latest" : "date"}:${highlightEntryDate ?? ""}`}
            logs={history}
            loggedDates={progressToday.loggedDates}
            unit={unit}
            highlightLatest={highlightLatest}
            highlightEntryDate={highlightEntryDate}
            onDelete={!readOnly && onDeleteOverride ? askToDelete : undefined}
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

      {/* Along the window's bottom edge, however long it gets. */}
      {!readOnly && <ModalFooter>
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
