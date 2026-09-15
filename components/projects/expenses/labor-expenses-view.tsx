"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import {
  GroupHeaderRow,
  TotalFooterRow,
  TableShell,
  formatCurrency,
} from "@/components/projects/expenses/expense-table-shared";
import { dailyLogEntryHref } from "@/lib/daily-logs/flag-state";
import type { LaborExpenseGroup } from "@/lib/expenses/data";

const COLUMN_COUNT = 8;

export function LaborExpensesView({
  projectId,
  groups,
}: {
  projectId: number;
  groups: LaborExpenseGroup[];
}) {
  const router = useRouter();
  // Newest date open by default, the rest collapsed — keeps a project
  // with a long history from opening as one huge wall of rows.
  const [collapsed, setCollapsed] = useState<Set<number>>(
    new Set(groups.slice(1).map((g) => g.dailyLogId))
  );

  function toggle(dailyLogId: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(dailyLogId)) next.delete(dailyLogId);
      else next.add(dailyLogId);
      return next;
    });
  }

  const grandTotal = groups.reduce((sum, g) => sum + g.groupTotal, 0);

  return (
    <TableShell
      title="Labor Expenses"
      isEmpty={groups.length === 0}
      emptyLabel="No approved daily logs have recorded labor expenses yet."
    >
      <table className="w-full table-fixed text-left text-sm">
        <colgroup>
          <col className="w-36" />
          <col />
          <col className="w-28" />
          <col className="w-24" />
          <col className="w-28" />
          <col className="w-28" />
          <col className="w-24" />
          <col className="w-24" />
        </colgroup>
        <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
          <tr>
            <th className="border-r border-zinc-200 px-4 py-2.5">Date</th>
            <th className="border-r border-zinc-200 px-4 py-2.5">Worker Role</th>
            <th className="border-r border-zinc-200 px-4 py-2.5">
              No. of Workers
            </th>
            <th className="border-r border-zinc-200 px-4 py-2.5">Daily Rate</th>
            <th className="border-r border-zinc-200 px-4 py-2.5">
              Renders Halfday
            </th>
            <th className="border-r border-zinc-200 px-4 py-2.5">
              Renders Overtime
            </th>
            <th className="border-r border-zinc-200 px-4 py-2.5">OT Hours</th>
            <th className="px-4 py-2.5">Total</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const isOpen = !collapsed.has(group.dailyLogId);
            return (
              <Fragment key={group.dailyLogId}>
                <GroupHeaderRow
                  projectId={projectId}
                  dailyLogId={group.dailyLogId}
                  logDate={group.logDate}
                  count={group.items.length}
                  isOpen={isOpen}
                  onToggle={() => toggle(group.dailyLogId)}
                  colSpan={COLUMN_COUNT}
                />
                {isOpen &&
                  group.items.map((item) => {
                    const href = dailyLogEntryHref(
                      projectId,
                      group.dailyLogId,
                      "labor_item",
                      item.id
                    );
                    return (
                    <tr
                      key={item.id}
                      role="link"
                      tabIndex={0}
                      onClick={() => router.push(href)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") router.push(href);
                      }}
                      className="cursor-pointer border-y border-zinc-100 transition-colors hover:bg-zinc-100"
                    >
                      <td className="border-r border-zinc-200 px-4 py-2.5" />
                      <td className="border-r border-zinc-200 px-4 py-2.5 font-medium text-zinc-900">
                        {item.workerRole}
                      </td>
                      <td className="border-r border-zinc-200 px-4 py-2.5 text-zinc-700">
                        {String(item.workerCount).padStart(2, "0")}
                      </td>
                      <td className="border-r border-zinc-200 px-4 py-2.5 text-zinc-700">
                        {formatCurrency(item.dailyRate)}
                      </td>
                      <td className="border-r border-zinc-200 px-4 py-2.5 text-zinc-700">
                        {String(item.workersRenderedHalfday).padStart(2, "0")}
                      </td>
                      <td className="border-r border-zinc-200 px-4 py-2.5 text-zinc-700">
                        {String(item.workersRenderedOvertime).padStart(2, "0")}
                      </td>
                      <td className="border-r border-zinc-200 px-4 py-2.5 text-zinc-700">
                        {String(item.otHours).padStart(2, "0")}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-zinc-900">
                        {formatCurrency(item.total)}
                      </td>
                    </tr>
                    );
                  })}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <TotalFooterRow colSpan={COLUMN_COUNT} total={grandTotal} />
        </tfoot>
      </table>
    </TableShell>
  );
}
