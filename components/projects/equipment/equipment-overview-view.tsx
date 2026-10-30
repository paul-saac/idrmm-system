"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { useState, type ReactNode } from "react";
import {
  ChevronRight,
  ClipboardList,
  FileText,
  History,
  Layers,
  PiggyBank,
  UserRound,
  Wallet,
  Wrench,
} from "lucide-react";
import { EquipmentRequestsTable } from "@/components/projects/equipment/equipment-requests-table";
import { EQUIPMENT_COST_STATUS } from "@/components/projects/equipment/equipment-record-view";
import { summarizeEquipmentCost, type EquipmentCostRecord } from "@/lib/equipment/records";
import type { ProgressEquipmentCost } from "@/lib/equipment/data";
import type { EquipmentRequestDetail } from "@/lib/equipment-requests/data";

// How many requests the table lists until See all — the newest.
const REQUESTS_SHOWN = 4;

// The table keeps room for that many rows whether there are that many or
// not, so the overview opens at one size, Recent activity scrolling within
// it — the Material overview's own measure: its header row (py-2.5 around
// a text-xs line), each row (py-3 around a text-sm line, the mt-0.5 gap
// and a text-xs line), and the 1px lines between them all.
const REQUESTS_TABLE_MIN_HEIGHT = `calc(${2.25 + REQUESTS_SHOWN * 3.875}rem + ${REQUESTS_SHOWN + 1}px)`;

/** "Oct 16, 2026" — from a date ("2026-10-16") or a timestamp. */
function formatDate(value: string) {
  const date = value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatPeso(value: number) {
  const sign = value < 0 ? "-" : "";
  return `${sign}₱${Math.abs(value).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

function StatCard({
  label,
  value,
  icon,
  aside,
  tone = "text-zinc-900",
}: {
  label: string;
  value: string;
  icon: ReactNode;
  /** Beside the label — e.g. the spend's status, when it isn't right. */
  aside?: ReactNode;
  tone?: string;
}) {
  return (
    <div className="p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-zinc-500">
          {label}
          {aside}
        </p>
        <span className="shrink-0 text-zinc-400">{icon}</span>
      </div>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

/** A panel card's top — its title (and anything beside it), and
 * whatever sits on the right. */
function CardHeader({
  title,
  aside,
  className = "px-5 pt-5",
}: {
  title: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-zinc-900">
        {title}
      </h3>
      {aside}
    </div>
  );
}

/**
 * The project's newest equipment requests, each row pointing off to the
 * Equipment record's Equipment requests — the request already open there
 * — and its See all switching the record to every one.
 */
function EquipmentRequests({
  requests,
  onOpen,
  onSeeAll,
}: {
  requests: EquipmentRequestDetail[];
  /** A request's row: the request, opened in the Equipment record. */
  onOpen: (requestId: number) => void;
  onSeeAll?: () => void;
}) {
  const sorted = [...requests].sort((a, b) => b.requestDate.localeCompare(a.requestDate));
  const shown = sorted.slice(0, REQUESTS_SHOWN);

  return (
    <section className="min-w-0 bg-white">
      <CardHeader
        title={
          <>
            Equipment requests
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-600 tabular-nums">
              {requests.length}
            </span>
          </>
        }
      />

      {/* The space between the heading and the table. */}
      <div className="h-4" />

      {/* Room for REQUESTS_SHOWN rows, however many there are. */}
      <div className="flex flex-col" style={{ minHeight: REQUESTS_TABLE_MIN_HEIGHT }}>
        {shown.length === 0 ? (
          <EmptyState className="flex flex-1 items-center justify-center border-t border-zinc-200 text-sm text-zinc-400">
            No equipment requests yet.
          </EmptyState>
        ) : (
          <EquipmentRequestsTable requests={shown} onOpen={onOpen} />
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-zinc-200 px-5 py-3 text-xs text-zinc-500">
        <span>
          Showing {shown.length} of {requests.length}{" "}
          {requests.length === 1 ? "request" : "requests"}
        </span>
        {/* Every request — the Equipment record's Equipment requests view. */}
        {requests.length > REQUESTS_SHOWN && onSeeAll && (
          <button
            type="button"
            onClick={onSeeAll}
            className="cursor-pointer text-xs font-medium text-zinc-900 transition hover:underline"
          >
            See all
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * The newest equipment costs, as typed into the progress window — grouped
 * by day, newest first: on which task, how much, and who saved it, each on
 * a timeline. The Material overview's Recent activity, for equipment.
 */
function RecentActivity({ entries }: { entries: ProgressEquipmentCost[] }) {
  // Entries already come newest first, so each day's run is together.
  const days: { date: string; entries: ProgressEquipmentCost[] }[] = [];
  for (const entry of entries) {
    const day = days[days.length - 1];
    if (day && day.date === entry.entryDate) day.entries.push(entry);
    else days.push({ date: entry.entryDate, entries: [entry] });
  }

  return (
    // Beside the requests on a wide screen, it takes their height instead
    // of setting its own (contain-size), and scrolls within it.
    <section className="flex min-w-0 flex-col bg-white lg:contain-size">
      <CardHeader
        className="border-b border-zinc-200 px-5 pt-5 pb-4"
        title={
          <>
            <History aria-hidden className="size-4 shrink-0 text-zinc-400" />
            <span>Recent activity</span>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <EmptyState className="py-10 text-center text-sm text-zinc-400">
            No equipment costs logged yet.
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-5 px-5 pt-4 pb-5">
            {days.map((day, dayIndex) => (
              <div key={day.date}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-zinc-500">{formatDate(day.date)}</span>
                  {dayIndex === 0 && (
                    <span className="text-xs text-zinc-400">Most recent first</span>
                  )}
                </div>
                <ol className="mt-3 flex flex-col gap-4">
                  {day.entries.map((entry) => (
                    <li key={entry.id} className="relative flex gap-3">
                      {/* A line down from the marker, beside the card. */}
                      <span
                        aria-hidden
                        className="absolute top-8 bottom-0 left-3.5 w-px -translate-x-1/2 bg-zinc-200"
                      />
                      <span
                        aria-hidden
                        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500"
                      >
                        <Wrench className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex min-h-7 items-center gap-2 text-sm font-semibold text-zinc-900">
                          <span>Equipment cost logged</span>
                          {entry.isUnplanned && (
                            <span className="rounded bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700">
                              Unplanned
                            </span>
                          )}
                        </p>
                        <div className="mt-2 rounded border border-zinc-200 bg-zinc-50 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-xs text-zinc-500">
                                {entry.equipmentName ? "Equipment" : "Task"}
                              </p>
                              <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm font-semibold text-zinc-900">
                                {entry.equipmentName ? (
                                  <Wrench aria-hidden className="size-3.5 shrink-0 text-zinc-400" />
                                ) : (
                                  <Layers aria-hidden className="size-3.5 shrink-0 text-zinc-400" />
                                )}
                                <span className="truncate">
                                  {entry.equipmentName ?? entry.itemName}
                                </span>
                              </p>
                              {entry.equipmentName && (
                                <p className="mt-1 flex min-w-0 items-center gap-1 text-xs text-zinc-500">
                                  <Layers aria-hidden className="size-3 shrink-0 text-zinc-400" />
                                  <span className="truncate">Task: {entry.itemName}</span>
                                </p>
                              )}
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-xs text-zinc-500">Amount</p>
                              <p className="mt-0.5 text-sm font-semibold text-zinc-900 tabular-nums">
                                {formatPeso(entry.amount)}
                              </p>
                            </div>
                          </div>
                          <div className="mt-3 flex min-w-0 items-center gap-1.5 border-t border-zinc-200 pt-2.5 text-xs">
                            <UserRound aria-hidden className="size-3.5 shrink-0 text-zinc-400" />
                            <span className="shrink-0 text-zinc-500">Saved by</span>
                            <span className="truncate font-medium text-zinc-900">
                              {entry.savedByName ?? "an unknown account"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * The Equipment tab's Equipment overview bar, the Materials tab's Material
 * overview's twin — open, it holds the project's equipment budget, what's
 * been spent of it and what's left (from the costs typed into the progress
 * window), and how many equipment requests it has, then two panels side
 * by side: the equipment requests, and the recent equipment costs logged.
 */
export function EquipmentOverviewView({
  costRecords,
  requests,
  recentCosts,
  onOpenRequest,
  onSeeAllRequests,
}: {
  costRecords: EquipmentCostRecord[];
  requests: EquipmentRequestDetail[];
  recentCosts: ProgressEquipmentCost[];
  /** A request's row in the requests panel — the request, opened in the
   * Equipment record. */
  onOpenRequest: (requestId: number) => void;
  /** The requests panel's See all — every request, in the Equipment
   * record. */
  onSeeAllRequests?: () => void;
}) {
  const [open, setOpen] = useState(true);
  const summary = summarizeEquipmentCost(costRecords);
  // Only said when it isn't right — spending ahead of the work, or over.
  const flagged = summary.status === "spending_ahead" || summary.status === "over_budget";

  return (
    <div className="pt-6">
      <div className="rounded border border-zinc-200 bg-white">
        <button
          type="button"
          onClick={() => setOpen((isOpen) => !isOpen)}
          aria-expanded={open}
          className="flex w-full cursor-pointer items-center gap-3 px-5 py-3.5 text-left transition hover:bg-zinc-50"
        >
          <Wrench aria-hidden className="size-4 shrink-0 text-zinc-400" />
          <span className="shrink-0 text-sm font-semibold text-zinc-900">Equipment overview</span>
          <span className="min-w-0 truncate text-sm text-zinc-400">
            Cost, equipment and requests
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1 text-sm font-medium text-zinc-700">
            {open ? "Hide details" : "View details"}
            <ChevronRight
              aria-hidden
              className={`size-4 transition-transform ${open ? "rotate-90" : ""}`}
            />
          </span>
        </button>

        {open && (
          <div className="border-t border-zinc-200">
            <div className="grid grid-cols-1 divide-y divide-zinc-200 border-b-2 border-zinc-900 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
              <StatCard
                label="Planned Cost"
                value={formatPeso(summary.budget)}
                icon={<ClipboardList className="size-4" />}
              />
              <StatCard
                label="Spent to Date"
                value={formatPeso(summary.spent)}
                icon={<Wallet className="size-4" />}
                tone={summary.status === "over_budget" ? "text-red-600" : "text-zinc-900"}
                aside={
                  flagged && (
                    <span
                      className={`rounded-sm px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${EQUIPMENT_COST_STATUS[summary.status].style}`}
                    >
                      {EQUIPMENT_COST_STATUS[summary.status].label}
                    </span>
                  )
                }
              />
              <StatCard
                label="Remaining"
                value={formatPeso(summary.remaining)}
                icon={<PiggyBank className="size-4" />}
                tone={summary.remaining < 0 ? "text-red-600" : "text-zinc-900"}
              />
              <StatCard
                label="Equipment Requests"
                value={String(requests.length).padStart(2, "0")}
                icon={<FileText className="size-4" />}
              />
            </div>
            {/* Side by side and flush — the requests wider on the left, a
                line between them; one above the other on a narrow screen.
                The requests set the height (four rows' room), Recent
                activity scrolling within it. */}
            <div className="grid grid-cols-1 divide-y divide-zinc-200 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:divide-x lg:divide-y-0">
              <EquipmentRequests
                requests={requests}
                onOpen={onOpenRequest}
                onSeeAll={onSeeAllRequests}
              />
              <RecentActivity entries={recentCosts} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
