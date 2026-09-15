"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { MaterialStatus, MaterialUsageHistoryEntry } from "@/lib/materials/data";
import { dailyLogEntryHref } from "@/lib/daily-logs/flag-state";

// rounded-sm (not rounded-full) to match the Material Requests table's
// own StatusBadge shape — this table's status domain is different
// (material stock, not a request's workflow state) so the colors stay
// its own, but the shape now matches that reference table.
function StatusBadge({ status }: { status: MaterialStatus }) {
  if (status === "available") {
    return (
      <span className="rounded-sm bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        Available
      </span>
    );
  }
  if (status === "low_stock") {
    return (
      <span className="rounded-sm bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
        Low Stock
      </span>
    );
  }
  return (
    <span className="rounded-sm bg-zinc-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-zinc-600">
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
  const router = useRouter();
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
          {/* table-fixed + widths declared on the header row alone (see
              Material Requests' own table for the same pattern) — so
              expanding/collapsing a date group, which only ever
              adds/removes rows below, can't shift column widths around.
              Activity is the one column left without a width, same role
              "Requested By" plays in that reference table — the
              free-text field that benefits most from whatever space the
              fixed columns don't need (Material Name gets its own fixed
              width instead: sized just wide enough for a typical name,
              not stretched past what its own values need). No dedicated
              Remarks column: a full-text remark isn't something a
              scannable table row needs to show at a glance, and it's
              still there on the entry's own daily log, one click away
              via this row's own link. */}
          <table className="w-full table-fixed text-left text-sm">
            <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
              <tr>
                <th className="w-40 border-r border-zinc-200 px-4 py-2.5">Date</th>
                <th className="w-56 border-r border-zinc-200 px-4 py-2.5">Material Name</th>
                <th className="w-36 border-r border-zinc-200 px-4 py-2.5">Specification</th>
                <th className="w-24 border-r border-zinc-200 px-4 py-2.5">Quantity</th>
                <th className="w-20 border-r border-zinc-200 px-4 py-2.5">Unit</th>
                <th className="w-40 border-r border-zinc-200 px-4 py-2.5">Material Status</th>
                <th className="border-r border-zinc-200 px-4 py-2.5">Activity</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const isExpanded = expanded.has(group.logDate);
                return (
                  <Fragment key={group.logDate}>
                    <tr className="border-y border-zinc-100 border-l-2 border-l-zinc-900 bg-zinc-50/60">
                      <td colSpan={7} className="px-4 py-3.5">
                        <button
                          type="button"
                          onClick={() => toggle(group.logDate)}
                          className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-zinc-600 transition hover:text-zinc-900"
                        >
                          {isExpanded ? (
                            <ChevronDown className="size-3.5" />
                          ) : (
                            <ChevronRight className="size-3.5" />
                          )}
                          {formatGroupDate(group.logDate)}
                          <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
                            {group.entries.length}
                          </span>
                        </button>
                      </td>
                    </tr>

                    {isExpanded &&
                      group.entries.map((entry) => {
                        const href = dailyLogEntryHref(
                          projectId,
                          entry.dailyLogId,
                          "material_usage_item",
                          entry.id
                        );
                        return (
                          <tr
                            key={entry.id}
                            role="link"
                            tabIndex={0}
                            onClick={() => router.push(href)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") router.push(href);
                            }}
                            className="cursor-pointer border-y border-zinc-100 transition-colors hover:bg-zinc-100"
                          >
                            <td className="border-r border-zinc-200 px-4 py-2.5" />
                            <td className="truncate border-r border-zinc-200 px-4 py-2.5 font-medium text-zinc-900">
                              {entry.materialName}
                            </td>
                            <td className="truncate border-r border-zinc-200 px-4 py-2.5 text-zinc-600">
                              {entry.specification || "—"}
                            </td>
                            <td className="border-r border-zinc-200 px-4 py-2.5 text-zinc-600">
                              {String(entry.quantity).padStart(2, "0")}
                            </td>
                            <td className="border-r border-zinc-200 px-4 py-2.5 text-zinc-600">
                              {entry.unit || "—"}
                            </td>
                            <td className="border-r border-zinc-200 px-4 py-2.5">
                              <StatusBadge status={entry.status} />
                            </td>
                            <td className="truncate border-r border-zinc-200 px-4 py-2.5 text-zinc-600">
                              {entry.activity || "—"}
                            </td>
                          </tr>
                        );
                      })}
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
