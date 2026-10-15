"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Check,
  ChevronDown,
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
import type { Worker } from "@/lib/workers/data";
import { formatHours, weekdayIndex } from "@/lib/workers/schedule";
import {
  COST_COMPONENTS,
  computeDailyPlan,
  computeProgressBreakdown,
  itemizedMaterialCost,
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

// Materials used today's Material | Quantity used | Cost — shared by its
// header and each row.
const MATERIAL_COLUMNS = "grid grid-cols-[minmax(0,1fr)_8rem_7rem] items-center gap-3 px-4";

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
  const missingRate = rows.some(
    (row) => (parseHours(hours[row.worker.id] ?? "") ?? 0) > 0 && row.worker.hourlyRate === null
  );

  // Team member | Hours | Cost — shared by the header and each row.
  const columns = "grid grid-cols-[minmax(0,1fr)_7rem_7rem] items-center gap-3 px-4";

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold text-zinc-900">Who worked today</h3>
        <span className="text-base font-semibold text-zinc-900 tabular-nums">
          Labor {formatPeso(laborToday)}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-200 px-3 py-4 text-center text-sm text-zinc-400">
          Nobody&apos;s assigned yet — add whoever worked today.
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-zinc-200">
          <div
            className={`${columns} border-b border-zinc-200 bg-zinc-50 py-2 text-xs font-medium text-zinc-500`}
          >
            <span>Team member</span>
            <span>Hours</span>
            <span>Cost</span>
          </div>
          <ul className="divide-y divide-zinc-100">
            {rows.map(({ worker, helper }) => {
              const worked = parseHours(hours[worker.id] ?? "");
              const dayOff = (worker.workHours[today] ?? 0) === 0;
              return (
                <li key={worker.id} className={`${columns} py-2.5 text-sm`}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    {/* Their profile — the Team page's own avatar. */}
                    <InitialsAvatar name={worker.fullName} />
                    <div className="min-w-0">
                      <p className="truncate text-zinc-900">
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
                        title="Take off the list"
                        aria-label={`Take ${worker.fullName} off the list`}
                        className="shrink-0 cursor-pointer rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>
                  <div
                    className={`flex items-center rounded-md border bg-white transition focus-within:ring-2 focus-within:ring-zinc-200 ${
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
                      className="w-full min-w-0 bg-transparent py-1.5 pl-2.5 text-sm text-zinc-700 outline-none tabular-nums"
                    />
                    <span className="shrink-0 pr-2.5 pl-1 text-xs text-zinc-400">hrs</span>
                  </div>
                  {/* Worked out, not typed — a grayed, read-only box. */}
                  <span
                    aria-label={`${worker.fullName}'s cost today`}
                    className="flex items-center rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm tabular-nums"
                  >
                    {worker.hourlyRate === null ? (
                      <span className="text-xs text-amber-600">No rate</span>
                    ) : (
                      <span className={(worked ?? 0) > 0 ? "text-zinc-600" : "text-zinc-400"}>
                        {formatPeso(worker.hourlyRate * (worked ?? 0))}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {(addable.length > 0 || laborDetail) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {addable.length > 0 ? (
            <div className="relative w-fit">
              {/* Picking someone adds them as a helper, at today's hours. */}
              <Plus
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-500"
              />
              <select
                value=""
                onChange={(e) => onAdd(Number(e.target.value))}
                aria-label="Add someone who helped"
                className="cursor-pointer appearance-none rounded-md border border-zinc-200 bg-white py-2 pr-9 pl-9 text-sm font-medium text-zinc-700 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
              >
                <option value="" disabled>
                  Add someone who helped
                </option>
                {addable.map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.title ? `${worker.fullName} — ${worker.title}` : worker.fullName}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-zinc-400" />
            </div>
          ) : (
            <span />
          )}
          {laborDetail && <span className="text-xs text-zinc-500 tabular-nums">{laborDetail}</span>}
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

/** One override in full, under its opened card — what was used, who
 * worked (their hours and cost then), and the day's total, for review. */
function OverrideLogDetails({ log }: { log: OverrideLog }) {
  const total = COST_COMPONENTS.reduce((sum, component) => sum + log.costs[component], 0);
  const sections: { title: string; empty: string; rows: [string, string][] }[] = [
    {
      title: "Materials used",
      empty: "None logged",
      rows: log.materialsUsed.map((material) => [
        material.name,
        `${formatQuantity(material.quantity)}${material.unit ? ` ${material.unit}` : ""}`,
      ]),
    },
    {
      title: "Who worked",
      empty: "Nobody logged",
      rows: log.attendance.map((worker) => [
        `${worker.name} · ${formatHours(worker.hours)}`,
        formatPeso(worker.hours * worker.rate),
      ]),
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
      <p className="mt-3 text-sm font-semibold text-zinc-700">No overrides yet</p>
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
      Override history
    </h3>
  );
}

/**
 * The override history — every save of this task's (or phase's) Daily
 * Progress Updates, newest first: who, exactly when, and what was
 * entered. Deleted overrides aren't in it (see listOverrideLogs). The
 * version each day counts now (its newest save, while the day still has
 * its update) is marked Current — and is the one an admin can delete.
 * The newest entry is highlighted (and scrolled to) when the window was
 * opened from a notification.
 */
function OverrideHistory({
  logs,
  loggedDates,
  unit,
  highlight,
  onDelete,
}: {
  logs: OverrideLog[];
  /** Days that still have a saved update. */
  loggedDates: readonly string[];
  unit: string | null;
  highlight: boolean;
  onDelete?: (entryDate: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  // Which cards are open for review — the newest already, when the window
  // was opened from a notification about it.
  const [openIds, setOpenIds] = useState<ReadonlySet<number>>(
    () => new Set(highlight && logs[0] ? [logs[0].id] : [])
  );
  function toggle(id: number) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const newestRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (highlight) newestRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight]);

  const logged = new Set(loggedDates);
  const seenDays = new Set<string>();
  const currentIds = new Set<number>();
  for (const log of logs) {
    if (seenDays.has(log.entryDate)) continue;
    seenDays.add(log.entryDate);
    if (log.action === "saved" && logged.has(log.entryDate)) currentIds.add(log.id);
  }
  const shown = showAll ? logs : logs.slice(0, HISTORY_PREVIEW);

  return (
    <section className="flex flex-col gap-3">
      <HistoryHeading />
      {/* A timeline, newest on top: a marker per save on a line down to
          the next — orange for the one that counts now, gray before it. */}
      <ol className="flex flex-col">
        {shown.map((log, index) => {
          const current = currentIds.has(log.id);
          const highlighted = highlight && index === 0;
          const last = index === shown.length - 1;
          const open = openIds.has(log.id);
          return (
            <li
              key={log.id}
              ref={index === 0 ? newestRef : undefined}
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
                  {current && (
                    <span className="rounded-sm bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                      Current
                    </span>
                  )}
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
      {logs.length > HISTORY_PREVIEW && (
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
  onDeleteOverride,
  loadOverrideHistory,
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
  /** Deletes a day's override — given for admins and super admins only,
   * who then get its Delete. */
  onDeleteOverride?: (entryDate: string) => Promise<ProgressActionResult>;
  /** The override history (every save and delete, 0071), loaded when the
   * window opens. */
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
    if (!deleteDate || !onDeleteOverride) return;
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

  // The override history — null until it's loaded.
  const [history, setHistory] = useState<OverrideLog[] | null>(null);
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
  // nothing's saved for today, so an unsaved day's inputs start from them;
  // saving records what's here instead.
  const [dailyPlan] = useState(() =>
    computeDailyPlan({
      ...schedule,
      plannedCosts,
      estimatedQuantity,
      plannedMaterials,
      date: new Date(),
    })
  );

  // With Material Breakdown lines (ones with a planned quantity), the
  // day's material cost is just the Materials used today table's total —
  // each line's quantity × its unit cost, the way the server prices it on
  // save — like labor from Who worked today. Without any, it's typed.
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
  const materialsUsed = plannedMaterials.map((material) => ({
    key: material.key,
    name: material.name,
    unit: material.unit,
    quantity: parseAmount(materialInputs[material.key] ?? ""),
  }));
  const usedToday: Record<string, number> = {};
  for (const material of materialsUsed) usedToday[material.key] = material.quantity ?? 0;
  // Typed only without Material Breakdown lines —
  // null flags something that isn't a real amount.
  const typedMaterial = hasItemizedMaterials ? 0 : parseAmount(costInputs.material);
  const materialToday = itemizedMaterialCost(plannedMaterials, usedToday) + (typedMaterial ?? 0);
  const costs = {
    labor: laborToday as number | null,
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

  // The listed materials so far (logged days, plus each unlogged day's
  // planned share), each at its unit cost — and today's plan of them.
  const itemizedToDate = itemizedMaterialCost(plannedMaterials, breakdown.materialUsageToDate);
  const plannedMaterialToday = hasItemizedMaterials
    ? itemizedMaterialCost(plannedMaterials, dailyPlan.materials)
    : dailyPlan.costs.material;

  // Nothing planned for today — a day off, a holiday, or outside the
  // task's dates.
  const nothingPlannedToday =
    dailyPlan.quantity === 0 &&
    COST_COMPONENTS.every((component) => dailyPlan.costs[component] === 0);

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
        // Just the typed part — the server prices what's used itself.
        material: typedMaterial!,
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
    // Two columns on a wide screen, each scrolling on its own — the day's
    // log on the left, its override history on the right, a line between
    // them top to bottom; on a narrow one, the history under the log and
    // the whole thing scrolling as one.
    <div className="h-full overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:overflow-hidden">
      <div className="flex flex-col gap-6 px-6 py-5 lg:overflow-y-auto">
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

        {/* Today's plan — today's planned share of each part, from automatic
            progress (what today's log starts from); Expected progress is the
            plan so far, today included. Hidden until the task has a Start
            and End to plan from. */}
        {breakdown.totalWorkingDays !== null && (
          <section aria-label="Today's plan" className="rounded-md border border-sky-200 bg-sky-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="flex items-center gap-2">
                <ClipboardList aria-hidden className="size-4 text-sky-700" />
                <span
                  title="Today's planned share of each part — from automatic progress."
                  className="rounded-sm bg-white px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 ring-1 ring-sky-200"
                >
                  Planned
                </span>
              </span>
              <p className="text-xs text-zinc-500 tabular-nums">
                Expected progress: {(breakdown.timePercent ?? 0).toFixed(2)}%
              </p>
            </div>
            {nothingPlannedToday ? (
              <p className="mt-3 text-sm text-zinc-500">No work is planned for today.</p>
            ) : (
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
                <div className="min-w-0">
                  <dt className="truncate text-xs text-zinc-500">Quantity</dt>
                  <dd className="mt-1 text-lg font-semibold text-zinc-900 tabular-nums">
                    {formatQuantity(dailyPlan.quantity)}
                    {unit ? ` ${unit}` : ""}
                  </dd>
                </div>
                {COST_COMPONENTS.map((component) => (
                  <div key={component} className="min-w-0">
                    <dt className="truncate text-xs text-zinc-500">{COST_LABEL[component]}</dt>
                    <dd className="mt-1 text-lg font-semibold text-zinc-900 tabular-nums">
                      {formatPeso(
                        component === "material" ? plannedMaterialToday : dailyPlan.costs[component]
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        )}

        <EdgeDivider />

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

            {/* Labor's its own section below — who worked, not a typed amount. */}
            {COST_COMPONENTS.filter((component) => component !== "labor").map((component) => {
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
              // today) — priced from what's used, like labor from who worked.
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

        <EdgeDivider />

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

        {/* Materials used today — the same shape as Who worked today: each
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
              </div>

              {/* The listed materials' total with today (what's used so far,
                  each at its unit cost) over their planned value, like
                  labor's; red once it's over the plan. */}
              {itemizedPlanned > 0 && (
                <p
                  className={`self-end text-xs tabular-nums ${
                    itemizedToDate > itemizedPlanned + 0.005
                      ? "font-semibold text-red-600"
                      : "text-zinc-500"
                  }`}
                >
                  {formatPeso(itemizedToDate)} / {formatPeso(itemizedPlanned)} planned
                </p>
              )}
            </section>
          </>
        )}

      </div>

      {/* The override history — its own column: every save, newest first
          (0071) — or, on a database without that yet, just the last
          override as before. */}
      <aside className="flex flex-col gap-4 border-t border-zinc-200 px-6 py-5 lg:overflow-y-auto lg:border-t-0 lg:border-l">
        {history && history.length > 0 ? (
          <OverrideHistory
            logs={history}
            loggedDates={progressToday.loggedDates}
            unit={unit}
            highlight={highlightLatest}
            onDelete={onDeleteOverride ? askToDelete : undefined}
          />
        ) : (
          <section className="flex flex-col gap-3">
            <HistoryHeading />
            {loadOverrideHistory && history === null ? (
              <p className="text-sm text-zinc-400">Loading override history…</p>
            ) : progressToday.latest ? (
              <LastOverride
                latest={progressToday.latest}
                unit={unit}
                plannedMaterials={plannedMaterials}
                highlight={highlightLatest}
                onDelete={
                  onDeleteOverride
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
      {onDeleteOverride && (
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
      <ModalFooter>
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
      </ModalFooter>
    </div>
  );
}
