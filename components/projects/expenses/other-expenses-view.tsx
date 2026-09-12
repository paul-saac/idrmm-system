"use client";

import { Fragment, useState } from "react";
import {
  GroupHeaderRow,
  TotalFooterRow,
  TableShell,
  formatCurrency,
} from "@/components/projects/expenses/expense-table-shared";
import type { OtherExpenseGroup } from "@/lib/expenses/data";

const COLUMN_COUNT = 7;

export function OtherExpensesView({
  projectId,
  groups,
}: {
  projectId: number;
  groups: OtherExpenseGroup[];
}) {
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
      title="Other Expenses"
      isEmpty={groups.length === 0}
      emptyLabel="No approved daily logs have recorded other expenses yet."
    >
      <table className="w-full table-fixed text-left text-sm">
        <colgroup>
          <col className="w-36" />
          <col className="w-36" />
          <col />
          <col className="w-28" />
          <col className="w-28" />
          <col className="w-40" />
          <col className="w-28" />
        </colgroup>
        <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
          <tr>
            <th className="border-r border-zinc-200 px-4 py-2.5">Date</th>
            <th className="border-r border-zinc-200 px-4 py-2.5">
              Expense Category
            </th>
            <th className="border-r border-zinc-200 px-4 py-2.5">
              Description
            </th>
            <th className="border-r border-zinc-200 px-4 py-2.5">Amount</th>
            <th className="border-r border-zinc-200 px-4 py-2.5">
              Additional Fees
            </th>
            <th className="border-r border-zinc-200 px-4 py-2.5">Remarks</th>
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
                  group.items.map((item) => (
                    <tr
                      key={item.id}
                      className="border-y border-zinc-100 transition-colors hover:bg-zinc-50"
                    >
                      <td className="border-r border-zinc-100 px-4 py-2.5" />
                      <td className="border-r border-zinc-100 px-4 py-2.5 font-medium text-zinc-900">
                        {item.expenseCategory}
                      </td>
                      <td className="truncate border-r border-zinc-100 px-4 py-2.5 text-zinc-600">
                        {item.description || "—"}
                      </td>
                      <td className="border-r border-zinc-100 px-4 py-2.5 text-zinc-700">
                        {formatCurrency(item.amount)}
                      </td>
                      <td className="border-r border-zinc-100 px-4 py-2.5 text-zinc-700">
                        {formatCurrency(item.additionalFees)}
                      </td>
                      <td className="truncate border-r border-zinc-100 px-4 py-2.5 text-zinc-600">
                        {item.remarks || "—"}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-zinc-900">
                        {formatCurrency(item.total)}
                      </td>
                    </tr>
                  ))}
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
