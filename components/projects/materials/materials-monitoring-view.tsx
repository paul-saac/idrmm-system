"use client";

import { Fragment, useActionState, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  CornerDownRight,
  Eye,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { ViewMenu, type ViewOption } from "@/components/ui/view-menu";
import { MaterialForm } from "@/components/projects/materials/material-form";
import { MaterialRequestEditForm } from "@/components/projects/materials/material-request-edit-form";
import {
  MaterialRequestsTable,
  REQUEST_STATUSES,
} from "@/components/projects/materials/material-requests-table";
import {
  deleteProjectMaterial,
  type MaterialActionState,
} from "@/lib/materials/actions";
import type { MaterialStatus, ProjectMaterial } from "@/lib/materials/data";
import type { MaterialRecord, MaterialRecordStatus } from "@/lib/materials/records";
import type {
  MaterialRequestDetail,
  MaterialRequestStatus,
} from "@/lib/material-requests/data";

/** Which list the Material record shows. */
export type MaterialsRecordView = "materials" | "requests";

// The Material record's two lists — its toolbar's view menu, the same
// one the Gantt chart's Gantt / Calendar uses.
const RECORD_VIEWS: ViewOption<MaterialsRecordView>[] = [
  { value: "materials", label: "Materials" },
  { value: "requests", label: "Material requests" },
];

// Where a material stands against its plan — see MaterialRecordStatus.
const STATUS: Record<MaterialRecordStatus, { label: string; style: string }> = {
  over_plan: { label: "Over plan", style: "bg-red-50 text-red-600" },
  in_use: { label: "In use", style: "bg-sky-50 text-sky-700" },
  not_used: { label: "Not used yet", style: "bg-zinc-100 text-zinc-600" },
  fully_used: { label: "Fully used", style: "bg-emerald-50 text-emerald-700" },
  not_on_list: { label: "Not on the list", style: "bg-orange-50 text-orange-700" },
  stock_only: { label: "Stock only", style: "bg-violet-50 text-violet-700" },
};

// A stock record's own status, in its row's opened section.
const STOCK_STATUS: Record<MaterialStatus, { label: string; style: string }> = {
  available: { label: "Available", style: "text-emerald-600" },
  low_stock: { label: "Low stock", style: "text-amber-600" },
  fully_consumed: { label: "Fully consumed", style: "text-zinc-400" },
};

// An opened row's task breakdown: the task on the left half, then its
// four figures sharing the right half evenly — each centered in its own
// equal column, never narrower than its figures need.
const BREAKDOWN_COLUMNS =
  "grid grid-cols-[minmax(0,4fr)_repeat(4,minmax(8rem,1fr))] items-center gap-3 px-4";

// Compared to the hundredth, the precision quantities are typed to.
const EPSILON = 0.005;

/** A quantity — the number bold, its unit after it in gray. */
function Quantity({
  value,
  unit,
  tone = "text-zinc-900",
}: {
  value: number;
  unit: string | null;
  tone?: string;
}) {
  return (
    <span className="whitespace-nowrap tabular-nums">
      <span className={`font-semibold ${tone}`}>
        {value.toLocaleString("en-PH", { maximumFractionDigits: 2 })}
      </span>
      {unit && <span className="text-zinc-400"> {unit}</span>}
    </span>
  );
}

function formatPeso(value: number) {
  return `₱${value.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

/** Spent over budget — spent bold (red once over), the budget in gray. */
function SpentOfBudget({ spent, budget }: { spent: number; budget: number }) {
  if (spent <= 0 && budget <= 0) return <span className="text-zinc-300">—</span>;
  const over = budget > 0 && spent > budget + 0.5;
  return (
    <span className="whitespace-nowrap tabular-nums">
      <span className={`font-semibold ${over ? "text-red-600" : "text-zinc-900"}`}>
        {formatPeso(spent)}
      </span>
      {budget > 0 && <span className="text-zinc-400"> / {formatPeso(budget)}</span>}
    </span>
  );
}

/** "Oct 17, 2026" — from a day (YYYY-MM-DD). */
function formatDay(day: string) {
  return new Date(`${day}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const Dash = () => <span className="text-zinc-300">—</span>;

const deleteInitialState: MaterialActionState = {};

function DeleteMaterialButton({
  materialId,
  projectId,
  materialName,
}: {
  materialId: number;
  projectId: number;
  materialName: string;
}) {
  const boundAction = deleteProjectMaterial.bind(null, materialId, projectId);
  const [state, formAction, pending] = useActionState(
    boundAction,
    deleteInitialState
  );

  return (
    <span className="relative inline-flex">
      <form
        action={formAction}
        onSubmit={(e) => {
          if (!window.confirm(`Delete "${materialName}"? This cannot be undone.`)) {
            e.preventDefault();
          }
        }}
      >
        <button
          type="submit"
          disabled={pending}
          aria-label="Delete stock record"
          title="Delete stock record"
          className="cursor-pointer rounded p-1.5 text-zinc-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Trash2 className="size-3.5" />
        </button>
      </form>
      {state?.error && (
        <span
          role="alert"
          className="absolute top-full right-0 z-10 mt-1 w-48 rounded-md border border-red-200 bg-white px-2 py-1 text-right text-xs font-normal text-red-600 shadow-sm"
        >
          {state.error}
        </span>
      )}
    </span>
  );
}

/** Where a material is — its first task (or phase), and how many more;
 * a stock record's code when it's only that. */
function whereLabel(record: MaterialRecord) {
  if (record.items.length > 0) {
    const more = record.items.length - 1;
    return `${record.items[0].name}${more > 0 ? ` +${more} more` : ""}`;
  }
  return record.stock.map((material) => material.materialCode).join(", ") || "—";
}

/**
 * The Materials tab's Material record: every material the project has,
 * each once (buildMaterialRecords) — what's planned of it across the
 * estimate, what's been logged as used in progress, what's left, what it
 * cost against its budget, where it stands, and when it was last used. A
 * row opens to its task breakdown — each task (or task-less phase) it's
 * planned or used on — and any stock record of it (Add Material), viewed,
 * edited and deleted there.
 *
 * Its view menu switches it to the project's material requests instead —
 * every one, searchable and filtered by status, each opening in its row
 * to the request in full — with Request Material in place of Add Material.
 */
export function MaterialsMonitoringView({
  projectId,
  records,
  view,
  onViewChange,
  requests,
  openRequestIds,
  onToggleRequest,
  currentUserName,
}: {
  projectId: number;
  records: MaterialRecord[];
  /** Which list it shows — the parent's, so the Material overview's See
   * all can switch it to the requests. */
  view: MaterialsRecordView;
  onViewChange: (view: MaterialsRecordView) => void;
  requests: MaterialRequestDetail[];
  /** The requests opened to their details — the parent's, so they stay
   * open across switching lists, and the Material overview can open one. */
  openRequestIds: ReadonlySet<number>;
  onToggleRequest: (requestId: number) => void;
  /** Shown as Requested By on a new request. */
  currentUserName: string;
}) {
  const [statusFilter, setStatusFilter] = useState<MaterialRecordStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [ascending, setAscending] = useState(true);
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [formModal, setFormModal] = useState<
    { mode: "add" } | { mode: "edit"; material: ProjectMaterial } | null
  >(null);
  // The Material requests view's own search and status filter.
  const [requestQuery, setRequestQuery] = useState("");
  const [requestStatus, setRequestStatus] = useState<MaterialRequestStatus | "all">("all");
  const [requestOpen, setRequestOpen] = useState(false);

  // Switching lists keeps the section at least as tall as it just was —
  // a shorter list would otherwise shrink the page under the scroll, and
  // the browser would pull the view up to keep within it.
  const rootRef = useRef<HTMLDivElement>(null);
  const [heldHeight, setHeldHeight] = useState<number | undefined>(undefined);
  function switchView(next: MaterialsRecordView) {
    if (next === view) return;
    setHeldHeight(rootRef.current?.offsetHeight);
    onViewChange(next);
  }

  // Newest first; by status, and by MR number or who asked.
  const requestsShown = useMemo(() => {
    const q = requestQuery.trim().toLowerCase();
    return [...requests]
      .sort((a, b) => b.requestDate.localeCompare(a.requestDate))
      .filter((request) => {
        if (requestStatus !== "all" && request.status !== requestStatus) return false;
        if (!q) return true;
        return (
          request.mrNo.toLowerCase().includes(q) ||
          request.requestedByName.toLowerCase().includes(q)
        );
      });
  }, [requests, requestQuery, requestStatus]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = records.filter((record) => {
      if (statusFilter !== "all" && record.status !== statusFilter) return false;
      if (!q) return true;
      return (
        record.name.toLowerCase().includes(q) ||
        record.items.some((item) => item.name.toLowerCase().includes(q)) ||
        record.stock.some((material) => material.materialCode.toLowerCase().includes(q))
      );
    });
    // records come alphabetical already.
    return ascending ? matches : [...matches].reverse();
  }, [records, statusFilter, query, ascending]);

  const overPlan = records.filter((record) => record.status === "over_plan").length;
  const notOnList = records.filter((record) => record.status === "not_on_list").length;
  const expandable = (record: MaterialRecord) =>
    record.items.length > 0 || record.stock.length > 0;
  const anyOpen = filtered.some((record) => openKeys.has(record.key));

  function toggle(key: string) {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div
      ref={rootRef}
      className="flex flex-col gap-3"
      style={heldHeight ? { minHeight: heldHeight } : undefined}
    >
      {/* The section's header, like the Gantt chart's Project schedule:
          its name, the open list's counts, and that list's own add —
          Add Material, or Request Material. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <h2 className="text-base font-semibold text-zinc-900">Material record</h2>
          {view === "materials" ? (
            <span className="text-xs text-zinc-400">
              {records.length} {records.length === 1 ? "material" : "materials"}
              {overPlan > 0 && (
                <span className="font-medium text-red-600"> · {overPlan} over plan</span>
              )}
              {notOnList > 0 && ` · ${notOnList} not on the list`}
            </span>
          ) : (
            <span className="text-xs text-zinc-400">
              {requests.length} {requests.length === 1 ? "request" : "requests"}
            </span>
          )}
        </div>
        {view === "materials" ? (
          <button
            type="button"
            onClick={() => setFormModal({ mode: "add" })}
            title="Add a stock record"
            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800"
          >
            <Plus className="size-4" />
            Add Material
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setRequestOpen(true)}
            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800"
          >
            <Plus className="size-4" />
            Request Material
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        {/* The view menu, then search and the status filter, on the left;
            open or close every row on the right (Materials). */}
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-3">
          <ViewMenu views={RECORD_VIEWS} value={view} onChange={switchView} />
          {view === "requests" ? (
            <>
              <div className="relative w-full max-w-xs">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400"
                />
                <input
                  type="text"
                  value={requestQuery}
                  onChange={(e) => setRequestQuery(e.target.value)}
                  placeholder="Search MR number or requester..."
                  aria-label="Search material requests"
                  className="w-full rounded-md border border-zinc-200 bg-white py-2 pr-3 pl-9 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
                />
              </div>
              <div className="relative">
                <select
                  aria-label="Filter by status"
                  value={requestStatus}
                  onChange={(e) => setRequestStatus(e.target.value as MaterialRequestStatus | "all")}
                  className="cursor-pointer appearance-none rounded-md border border-zinc-200 bg-white py-2 pr-9 pl-3 text-sm text-zinc-700 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
                >
                  <option value="all">All statuses</option>
                  {REQUEST_STATUSES.map((status) => (
                    <option key={status.status} value={status.status}>
                      {status.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-zinc-500"
                />
              </div>
            </>
          ) : (
            <>
          <div className="relative w-full max-w-xs">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search material, task or code..."
              aria-label="Search materials"
              className="w-full rounded-md border border-zinc-200 bg-white py-2 pr-3 pl-9 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
            />
          </div>
          <div className="relative">
            <select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as MaterialRecordStatus | "all")}
              className="cursor-pointer appearance-none rounded-md border border-zinc-200 bg-white py-2 pr-9 pl-3 text-sm text-zinc-700 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
            >
              <option value="all">All statuses</option>
              {(Object.keys(STATUS) as MaterialRecordStatus[]).map((status) => (
                <option key={status} value={status}>
                  {STATUS[status].label}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-zinc-500"
            />
          </div>
          <button
            type="button"
            onClick={() =>
              setOpenKeys(
                anyOpen
                  ? new Set()
                  : new Set(filtered.filter(expandable).map((record) => record.key))
              )
            }
            className="ml-auto flex cursor-pointer items-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900"
          >
            {anyOpen ? <ChevronsUp className="size-4" /> : <ChevronsDown className="size-4" />}
            {anyOpen ? "Collapse all" : "Expand all"}
          </button>
            </>
          )}
        </div>

        {view === "requests" ? (
          requestsShown.length === 0 ? (
            <p className="py-10 text-center text-sm text-zinc-400">
              {requests.length === 0
                ? "No material requests yet."
                : "No material requests match your filters."}
            </p>
          ) : (
            <MaterialRequestsTable
              requests={requestsShown}
              openIds={openRequestIds}
              onToggle={onToggleRequest}
              topBorder={false}
            />
          )
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-zinc-400">
            {records.length === 0
              ? "No materials yet — they show here once they're planned in a task's Material Breakdown, used in its progress, or added as stock."
              : "No materials match your filters."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[60rem] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-500">
                <tr>
                  <th className="px-5 py-3">
                    <button
                      type="button"
                      onClick={() => setAscending((value) => !value)}
                      className="flex cursor-pointer items-center gap-1 font-semibold text-zinc-700 transition hover:text-zinc-900"
                    >
                      Material
                      {ascending ? (
                        <ArrowDown aria-label="A to Z" className="size-3.5" />
                      ) : (
                        <ArrowUp aria-label="Z to A" className="size-3.5" />
                      )}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-center">Planned</th>
                  <th className="px-4 py-3 text-center">Used</th>
                  <th className="px-4 py-3 text-center">Remaining</th>
                  <th className="px-4 py-3 text-center">Spent / Budget</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Last used</th>
                  <th className="w-14 py-3 pr-5">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filtered.map((record) => {
                  const open = openKeys.has(record.key);
                  const canOpen = expandable(record);
                  const remaining = record.planned - record.used;
                  return (
                    <Fragment key={record.key}>
                      {/* Opened, it stays white (no hover gray either), with
                          no line between it and its dropdown — a line along
                          its top instead, setting each opened one apart from
                          what's above it. On its cells: where rows meet, a
                          cell's line is drawn over the row above's own. */}
                      <tr
                        onClick={canOpen ? () => toggle(record.key) : undefined}
                        className={`transition-colors ${canOpen ? "cursor-pointer" : ""} ${
                          open
                            ? "border-b-0 [&>td]:border-t [&>td]:border-zinc-200"
                            : "hover:bg-zinc-50"
                        }`}
                      >
                        <td className="max-w-80 px-5 py-3.5">
                          <p className="truncate font-semibold text-zinc-900" title={record.name}>
                            {record.name}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-zinc-400" title={whereLabel(record)}>
                            {whereLabel(record)}
                          </p>
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          {record.planned > 0 ? (
                            <Quantity value={record.planned} unit={record.unit} />
                          ) : (
                            <Dash />
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          {record.used > 0 ? (
                            <Quantity
                              value={record.used}
                              unit={record.unit}
                              tone={record.status === "over_plan" ? "text-red-600" : "text-zinc-900"}
                            />
                          ) : (
                            <Dash />
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          {record.planned <= 0 ? (
                            <Dash />
                          ) : remaining < -EPSILON ? (
                            <span className="whitespace-nowrap font-semibold text-red-600 tabular-nums">
                              {(-remaining).toLocaleString("en-PH", { maximumFractionDigits: 2 })}
                              {record.unit ? ` ${record.unit}` : ""} over
                            </span>
                          ) : (
                            <Quantity value={Math.max(0, remaining)} unit={record.unit} />
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <SpentOfBudget spent={record.spent} budget={record.budget} />
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className={`rounded-sm px-2 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS[record.status].style}`}
                          >
                            {STATUS[record.status].label}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap text-zinc-600">
                          {record.lastUsed ? formatDay(record.lastUsed) : <Dash />}
                        </td>
                        {/* The row's dropdown arrow, at its right end. */}
                        <td className="py-3.5 pr-5">
                          {canOpen && (
                            <span
                              aria-hidden
                              className={`ml-auto flex size-7 items-center justify-center rounded transition ${
                                open ? "text-[var(--material-dropdown-accent)]" : "text-zinc-400"
                              }`}
                            >
                              <ChevronDown
                                className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
                              />
                            </span>
                          )}
                        </td>
                      </tr>

                      {/* Its task breakdown — each task (or task-less phase)
                          it's planned or used on — then any stock record. */}
                      {/* Light green with its opened row (the
                          --material-dropdown colors in globals.css), so
                          it reads apart from the rows. */}
                      {open && (
                        <tr className="bg-[var(--material-dropdown)]">
                          <td colSpan={8} className="px-5 pb-4">
                            <div className="flex flex-col gap-3 border-l-2 border-[var(--material-dropdown-line)] pt-4 pl-4">
                              {record.items.length > 0 && (
                                <div className="flex flex-col gap-2">
                                  <p className="text-[11px] font-semibold tracking-wider text-[var(--material-dropdown-accent)] uppercase">
                                    Task breakdown
                                    <span className="font-normal tracking-normal text-zinc-400 normal-case">
                                      {" "}
                                      · {record.items.length}{" "}
                                      {record.items.length === 1 ? "task" : "tasks"}
                                    </span>
                                  </p>
                                  <div className="overflow-hidden rounded-md border border-zinc-200">
                                    <div
                                      className={`${BREAKDOWN_COLUMNS} border-b border-zinc-200 bg-[var(--material-dropdown-header)] py-2 text-xs font-medium text-zinc-600`}
                                    >
                                      <span>Task</span>
                                      <span className="text-center">Planned</span>
                                      <span className="text-center">Used</span>
                                      <span className="text-center">Spent / Budget</span>
                                      <span className="text-center">Last used</span>
                                    </div>
                                    {record.items.map((item) => {
                                      const itemOver =
                                        item.planned > 0 && item.used > item.planned + EPSILON;
                                      return (
                                        <div
                                          key={item.key}
                                          className={`${BREAKDOWN_COLUMNS} border-b border-zinc-200/70 bg-[var(--material-dropdown-row)] py-2.5 last:border-b-0`}
                                        >
                                          <span className="flex min-w-0 items-center gap-2">
                                            <CornerDownRight
                                              aria-hidden
                                              className="size-3.5 shrink-0 text-[var(--material-dropdown-accent)]"
                                            />
                                            <span className="truncate text-zinc-700" title={item.name}>
                                              {item.name}
                                            </span>
                                            {item.planned <= 0 && item.used > 0 && (
                                              <span className="shrink-0 rounded-sm bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700">
                                                Not on the list
                                              </span>
                                            )}
                                          </span>
                                          <span className="text-center">
                                            {item.planned > 0 ? (
                                              <Quantity value={item.planned} unit={record.unit} />
                                            ) : (
                                              <Dash />
                                            )}
                                          </span>
                                          <span className="text-center">
                                            {item.used > 0 ? (
                                              <Quantity
                                                value={item.used}
                                                unit={record.unit}
                                                tone={itemOver ? "text-red-600" : "text-zinc-900"}
                                              />
                                            ) : (
                                              <Dash />
                                            )}
                                          </span>
                                          <span className="text-center">
                                            <SpentOfBudget spent={item.spent} budget={item.budget} />
                                          </span>
                                          <span className="text-center whitespace-nowrap text-zinc-600">
                                            {item.lastUsed ? formatDay(item.lastUsed) : <Dash />}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {record.stock.length > 0 && (
                                <div className="flex flex-col gap-2">
                                  <p className="text-[11px] font-semibold tracking-wider text-[var(--material-dropdown-accent)] uppercase">
                                    Stock record
                                  </p>
                                  <div className="overflow-hidden rounded-md border border-zinc-200">
                                    {record.stock.map((material) => (
                                      <div
                                        key={material.id}
                                        onClick={(e) => e.stopPropagation()}
                                        className="flex items-center gap-4 border-b border-zinc-200/70 bg-[var(--material-dropdown-row)] px-4 py-2 last:border-b-0"
                                      >
                                        <span className="font-medium text-zinc-700">
                                          {material.materialCode}
                                        </span>
                                        <Quantity value={material.quantity} unit={material.unit} />
                                        <span className={`text-xs ${STOCK_STATUS[material.status].style}`}>
                                          {STOCK_STATUS[material.status].label}
                                        </span>
                                        <span className="ml-auto flex items-center gap-1">
                                          <button
                                            type="button"
                                            onClick={() => setFormModal({ mode: "edit", material })}
                                            aria-label="View stock record"
                                            title="View stock record"
                                            className="cursor-pointer rounded p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
                                          >
                                            <Eye className="size-3.5" />
                                          </button>
                                          <DeleteMaterialButton
                                            materialId={material.id}
                                            projectId={projectId}
                                            materialName={material.materialName}
                                          />
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="border-t border-zinc-200 px-5 py-3 text-xs text-zinc-500">
          {view === "requests" ? (
            <>
              Showing <span className="font-semibold text-zinc-700">{requestsShown.length}</span>{" "}
              of <span className="font-semibold text-zinc-700">{requests.length}</span>{" "}
              {requests.length === 1 ? "request" : "requests"}
            </>
          ) : (
            <>
              Showing <span className="font-semibold text-zinc-700">{filtered.length}</span> of{" "}
              <span className="font-semibold text-zinc-700">{records.length}</span>{" "}
              {records.length === 1 ? "material" : "materials"}
            </>
          )}
        </div>
      </div>

      <Modal
        open={formModal !== null}
        onClose={() => setFormModal(null)}
        title={formModal?.mode === "edit" ? "Edit Material" : "Add Material"}
      >
        <MaterialForm
          // Modal always keeps its children mounted (it only toggles the
          // native <dialog>'s open state), so without a key tied to the
          // record being edited, MaterialForm would never remount and
          // its Unit dropdown — a controlled input via useState, unlike
          // the other fields' plain defaultValue — would stay stuck on
          // whatever material (or none) was selected when it first
          // mounted instead of updating per edit target.
          key={formModal?.mode === "edit" ? formModal.material.id : "add"}
          projectId={projectId}
          material={formModal?.mode === "edit" ? formModal.material : undefined}
          onSuccess={() => setFormModal(null)}
        />
      </Modal>

      <MaterialRequestEditForm
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        projectId={projectId}
        currentUserName={currentUserName}
        onSuccess={() => setRequestOpen(false)}
      />
    </div>
  );
}
