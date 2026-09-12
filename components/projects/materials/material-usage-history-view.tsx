"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { MaterialStatus, MaterialUsageHistoryEntry } from "@/lib/materials/data";

function StatusBadge({ status }: { status: MaterialStatus }) {
  if (status === "available") {
    return (
      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        Available
      </span>
    );
  }
  if (status === "low_stock") {
    return (
      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
        Low Stock
      </span>
    );
  }
  return (
    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
      Fully Consumed
    </span>
  );
}

function formatGroupDate(iso: string) {
  // Day-first ("08 April 2026") to match the reference design — en-US's
  // long-date order puts the month first, en-GB's doesn't.
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

type DateGroup = {
  logDate: string;
  entries: MaterialUsageHistoryEntry[];
};

export function MaterialUsageHistoryView({
  projectId,
  entries,
}: {
  projectId: number;
  entries: MaterialUsageHistoryEntry[];
}) {
  const groups = useMemo<DateGroup[]>(() => {
    const byDate = new Map<string, MaterialUsageHistoryEntry[]>();
    for (const entry of entries) {
      const list = byDate.get(entry.logDate) ?? [];
      list.push(entry);
      byDate.set(entry.logDate, list);
    }
    return Array.from(byDate.entries())
      .map(([logDate, groupEntries]) => ({ logDate, entries: groupEntries }))
      .sort((a, b) => b.logDate.localeCompare(a.logDate));
  }, [entries]);

  // The two most recent dates start expanded (matching the reference
  // design), everything older starts collapsed.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(groups.slice(0, 2).map((g) => g.logDate))
  );

  function toggle(logDate: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(logDate)) {
        next.delete(logDate);
      } else {
        next.add(logDate);
      }
      return next;
    });
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-zinc-900">
          Material Usage History
        </h3>
      </div>

      {groups.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-400">
          No material usage logs recorded yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
              <tr>
                <th className="px-4 py-2.5">Date</th>
                <th className="px-4 py-2.5">Material Name</th>
                <th className="px-4 py-2.5">Specification</th>
                <th className="px-4 py-2.5">Quantity</th>
                <th className="px-4 py-2.5">Unit</th>
                <th className="px-4 py-2.5">Material Status</th>
                <th className="px-4 py-2.5">Activity</th>
                <th className="px-4 py-2.5">Remarks</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {groups.map((group) => {
                const isExpanded = expanded.has(group.logDate);
                return (
                  <Fragment key={group.logDate}>
                    <tr
                      onClick={() => toggle(group.logDate)}
                      className="cursor-pointer bg-zinc-50 transition hover:bg-zinc-100"
                    >
                      <td className="px-4 py-2.5" colSpan={9}>
                        <span className="flex items-center gap-2 text-sm font-medium text-zinc-800">
                          {isExpanded ? (
                            <ChevronDown className="size-4 text-zinc-400" />
                          ) : (
                            <ChevronRight className="size-4 text-zinc-400" />
                          )}
                          {formatGroupDate(group.logDate)}
                          <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-600">
                            {group.entries.length}
                          </span>
                        </span>
                      </td>
                    </tr>

                    {isExpanded &&
                      group.entries.map((entry) => (
                        <tr key={entry.id} className="transition hover:bg-zinc-50">
                          <td className="px-4 py-2.5" />
                          <td className="px-4 py-2.5 font-medium text-zinc-900">
                            {entry.materialName}
                          </td>
                          <td className="px-4 py-2.5 text-zinc-600">
                            {entry.specification || "—"}
                          </td>
                          <td className="px-4 py-2.5 text-zinc-600">
                            {String(entry.quantity).padStart(2, "0")}
                          </td>
                          <td className="px-4 py-2.5 text-zinc-600">
                            {entry.unit || "—"}
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusBadge status={entry.status} />
                          </td>
                          <td className="px-4 py-2.5 text-zinc-600">
                            {entry.activity || "—"}
                          </td>
                          <td className="px-4 py-2.5 text-zinc-600">
                            {entry.remarks || "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <Link
                              href={`/admin/projects/${projectId}/daily-logs/${entry.dailyLogId}`}
                              className="cursor-pointer rounded border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
                            >
                              View Details
                            </Link>
                          </td>
                        </tr>
                      ))}
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
