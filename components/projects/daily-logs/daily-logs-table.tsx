"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { DailyLogSummary } from "@/lib/daily-logs/data";

const COLUMN_COUNT = 8;

function formatGroupDate(iso: string) {
  // Day-first ("08, April 2026") to match the reference design exactly.
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function isToday(iso: string) {
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return iso === todayIso;
}

function StatusBadge({ log }: { log: DailyLogSummary }) {
  if (log.status === "approved") {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-sm bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
          Approved
        </span>
        {log.unresolvedFlagCount > 0 && (
          <span className="rounded-sm bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
            {log.unresolvedFlagCount} flagged
          </span>
        )}
      </span>
    );
  }
  if (log.status === "rejected") {
    return (
      <span className="rounded-sm bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
        Rejected
      </span>
    );
  }
  // status === "pending" — "Submitted" is purely a display label for
  // today's entry, not a separate stored status.
  return isToday(log.logDate) ? (
    <span className="rounded-sm bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
      Submitted
    </span>
  ) : (
    <span className="rounded-sm bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
      Pending
    </span>
  );
}

function CountCell({ count }: { count: number }) {
  return (
    <td className="border-r border-zinc-200 px-4 py-3 text-center text-zinc-600">
      {count > 0 ? String(count).padStart(2, "0") : "—"}
    </td>
  );
}

/**
 * The Daily Logs sub-tab's own list — each log is its own two-row unit:
 * a header row spanning the full width (chevron, date, status on the
 * left; Submitted By and View Details on the right — none of it tied
 * to the entry-type columns below), and a plain data row under it with
 * just a count per entry type. A project's daily logs are already one
 * per date (0019_daily_logs_one_per_day.sql), so this is one row-pair
 * per log, not a real multi-log-per-date group.
 */
export function DailyLogsTable({
  projectId,
  logs,
}: {
  projectId: number;
  logs: DailyLogSummary[];
}) {
  // Every row starts collapsed — the count breakdown is opt-in per row,
  // not shown by default the moment the table loads.
  const [collapsed, setCollapsed] = useState<Set<number>>(
    () => new Set(logs.map((log) => log.id))
  );

  function toggle(logId: number) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(logId)) next.delete(logId);
      else next.add(logId);
      return next;
    });
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-zinc-900">Daily Logs</h3>
      </div>

      {logs.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-400">
          No daily logs recorded yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="text-xs font-medium text-zinc-500">
              <tr className="border-b border-zinc-200">
                <th className="w-65 border-r border-zinc-200 px-4 py-2.5">Date</th>
                <th className="w-24 border-r border-zinc-200 px-4 py-2.5 text-center">Work Log</th>
                <th className="w-24 border-r border-zinc-200 px-4 py-2.5 text-center">Labor Log</th>
                <th className="w-32 border-r border-zinc-200 px-4 py-2.5 text-center">Material Usage</th>
                <th className="w-24 border-r border-zinc-200 px-4 py-2.5 text-center">Deliveries</th>
                <th className="w-44 border-r border-zinc-200 px-4 py-2.5 text-center">Equipment Acquisition</th>
                <th className="w-32 border-r border-zinc-200 px-4 py-2.5 text-center whitespace-nowrap">Other Expense</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const isOpen = !collapsed.has(log.id);
                return (
                  <Fragment key={log.id}>
                    <tr className="border-y border-zinc-100 border-l-2 border-l-zinc-900 bg-zinc-50/60">
                      <td colSpan={COLUMN_COUNT} className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => toggle(log.id)}
                            className="flex cursor-pointer items-center gap-2 text-sm font-normal text-zinc-800 transition hover:text-zinc-900"
                          >
                            {isOpen ? (
                              <ChevronDown className="size-4 text-zinc-400" />
                            ) : (
                              <ChevronRight className="size-4 text-zinc-400" />
                            )}
                            {formatGroupDate(log.logDate)}
                            <StatusBadge log={log} />
                          </button>
                          <div className="flex flex-wrap items-center gap-3 text-xs">
                            <span>
                              <span className="font-medium text-zinc-400">
                                Submitted By{" "}
                              </span>
                              <span className="font-medium text-zinc-700">
                                {log.submittedByName}
                              </span>
                            </span>
                            {log.approvedByName && (
                              <span>
                                <span className="font-medium text-zinc-400">
                                  Approved By{" "}
                                </span>
                                <span className="font-medium text-zinc-700">
                                  {log.approvedByName}
                                </span>
                              </span>
                            )}
                            <Link
                              href={`/admin/projects/${projectId}/daily-logs/${log.id}`}
                              className="inline-flex cursor-pointer items-center rounded-sm border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
                            >
                              View Details
                            </Link>
                          </div>
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-zinc-100">
                        <td className="border-r border-zinc-200 px-4 py-3" />
                        <CountCell count={log.entries.workLogs.length} />
                        <CountCell count={log.entries.laborLogs.length} />
                        <CountCell count={log.entries.materialUsage.length} />
                        <CountCell count={log.entries.materialProcurement.length} />
                        <CountCell count={log.entries.equipmentAcquisition.length} />
                        <CountCell count={log.entries.otherExpense.length} />
                        <td className="px-4 py-3" />
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
