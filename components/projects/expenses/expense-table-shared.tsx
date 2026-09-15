"use client";

import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";

/** e.g. "08 April 2026" — day-first, unlike en-US's default month-first
 * order for the same {day, month, year} options, to match the reference
 * design exactly. */
export function formatGroupDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function formatCurrency(amount: number) {
  return `₱${amount.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
}

/**
 * One ledger's date-group divider row — a project's daily logs are one
 * per date (0019_daily_logs_one_per_day.sql), so grouping by
 * daily_log_id doubles as grouping by date. Spans every column so item
 * rows below it don't need to repeat the date themselves; "View Details"
 * goes straight to that day's Daily Log detail page, where every entry
 * type for the day (not just this ledger) is visible together.
 */
export function GroupHeaderRow({
  projectId,
  dailyLogId,
  logDate,
  count,
  isOpen,
  onToggle,
  colSpan,
}: {
  projectId: number;
  dailyLogId: number;
  logDate: string;
  count: number;
  isOpen: boolean;
  onToggle: () => void;
  colSpan: number;
}) {
  return (
    <tr className="border-y border-zinc-100 border-l-2 border-l-zinc-900 bg-zinc-50/60">
      <td colSpan={colSpan} className="px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onToggle}
            className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-zinc-600 transition hover:text-zinc-900"
          >
            {isOpen ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
            {formatGroupDate(logDate)}
            <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
              {count}
            </span>
          </button>
          <Link
            href={`/admin/projects/${projectId}/daily-logs/${dailyLogId}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex flex-shrink-0 cursor-pointer items-center rounded-sm border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
          >
            View Details
          </Link>
        </div>
      </td>
    </tr>
  );
}

/** The dark footer total row every ledger table ends on. */
export function TotalFooterRow({
  colSpan,
  total,
}: {
  colSpan: number;
  total: number;
}) {
  return (
    <tr className="bg-zinc-800 text-white">
      <td colSpan={colSpan - 1} className="px-4 py-3 text-sm font-semibold">
        Total
      </td>
      <td className="px-4 py-3 text-right text-sm font-semibold">
        {formatCurrency(total)}
      </td>
    </tr>
  );
}

export function TableShell({
  title,
  isEmpty,
  emptyLabel,
  children,
}: {
  title: string;
  isEmpty: boolean;
  emptyLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
      </div>
      {isEmpty ? (
        <p className="py-10 text-center text-sm text-zinc-400">{emptyLabel}</p>
      ) : (
        <div className="overflow-x-auto">{children}</div>
      )}
    </div>
  );
}
