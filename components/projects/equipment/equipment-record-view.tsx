"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  CornerDownRight,
  Plus,
  Search,
} from "lucide-react";
import { ViewMenu, type ViewOption } from "@/components/ui/view-menu";
import { EquipmentRequestEditForm } from "@/components/projects/equipment/equipment-request-edit-form";
import {
  EQUIPMENT_REQUEST_STATUSES,
  EquipmentRequestsTable,
} from "@/components/projects/equipment/equipment-requests-table";
import { AssignedEquipmentTable } from "@/components/projects/equipment/project-equipment-view";
import type { EquipmentAssignmentRow } from "@/lib/equipment/data";
import type { EquipmentCostRecord, EquipmentCostStatus } from "@/lib/equipment/records";
import type {
  EquipmentRequestDetail,
  EquipmentRequestStatus,
} from "@/lib/equipment-requests/data";

/** Which list the Equipment record shows. */
export type EquipmentRecordList = "cost" | "assigned" | "requests";

// The Equipment record's three lists — its toolbar's view menu, the same
// one the Material record's Materials / Material requests uses.
const RECORD_VIEWS: ViewOption<EquipmentRecordList>[] = [
  { value: "cost", label: "Equipment cost" },
  { value: "assigned", label: "Assigned equipment" },
  { value: "requests", label: "Equipment requests" },
];

// Where a task's equipment spend stands — see equipmentCostStatus.
export const EQUIPMENT_COST_STATUS: Record<
  EquipmentCostStatus,
  { label: string; style: string }
> = {
  over_budget: { label: "Over plan", style: "bg-red-50 text-red-600" },
  spending_ahead: { label: "Spending ahead", style: "bg-amber-50 text-amber-700" },
  within_budget: { label: "Within plan", style: "bg-emerald-50 text-emerald-700" },
  not_budgeted: { label: "Not planned", style: "bg-orange-50 text-orange-700" },
};

// An opened row's cost log: the day, who saved it, then its amount.
const LOG_COLUMNS = "grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)_10rem] items-center gap-3 px-4";

const SELECT =
  "cursor-pointer appearance-none rounded-md border border-zinc-200 bg-white py-2 pr-9 pl-3 text-sm text-zinc-700 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200";

function formatPeso(value: number) {
  return `₱${value.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
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

/** A status filter's select, its arrow over its right end. */
function StatusSelect<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T | "all";
  onChange: (value: T | "all") => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        aria-label="Filter by status"
        value={value}
        onChange={(e) => onChange(e.target.value as T | "all")}
        className={SELECT}
      >
        <option value="all">All statuses</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-zinc-500"
      />
    </div>
  );
}

/** A toolbar's search box. */
function SearchBox({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="relative w-full max-w-xs">
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="w-full rounded-md border border-zinc-200 bg-white py-2 pr-3 pl-9 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
      />
    </div>
  );
}

/**
 * The Equipment tab's Equipment record — the Material record's twin, its
 * view menu switching between three lists:
 *
 * Equipment cost: every task (and task-less phase) with an equipment
 * budget or a saved equipment-cost override — its budget, the costs saved
 * in its Progress Tracking Overrides, what's left, budget used against
 * work done, where it stands, and when a cost was last logged. A row opens
 * to its cost log.
 *
 * Assigned equipment: the Inventory's equipment this project has had (see
 * AssignedEquipmentTable). Equipment requests: every request, each opening
 * in its row (EquipmentRequestsTable), with Request Equipment.
 */
export function EquipmentRecordView({
  projectId,
  costRecords,
  assignments,
  requests,
  view,
  onViewChange,
  openRequestIds,
  onToggleRequest,
  currentUserName,
}: {
  projectId: number;
  costRecords: EquipmentCostRecord[];
  assignments: EquipmentAssignmentRow[];
  requests: EquipmentRequestDetail[];
  /** Which list it shows — the parent's, so the Equipment overview's See
   * all can switch it to the requests. */
  view: EquipmentRecordList;
  onViewChange: (view: EquipmentRecordList) => void;
  /** The requests opened to their details — the parent's, so they stay
   * open across switching lists, and the Equipment overview can open one. */
  openRequestIds: ReadonlySet<number>;
  onToggleRequest: (requestId: number) => void;
  /** Shown as Requested By on a new request. */
  currentUserName: string;
}) {
  // Each list's own search and status filter.
  const [costQuery, setCostQuery] = useState("");
  const [costStatus, setCostStatus] = useState<EquipmentCostStatus | "all">("all");
  const [openCostKeys, setOpenCostKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [assignedQuery, setAssignedQuery] = useState("");
  const [assignedStatus, setAssignedStatus] = useState<"on_site" | "returned" | "all">("all");
  const [requestQuery, setRequestQuery] = useState("");
  const [requestStatus, setRequestStatus] = useState<EquipmentRequestStatus | "all">("all");
  const [requestOpen, setRequestOpen] = useState(false);

  // Switching lists keeps the section at least as tall as it just was —
  // a shorter list would otherwise shrink the page under the scroll, and
  // the browser would pull the view up to keep within it.
  const rootRef = useRef<HTMLDivElement>(null);
  const [heldHeight, setHeldHeight] = useState<number | undefined>(undefined);
  function switchView(next: EquipmentRecordList) {
    if (next === view) return;
    setHeldHeight(rootRef.current?.offsetHeight);
    onViewChange(next);
  }

  const costShown = useMemo(() => {
    const q = costQuery.trim().toLowerCase();
    return costRecords.filter((record) => {
      if (costStatus !== "all" && record.status !== costStatus) return false;
      return !q || record.name.toLowerCase().includes(q);
    });
  }, [costRecords, costQuery, costStatus]);

  const assignedShown = useMemo(() => {
    const q = assignedQuery.trim().toLowerCase();
    return assignments.filter((assignment) => {
      const onSite = !assignment.returnedAt;
      if (assignedStatus === "on_site" && !onSite) return false;
      if (assignedStatus === "returned" && onSite) return false;
      return (
        !q ||
        assignment.equipmentName.toLowerCase().includes(q) ||
        assignment.equipmentAssetTag.toLowerCase().includes(q)
      );
    });
  }, [assignments, assignedQuery, assignedStatus]);

  // Newest first; by status, and by ER number or who asked.
  const requestsShown = useMemo(() => {
    const q = requestQuery.trim().toLowerCase();
    return [...requests]
      .sort((a, b) => b.requestDate.localeCompare(a.requestDate))
      .filter((request) => {
        if (requestStatus !== "all" && request.status !== requestStatus) return false;
        if (!q) return true;
        return (
          request.erNo.toLowerCase().includes(q) ||
          request.requestedByName.toLowerCase().includes(q)
        );
      });
  }, [requests, requestQuery, requestStatus]);

  const spendingAhead = costRecords.filter((r) => r.status === "spending_ahead").length;
  const overBudget = costRecords.filter((r) => r.status === "over_budget").length;
  const onSiteCount = assignments.filter((a) => !a.returnedAt).length;
  const returnedCount = assignments.length - onSiteCount;
  const expandable = (record: EquipmentCostRecord) => record.entries.length > 0;
  const anyCostOpen = costShown.some((record) => openCostKeys.has(record.key));

  function toggleCost(key: string) {
    setOpenCostKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // The footer's "Showing X of Y", per list.
  const footer =
    view === "cost"
      ? { shown: costShown.length, total: costRecords.length, noun: ["task", "tasks"] }
      : view === "assigned"
        ? { shown: assignedShown.length, total: assignments.length, noun: ["equipment", "equipment"] }
        : { shown: requestsShown.length, total: requests.length, noun: ["request", "requests"] };

  return (
    <div
      ref={rootRef}
      className="flex flex-col gap-3"
      style={heldHeight ? { minHeight: heldHeight } : undefined}
    >
      {/* The section's header, like the Material record's: its name, the
          open list's counts, and — for the requests — Request Equipment. */}
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <h2 className="text-base font-semibold text-zinc-900">Equipment record</h2>
          {view === "cost" ? (
            <span className="text-xs text-zinc-400">
              {costRecords.length} {costRecords.length === 1 ? "task" : "tasks"}
              {spendingAhead > 0 && (
                <span className="font-medium text-amber-700"> · {spendingAhead} spending ahead</span>
              )}
              {overBudget > 0 && (
                <span className="font-medium text-red-600"> · {overBudget} over plan</span>
              )}
            </span>
          ) : view === "assigned" ? (
            <span className="text-xs text-zinc-400">
              {onSiteCount} on site
              {returnedCount > 0 && ` · ${returnedCount} returned`}
            </span>
          ) : (
            <span className="text-xs text-zinc-400">
              {requests.length} {requests.length === 1 ? "request" : "requests"}
            </span>
          )}
        </div>
        {view === "requests" && (
          <button
            type="button"
            onClick={() => setRequestOpen(true)}
            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800"
          >
            <Plus className="size-4" />
            Request Equipment
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        {/* The view menu, then the open list's search and status filter;
            open or close every row on the right (Equipment cost). */}
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-3">
          <ViewMenu views={RECORD_VIEWS} value={view} onChange={switchView} />
          {view === "cost" ? (
            <>
              <SearchBox
                value={costQuery}
                onChange={setCostQuery}
                placeholder="Search task or phase..."
                label="Search equipment cost"
              />
              <StatusSelect
                value={costStatus}
                onChange={setCostStatus}
                options={(Object.keys(EQUIPMENT_COST_STATUS) as EquipmentCostStatus[]).map(
                  (status) => ({ value: status, label: EQUIPMENT_COST_STATUS[status].label })
                )}
              />
              <button
                type="button"
                onClick={() =>
                  setOpenCostKeys(
                    anyCostOpen
                      ? new Set()
                      : new Set(costShown.filter(expandable).map((record) => record.key))
                  )
                }
                className="ml-auto flex cursor-pointer items-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900"
              >
                {anyCostOpen ? <ChevronsUp className="size-4" /> : <ChevronsDown className="size-4" />}
                {anyCostOpen ? "Collapse all" : "Expand all"}
              </button>
            </>
          ) : view === "assigned" ? (
            <>
              <SearchBox
                value={assignedQuery}
                onChange={setAssignedQuery}
                placeholder="Search equipment or asset tag..."
                label="Search assigned equipment"
              />
              <StatusSelect
                value={assignedStatus}
                onChange={setAssignedStatus}
                options={[
                  { value: "on_site", label: "On site" },
                  { value: "returned", label: "Returned" },
                ]}
              />
            </>
          ) : (
            <>
              <SearchBox
                value={requestQuery}
                onChange={setRequestQuery}
                placeholder="Search ER number or requester..."
                label="Search equipment requests"
              />
              <StatusSelect
                value={requestStatus}
                onChange={setRequestStatus}
                options={EQUIPMENT_REQUEST_STATUSES.map((status) => ({
                  value: status.status,
                  label: status.label,
                }))}
              />
            </>
          )}
        </div>

        {view === "requests" ? (
          requestsShown.length === 0 ? (
            <p className="py-10 text-center text-sm text-zinc-400">
              {requests.length === 0
                ? "No equipment requests yet."
                : "No equipment requests match your filters."}
            </p>
          ) : (
            <EquipmentRequestsTable
              requests={requestsShown}
              openIds={openRequestIds}
              onToggle={onToggleRequest}
              topBorder={false}
            />
          )
        ) : view === "assigned" ? (
          assignedShown.length === 0 ? (
            <p className="py-10 text-center text-sm text-zinc-400">
              {assignments.length === 0
                ? "No equipment assigned yet — it's assigned from the Inventory page."
                : "No equipment matches your filters."}
            </p>
          ) : (
            <AssignedEquipmentTable projectId={projectId} assignments={assignedShown} />
          )
        ) : costShown.length === 0 ? (
          <p className="py-10 text-center text-sm text-zinc-400">
            {costRecords.length === 0
              ? "No equipment cost yet — it shows here once a task has a planned equipment cost, or equipment cost in its progress."
              : "No tasks match your filters."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[60rem] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-500">
                <tr>
                  <th className="px-5 py-3">Task</th>
                  <th className="px-4 py-3 text-center">Planned</th>
                  <th className="px-4 py-3 text-center">Spent</th>
                  <th className="px-4 py-3 text-center">Remaining</th>
                  <th className="px-4 py-3 text-center">Used / Done</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Last logged</th>
                  <th className="w-14 py-3 pr-5">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {costShown.map((record) => {
                  const open = openCostKeys.has(record.key);
                  const canOpen = expandable(record);
                  const remaining = record.budget - record.spent;
                  const status = EQUIPMENT_COST_STATUS[record.status];
                  const usedTone =
                    record.status === "over_budget"
                      ? "text-red-600"
                      : record.status === "spending_ahead"
                        ? "text-amber-700"
                        : "text-zinc-900";
                  return (
                    <Fragment key={record.key}>
                      {/* Opened, it stays white (no hover gray either), with
                          no line between it and its dropdown — a line along
                          its top instead, setting each opened one apart from
                          what's above it. On its cells: where rows meet, a
                          cell's line is drawn over the row above's own. */}
                      <tr
                        onClick={canOpen ? () => toggleCost(record.key) : undefined}
                        className={`transition-colors ${canOpen ? "cursor-pointer" : ""} ${
                          open
                            ? "border-b-0 [&>td]:border-t [&>td]:border-zinc-200"
                            : "hover:bg-zinc-50"
                        }`}
                      >
                        <td className="max-w-80 px-5 py-3.5">
                          <p className="truncate font-semibold text-zinc-900" title={record.title}>
                            {record.title}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-zinc-400" title={record.phase ?? undefined}>
                            {record.phase ?? "Phase"}
                          </p>
                        </td>
                        <td className="px-4 py-3.5 text-center font-semibold whitespace-nowrap text-zinc-900 tabular-nums">
                          {record.budget > 0 ? formatPeso(record.budget) : <Dash />}
                        </td>
                        <td
                          className={`px-4 py-3.5 text-center font-semibold whitespace-nowrap tabular-nums ${
                            record.status === "over_budget" ? "text-red-600" : "text-zinc-900"
                          }`}
                        >
                          {record.spent > 0.005 ? formatPeso(record.spent) : <Dash />}
                        </td>
                        <td className="px-4 py-3.5 text-center whitespace-nowrap tabular-nums">
                          {record.budget <= 0 ? (
                            <Dash />
                          ) : remaining < -0.5 ? (
                            <span className="font-semibold text-red-600">
                              {formatPeso(-remaining)} over
                            </span>
                          ) : (
                            <span className="font-semibold text-zinc-900">
                              {formatPeso(Math.max(0, remaining))}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-center whitespace-nowrap tabular-nums">
                          {record.percentUsed === null ? (
                            <Dash />
                          ) : (
                            <>
                              <span className={`font-semibold ${usedTone}`}>
                                {formatPercent(record.percentUsed)}
                              </span>
                              <span className="text-zinc-400">
                                {" "}
                                / {formatPercent(record.percentDone)}
                              </span>
                            </>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className={`rounded-sm px-2 py-0.5 text-xs font-medium whitespace-nowrap ${status.style}`}
                          >
                            {status.label}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap text-zinc-600">
                          {record.lastLogged ? formatDay(record.lastLogged) : <Dash />}
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

                      {/* Its cost log — only amounts saved in Progress
                          Tracking Overrides, in the record dropdown's own
                          tint. */}
                      {open && (
                        <tr className="bg-[var(--material-dropdown)]">
                          <td colSpan={8} className="px-5 pb-4">
                            <div className="flex flex-col gap-2 border-l-2 border-[var(--material-dropdown-line)] pt-4 pl-4">
                              <p className="text-[11px] font-semibold tracking-wider text-[var(--material-dropdown-accent)] uppercase">
                                Cost log
                                <span className="font-normal tracking-normal text-zinc-400 normal-case">
                                  {" "}
                                  · {record.entries.length}{" "}
                                  {record.entries.length === 1 ? "entry" : "entries"}
                                </span>
                              </p>
                              <div className="overflow-hidden rounded-md border border-zinc-200">
                                <div
                                  className={`${LOG_COLUMNS} border-b border-zinc-200 bg-[var(--material-dropdown-header)] py-2 text-xs font-medium text-zinc-600`}
                                >
                                  <span>Date</span>
                                  <span>Saved by</span>
                                  <span className="text-right">Amount</span>
                                </div>
                                {record.entries.map((entry) => (
                                  <div
                                    key={entry.id}
                                    className={`${LOG_COLUMNS} border-b border-zinc-200/70 bg-[var(--material-dropdown-row)] py-2.5 last:border-b-0`}
                                  >
                                    <span className="flex min-w-0 items-center gap-2">
                                      <CornerDownRight
                                        aria-hidden
                                        className="size-3.5 shrink-0 text-[var(--material-dropdown-accent)]"
                                      />
                                      <span className="truncate text-zinc-700">
                                        {formatDay(entry.entryDate)}
                                      </span>
                                    </span>
                                    <span className="truncate text-zinc-600">
                                      {entry.savedByName ?? <Dash />}
                                    </span>
                                    <span className="text-right font-semibold text-zinc-900 tabular-nums">
                                      {formatPeso(entry.amount)}
                                    </span>
                                  </div>
                                ))}
                              </div>
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
          Showing <span className="font-semibold text-zinc-700">{footer.shown}</span> of{" "}
          <span className="font-semibold text-zinc-700">{footer.total}</span>{" "}
          {footer.total === 1 ? footer.noun[0] : footer.noun[1]}
        </div>
      </div>

      <EquipmentRequestEditForm
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        projectId={projectId}
        currentUserName={currentUserName}
        onSuccess={() => setRequestOpen(false)}
      />
    </div>
  );
}
