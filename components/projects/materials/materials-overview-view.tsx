"use client";

import { useState, type ReactNode } from "react";
import {
  Boxes,
  ChevronRight,
  ClipboardList,
  FileText,
  History,
  Layers,
  Package,
  SquareCheck,
  TrendingDown,
} from "lucide-react";
import { MaterialRequestsTable } from "@/components/projects/materials/material-requests-table";
import type { MaterialsOverviewCounts, ProgressMaterialUsage } from "@/lib/materials/data";
import type { MaterialRequestDetail } from "@/lib/material-requests/data";

// How many requests the table lists until See all — the newest.
const REQUESTS_SHOWN = 4;

// The table keeps room for that many rows whether there are that many or
// not, so the overview opens at one size, Recent activity scrolling within
// it: its header row (py-2.5 around a text-xs line), each row (py-3 around
// a text-sm line, the mt-0.5 gap and a text-xs line), and the 1px lines
// between them all.
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

function formatQuantity(value: number) {
  return value.toLocaleString("en-PH", { maximumFractionDigits: 2 });
}

function MaterialStatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: ReactNode;
}) {
  return (
    <div className="p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-zinc-500">{label}</p>
        <span className="shrink-0 text-zinc-400">{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-zinc-900">
        {String(value).padStart(2, "0")}
      </p>
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
 * The project's newest material requests, each row pointing off to the
 * Material record's Material requests — the request already open there —
 * and its See all switching the record to every one.
 */
function MaterialRequests({
  requests,
  onOpen,
  onSeeAll,
}: {
  requests: MaterialRequestDetail[];
  /** A request's row: the request, opened in the Material record. */
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
            Material requests
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
          <p className="flex flex-1 items-center justify-center border-t border-zinc-200 text-sm text-zinc-400">
            No material requests yet.
          </p>
        ) : (
          <MaterialRequestsTable requests={shown} onOpen={onOpen} />
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-zinc-200 px-5 py-3 text-xs text-zinc-500">
        <span>
          Showing {shown.length} of {requests.length}{" "}
          {requests.length === 1 ? "request" : "requests"}
        </span>
        {/* Every request — the Material record's Material requests view. */}
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
 * The newest materials used, from the progress window's Materials used
 * today — grouped by day, newest first: what was used, how much, and on
 * which task, each on a timeline.
 */
function RecentActivity({ entries }: { entries: ProgressMaterialUsage[] }) {
  // Entries already come newest first, so each day's run is together.
  const days: { date: string; entries: ProgressMaterialUsage[] }[] = [];
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
          <p className="py-10 text-center text-sm text-zinc-400">
            No materials used yet. They show here once they&apos;re logged in a task&apos;s
            progress.
          </p>
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
                        <Package className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex min-h-7 items-center gap-2 text-sm font-semibold text-zinc-900">
                          Material used
                          {entry.unitCost !== null && (
                            <span className="rounded-sm bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700">
                              Unplanned
                            </span>
                          )}
                        </p>
                        <div className="mt-2 rounded border border-zinc-200 bg-zinc-50 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-xs text-zinc-500">Material</p>
                              <p className="mt-0.5 truncate text-sm text-zinc-900">
                                {entry.materialName}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-xs text-zinc-500">Quantity used</p>
                              <p className="mt-0.5 text-sm font-semibold text-zinc-900 tabular-nums">
                                {formatQuantity(entry.quantity)}
                                {entry.unit ? ` ${entry.unit}` : ""}
                              </p>
                            </div>
                          </div>
                          <div className="mt-3 flex min-w-0 items-center gap-1.5 border-t border-zinc-200 pt-2.5 text-xs">
                            <Layers aria-hidden className="size-3.5 shrink-0 text-zinc-400" />
                            <span className="shrink-0 text-zinc-500">Used on</span>
                            <span className="truncate font-medium text-zinc-900">
                              {entry.itemName}
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
 * The Materials tab's Material overview bar, like the Overview tab's
 * Cost overview — open, it holds the project's stock counts and how many
 * material requests it has, then two panels side by side: the material
 * requests, and the recent materials used from progress overrides.
 */
export function MaterialsOverviewView({
  counts,
  requests,
  recentUsage,
  onOpenRequest,
  onSeeAllRequests,
}: {
  counts: MaterialsOverviewCounts;
  requests: MaterialRequestDetail[];
  recentUsage: ProgressMaterialUsage[];
  /** A request's row in the requests panel — the request, opened in the
   * Material record. */
  onOpenRequest: (requestId: number) => void;
  /** The requests panel's See all — every request, in the Material
   * record. */
  onSeeAllRequests?: () => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="pt-6">
      <div className="rounded border border-zinc-200 bg-white">
        <button
          type="button"
          onClick={() => setOpen((isOpen) => !isOpen)}
          aria-expanded={open}
          className="flex w-full cursor-pointer items-center gap-3 px-5 py-3.5 text-left transition hover:bg-zinc-50"
        >
          <Boxes aria-hidden className="size-4 shrink-0 text-zinc-400" />
          <span className="shrink-0 text-sm font-semibold text-zinc-900">Material overview</span>
          <span className="min-w-0 truncate text-sm text-zinc-400">
            Stock, usage and requests
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
              <MaterialStatCard
                label="Total Material"
                value={counts.totalMaterials}
                icon={<ClipboardList className="size-4" />}
              />
              <MaterialStatCard
                label="Available Materials"
                value={counts.availableMaterials}
                icon={<SquareCheck className="size-4" />}
              />
              <MaterialStatCard
                label="Low Stock Materials"
                value={counts.lowStockMaterials}
                icon={<TrendingDown className="size-4" />}
              />
              <MaterialStatCard
                label="Material Requests"
                value={requests.length}
                icon={<FileText className="size-4" />}
              />
            </div>
            {/* Side by side and flush — the requests wider on the left, a
                line between them; one above the other on a narrow screen.
                The requests set the height (four rows' room), Recent
                activity scrolling within it. */}
            <div className="grid grid-cols-1 divide-y divide-zinc-200 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:divide-x lg:divide-y-0">
              <MaterialRequests
                requests={requests}
                onOpen={onOpenRequest}
                onSeeAll={onSeeAllRequests}
              />
              <RecentActivity entries={recentUsage} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
