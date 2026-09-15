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
import type { EquipmentExpenseGroup } from "@/lib/expenses/data";

const ACQUISITION_TYPE_LABELS: Record<string, string> = {
  rental: "Rental",
  purchase: "Purchase",
};

// No per-row "Total" column — an acquisition's Amount already is its
// total (the schema doesn't track a separate additional fee the way
// Material Procurement and Other Expenses do), so a second identical
// column would just repeat the same number.
const COLUMN_COUNT = 7;

export function EquipmentExpensesView({
  projectId,
  groups,
}: {
  projectId: number;
  groups: EquipmentExpenseGroup[];
}) {
  const router = useRouter();
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
      title="Equipment Expenses"
      isEmpty={groups.length === 0}
      emptyLabel="No approved daily logs have recorded equipment expenses yet."
    >
      <table className="w-full table-fixed text-left text-sm">
        <colgroup>
          <col className="w-36" />
          <col />
          <col className="w-32" />
          <col className="w-20" />
          <col className="w-24" />
          <col className="w-28" />
          <col className="w-36" />
        </colgroup>
        <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
          <tr>
            <th className="border-r border-zinc-200 px-4 py-2.5">Date</th>
            <th className="border-r border-zinc-200 px-4 py-2.5">
              Equipment Name
            </th>
            <th className="border-r border-zinc-200 px-4 py-2.5">
              Specification
            </th>
            <th className="border-r border-zinc-200 px-4 py-2.5">Quantity</th>
            <th className="border-r border-zinc-200 px-4 py-2.5">
              Expense Type
            </th>
            <th className="border-r border-zinc-200 px-4 py-2.5">Amount</th>
            <th className="px-4 py-2.5">Equipment Request</th>
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
                      "equipment_acquisition",
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
                        {item.equipmentName}
                      </td>
                      <td className="border-r border-zinc-200 px-4 py-2.5 text-zinc-600">
                        {item.specification || "—"}
                      </td>
                      <td className="border-r border-zinc-200 px-4 py-2.5 text-zinc-700">
                        {String(item.quantity).padStart(2, "0")}
                      </td>
                      <td className="border-r border-zinc-200 px-4 py-2.5 text-zinc-700">
                        {ACQUISITION_TYPE_LABELS[item.acquisitionType]}
                      </td>
                      <td className="border-r border-zinc-200 px-4 py-2.5 font-medium text-zinc-900">
                        {formatCurrency(item.amount)}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-600">
                        {item.equipmentRequestErNo ? (
                          <span className="rounded-sm bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                            {item.equipmentRequestErNo}
                          </span>
                        ) : (
                          "—"
                        )}
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
