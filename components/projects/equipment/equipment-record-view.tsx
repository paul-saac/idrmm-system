"use client";

import { ProjectWriteButton } from "@/components/projects/project-access-context";
import { EmptyState } from "@/components/ui/empty-state";
import { useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Search, X } from "lucide-react";
import { ViewMenu, type ViewOption } from "@/components/ui/view-menu";
import { EquipmentRequestEditForm } from "@/components/projects/equipment/equipment-request-edit-form";
import {
  EQUIPMENT_REQUEST_STATUSES,
  EquipmentRequestsTable,
} from "@/components/projects/equipment/equipment-requests-table";
import { AssignedEquipmentTable, EquipmentMonitoringTable } from "@/components/projects/equipment/project-equipment-view";
import type { EquipmentAssignmentRow, EquipmentTaskMovementRow, EquipmentTaskOption, ProgressEquipmentCost } from "@/lib/equipment/data";
import type { EquipmentCostStatus } from "@/lib/equipment/records";
import type {
  EquipmentRequestDetail,
  EquipmentRequestStatus,
} from "@/lib/equipment-requests/data";

/** Which list the Equipment record shows. */
export type EquipmentRecordList = "cost" | "assigned" | "monitoring" | "requests";

const RECORD_VIEWS: ViewOption<EquipmentRecordList>[] = [
  { value: "cost", label: "Equipment cost" },
  { value: "requests", label: "Equipment requests" },
];

// Kept with the record because the Equipment Overview also uses these
// labels for the project-level budget summary.
export const EQUIPMENT_COST_STATUS: Record<
  EquipmentCostStatus,
  { label: string; style: string }
> = {
  over_budget: { label: "Over plan", style: "bg-red-50 text-red-600" },
  spending_ahead: { label: "Spending ahead", style: "bg-amber-50 text-amber-700" },
  within_budget: { label: "Within plan", style: "bg-emerald-50 text-emerald-700" },
  not_budgeted: { label: "Not planned", style: "bg-orange-50 text-orange-700" },
};

const SELECT =
  "cursor-pointer appearance-none rounded-md border border-zinc-200 bg-white py-2 pr-9 pl-3 text-sm text-zinc-700 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200";

function formatPeso(value: number) {
  return `₱${value.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

/** "Oct 17, 2026" from a day (YYYY-MM-DD). */
function formatDay(day: string) {
  return new Date(`${day}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const Dash = () => <span className="text-zinc-300">—</span>;

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
        className="w-full rounded-md border border-zinc-200 bg-white py-2 pr-8 pl-9 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          title="Clear search"
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * The Equipment tab's record. Its Equipment cost view is an audit list:
 * one row per non-zero equipment cost saved in a Progress Tracking
 * Override. Each row opens the exact date in the Gantt chart history.
 */
export function EquipmentRecordView({
  projectId,
  costLogs,
  assignments,
  taskMovements,
  tasks,
  requests,
  view,
  onViewChange,
  onOpenProgressLog,
  openRequestIds,
  onToggleRequest,
  currentUserName,
}: {
  projectId: number;
  costLogs: ProgressEquipmentCost[];
  assignments: EquipmentAssignmentRow[];
  taskMovements: EquipmentTaskMovementRow[];
  tasks: EquipmentTaskOption[];
  requests: EquipmentRequestDetail[];
  view: EquipmentRecordList;
  onViewChange: (view: EquipmentRecordList) => void;
  /** Opens the matching Gantt Progress Tracking history entry. */
  onOpenProgressLog: (itemKey: string, entryDate: string) => void;
  openRequestIds: ReadonlySet<number>;
  onToggleRequest: (requestId: number) => void;
  currentUserName: string;
}) {
  const [costQuery, setCostQuery] = useState("");
  const [costKind, setCostKind] = useState<"all" | "planned" | "not_on_list">("all");
  const [assignedQuery, setAssignedQuery] = useState("");
  const [assignedStatus, setAssignedStatus] = useState<"on_site" | "returned" | "all">("all");
  const [monitoringQuery, setMonitoringQuery] = useState("");
  const [requestQuery, setRequestQuery] = useState("");
  const [requestStatus, setRequestStatus] = useState<EquipmentRequestStatus | "all">("all");
  const [requestOpen, setRequestOpen] = useState(false);

  // Keep a shorter switched-to list from pulling the page upward.
  const rootRef = useRef<HTMLDivElement>(null);
  const [heldHeight, setHeldHeight] = useState<number | undefined>(undefined);
  function switchView(next: EquipmentRecordList) {
    if (next === view) return;
    setHeldHeight(rootRef.current?.offsetHeight);
    onViewChange(next);
  }

  const costLogsShown = useMemo(() => {
    const q = costQuery.trim().toLowerCase();
    return costLogs.filter((entry) => {
      if (costKind === "planned" && entry.isUnplanned) return false;
      if (costKind === "not_on_list" && !entry.isUnplanned) return false;
      return (
        !q ||
        entry.itemName.toLowerCase().includes(q) ||
        (entry.equipmentName && entry.equipmentName.toLowerCase().includes(q)) ||
        (entry.isUnplanned && ("unplanned".includes(q) || "not on the list".includes(q))) ||
        entry.savedByName?.toLowerCase().includes(q) ||
        entry.equipmentItems?.some((item) => item.name.toLowerCase().includes(q))
      );
    });
  }, [costLogs, costQuery, costKind]);

  const assignedShown = useMemo(() => {
    const q = assignedQuery.trim().toLowerCase();
    return assignments.filter((assignment) => {
      const onSite = !assignment.returnedAt;
      if (assignedStatus === "on_site" && !onSite) return false;
      if (assignedStatus === "returned" && onSite) return false;
      return (
        !q ||
        assignment.equipmentName.toLowerCase().includes(q) ||
        assignment.equipmentAssetTag.toLowerCase().includes(q) ||
        assignment.currentTaskName?.toLowerCase().includes(q)
      );
    });
  }, [assignments, assignedQuery, assignedStatus]);

  const requestsShown = useMemo(() => {
    const q = requestQuery.trim().toLowerCase();
    return [...requests]
      .sort((a, b) => b.requestDate.localeCompare(a.requestDate))
      .filter((request) => {
        if (requestStatus !== "all" && request.status !== requestStatus) return false;
        return (
          !q ||
          request.erNo.toLowerCase().includes(q) ||
          request.requestedByName.toLowerCase().includes(q)
        );
      });
  }, [requests, requestQuery, requestStatus]);
  const movementsShown = useMemo(() => {
    const q = monitoringQuery.trim().toLowerCase();
    return taskMovements.filter((movement) =>
      !q ||
      movement.equipmentName.toLowerCase().includes(q) ||
      movement.equipmentAssetTag.toLowerCase().includes(q) ||
      movement.taskName.toLowerCase().includes(q)
    );
  }, [taskMovements, monitoringQuery]);

  const onSiteCount = assignments.filter((assignment) => !assignment.returnedAt).length;
  const returnedCount = assignments.length - onSiteCount;
  const footer =
    view === "cost"
      ? { shown: costLogsShown.length, total: costLogs.length, noun: ["log", "logs"] }
      : view === "assigned"
        ? { shown: assignedShown.length, total: assignments.length, noun: ["equipment", "equipment"] }
        : view === "monitoring"
          ? { shown: movementsShown.length, total: taskMovements.length, noun: ["movement", "movements"] }
        : { shown: requestsShown.length, total: requests.length, noun: ["request", "requests"] };

  return (
    <div
      ref={rootRef}
      className="flex flex-col gap-3"
      style={heldHeight ? { minHeight: heldHeight } : undefined}
    >
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <h2 className="text-base font-semibold text-zinc-900">Equipment record</h2>
          {view === "cost" ? (
            <span className="text-xs text-zinc-400">
              {costLogs.length} {costLogs.length === 1 ? "cost log" : "cost logs"}
              {costLogs.filter((e) => e.isUnplanned).length > 0 &&
                ` · ${costLogs.filter((e) => e.isUnplanned).length} unplanned`}
            </span>
          ) : view === "assigned" ? (
            <span className="text-xs text-zinc-400">
              {onSiteCount} on site
              {returnedCount > 0 && ` · ${returnedCount} returned`}
            </span>
          ) : view === "monitoring" ? (
            <span className="text-xs text-zinc-400">
              {taskMovements.length} {taskMovements.length === 1 ? "movement" : "movements"}
            </span>
          ) : (
            <span className="text-xs text-zinc-400">
              {requests.length} {requests.length === 1 ? "request" : "requests"}
            </span>
          )}
        </div>
        {view === "requests" && (
          <ProjectWriteButton
            type="button"
            onClick={() => setRequestOpen(true)}
            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800"
          >
            <Plus className="size-4" />
            Request Equipment
          </ProjectWriteButton>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-3">
          <ViewMenu views={RECORD_VIEWS} value={view} onChange={switchView} />
          {view === "cost" ? (
            <>
              <SearchBox
                value={costQuery}
                onChange={setCostQuery}
                placeholder="Search task, equipment, or saved by..."
                label="Search equipment cost logs"
              />
              <div className="relative">
                <select
                  aria-label="Filter equipment cost type"
                  value={costKind}
                  onChange={(e) => setCostKind(e.target.value as "all" | "planned" | "not_on_list")}
                  className={SELECT}
                >
                  <option value="all">All equipment costs</option>
                  <option value="planned">Planned equipment</option>
                  <option value="not_on_list">Unplanned</option>
                </select>
                <ChevronDown
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-zinc-500"
                />
              </div>
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
          ) : view === "monitoring" ? (
            <SearchBox
              value={monitoringQuery}
              onChange={setMonitoringQuery}
              placeholder="Search equipment, asset tag, or task..."
              label="Search equipment movement history"
            />
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

        {view === "monitoring" ? (
          movementsShown.length === 0 ? (
            <EmptyState className="py-10 text-center text-sm text-zinc-400">
              {taskMovements.length === 0 ? "No equipment task movements yet." : "No movements match your search."}
            </EmptyState>
          ) : (
            <EquipmentMonitoringTable movements={movementsShown} />
          )
        ) : view === "requests" ? (
          requestsShown.length === 0 ? (
            <EmptyState className="py-10 text-center text-sm text-zinc-400">
              {requests.length === 0
                ? "No equipment requests yet."
                : "No equipment requests match your filters."}
            </EmptyState>
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
            <EmptyState className="py-10 text-center text-sm text-zinc-400">
              {assignments.length === 0
                ? "No equipment assigned yet - it is assigned from the Inventory page."
                : "No equipment matches your filters."}
            </EmptyState>
          ) : (
            <AssignedEquipmentTable projectId={projectId} assignments={assignedShown} tasks={tasks} />
          )
        ) : costLogsShown.length === 0 ? (
          <EmptyState className="py-10 text-center text-sm text-zinc-400">
            {costLogs.length === 0
              ? "No equipment costs have been logged in Progress Tracking Overrides yet."
              : "No equipment cost logs match your search."}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-500">
                <tr>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-4 py-3">Task</th>
                  <th className="px-4 py-3">Equipment cost name</th>
                  <th className="px-4 py-3 text-right">Equipment cost</th>
                  <th className="px-4 py-3">Saved by</th>
                  <th className="w-14 py-3 pr-5">
                    <span className="sr-only">Open progress log</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {costLogsShown.map((entry) => {
                  const open = () => onOpenProgressLog(entry.itemKey, entry.entryDate);
                  return (
                    <tr
                      key={entry.id}
                      role="link"
                      tabIndex={0}
                      onClick={open}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          open();
                        }
                      }}
                      aria-label={`Open the ${formatDay(entry.entryDate)} progress override for ${entry.itemName}`}
                      className="cursor-pointer transition-colors hover:bg-zinc-50 focus-visible:bg-zinc-50 focus-visible:outline-none"
                    >
                      <td className="px-5 py-3.5 align-top font-medium whitespace-nowrap text-zinc-900 tabular-nums">
                        {formatDay(entry.entryDate)}
                      </td>
                      <td className="max-w-72 px-4 py-3.5 align-top">
                        <p className="truncate font-semibold text-zinc-900" title={entry.itemName}>
                          {entry.itemName || "Untitled task"}
                        </p>
                      </td>
                      <td className="max-w-80 px-4 py-3.5 align-top">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className="font-medium text-zinc-900"
                            title={entry.equipmentName ?? undefined}
                          >
                            {entry.equipmentName ?? <Dash />}
                          </span>
                          {entry.isUnplanned && (
                            <span className="shrink-0 rounded bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700">
                              Unplanned
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 align-top text-right font-semibold whitespace-nowrap text-zinc-900 tabular-nums">
                        {formatPeso(entry.amount)}
                      </td>
                      <td className="max-w-56 px-4 py-3.5 align-top">
                        <span className="block truncate text-zinc-600" title={entry.savedByName ?? undefined}>
                          {entry.savedByName ?? <Dash />}
                        </span>
                      </td>
                      <td className="py-3.5 pr-5 align-top">
                        <span className="ml-auto flex size-7 items-center justify-center rounded text-zinc-400 transition">
                          <ChevronRight aria-hidden className="size-4" />
                        </span>
                      </td>
                    </tr>
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
