"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  GroupHeaderRow,
  TotalFooterRow,
  TableShell,
  formatCurrency,
} from "@/components/projects/expenses/expense-table-shared";
import { dailyLogEntryHref } from "@/lib/daily-logs/flag-state";
import type { MaterialExpenseGroup } from "@/lib/expenses/data";

const PROCUREMENT_TYPE_LABELS: Record<string, string> = {
  direct_purchase: "Direct Purchase",
  supplier_delivery: "Supplier Delivery",
};

const PROCUREMENT_TYPE_BADGE: Record<string, string> = {
  direct_purchase: "bg-violet-50 text-violet-700",
  supplier_delivery: "bg-amber-50 text-amber-700",
};

const COLUMN_COUNT = 7;

function ProcurementSubRow({
  projectId,
  dailyLogId,
  procurement,
  isOpen,
  onToggle,
}: {
  projectId: number;
  dailyLogId: number;
  procurement: MaterialExpenseGroup["procurements"][number];
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <tr className="border-y border-zinc-100 bg-zinc-50/30">
      <td colSpan={COLUMN_COUNT} className="px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={onToggle}
            className="flex cursor-pointer items-center gap-2 text-xs text-zinc-600 transition hover:text-zinc-900"
          >
            {isOpen ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
            <span
              className={`rounded-sm px-2 py-0.5 text-xs font-medium ${PROCUREMENT_TYPE_BADGE[procurement.procurementType]}`}
            >
              {PROCUREMENT_TYPE_LABELS[procurement.procurementType]}
            </span>
            {procurement.supplierName && (
              <span>
                <span className="font-medium text-zinc-400">
                  Supplier / Store{" "}
                </span>
                {procurement.supplierName}
              </span>
            )}
            {procurement.additionalFees > 0 && (
              <span>
                <span className="font-medium text-zinc-400">
                  Additional Fee{" "}
                </span>
                {formatCurrency(procurement.additionalFees)}
              </span>
            )}
          </button>
          <Link
            href={dailyLogEntryHref(
              projectId,
              dailyLogId,
              "material_procurement",
              procurement.id
            )}
            className="flex-shrink-0 text-xs font-medium text-zinc-500 transition hover:text-zinc-900 hover:underline"
          >
            View Details
          </Link>
        </div>
      </td>
    </tr>
  );
}

export function MaterialExpensesView({
  projectId,
  groups,
}: {
  projectId: number;
  groups: MaterialExpenseGroup[];
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(
    new Set(groups.slice(1).map((g) => g.dailyLogId))
  );
  const [collapsedProcurements, setCollapsedProcurements] = useState<
    Set<number>
  >(new Set());

  function toggleGroup(dailyLogId: number) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(dailyLogId)) next.delete(dailyLogId);
      else next.add(dailyLogId);
      return next;
    });
  }

  function toggleProcurement(procurementId: number) {
    setCollapsedProcurements((prev) => {
      const next = new Set(prev);
      if (next.has(procurementId)) next.delete(procurementId);
      else next.add(procurementId);
      return next;
    });
  }

  const grandTotal = groups.reduce((sum, g) => sum + g.groupTotal, 0);
  const totalItemCount = (group: MaterialExpenseGroup) =>
    group.procurements.reduce((sum, p) => sum + p.items.length, 0);

  return (
    <TableShell
      title="Material Expenses"
      isEmpty={groups.length === 0}
      emptyLabel="No approved daily logs have recorded material expenses yet."
    >
      <table className="w-full table-fixed text-left text-sm">
        <colgroup>
          <col className="w-36" />
          <col />
          <col />
          <col className="w-24" />
          <col className="w-20" />
          <col className="w-28" />
          <col className="w-28" />
        </colgroup>
        <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
          <tr>
            <th className="border-r border-zinc-200 px-4 py-2.5">Date</th>
            <th className="border-r border-zinc-200 px-4 py-2.5">
              Material Name
            </th>
            <th className="border-r border-zinc-200 px-4 py-2.5">
              Specification
            </th>
            <th className="border-r border-zinc-200 px-4 py-2.5">Quantity</th>
            <th className="border-r border-zinc-200 px-4 py-2.5">Unit</th>
            <th className="border-r border-zinc-200 px-4 py-2.5">Unit Cost</th>
            <th className="px-4 py-2.5">Sub Total</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const isGroupOpen = !collapsedGroups.has(group.dailyLogId);
            return (
              <Fragment key={group.dailyLogId}>
                <GroupHeaderRow
                  projectId={projectId}
                  dailyLogId={group.dailyLogId}
                  logDate={group.logDate}
                  count={totalItemCount(group)}
                  isOpen={isGroupOpen}
                  onToggle={() => toggleGroup(group.dailyLogId)}
                  colSpan={COLUMN_COUNT}
                />
                {isGroupOpen &&
                  group.procurements.map((procurement) => {
                    const isProcOpen = !collapsedProcurements.has(
                      procurement.id
                    );
                    return (
                      <Fragment key={procurement.id}>
                        <ProcurementSubRow
                          projectId={projectId}
                          dailyLogId={group.dailyLogId}
                          procurement={procurement}
                          isOpen={isProcOpen}
                          onToggle={() => toggleProcurement(procurement.id)}
                        />
                        {isProcOpen &&
                          procurement.items.map((item) => (
                            <tr
                              key={item.id}
                              className="border-y border-zinc-100 transition-colors hover:bg-zinc-50"
                            >
                              <td className="border-r border-zinc-200 px-4 py-2.5" />
                              <td className="border-r border-zinc-200 px-4 py-2.5 font-medium text-zinc-900">
                                {item.materialName}
                              </td>
                              <td className="border-r border-zinc-200 px-4 py-2.5 text-zinc-600">
                                {item.specification || "—"}
                              </td>
                              <td className="border-r border-zinc-200 px-4 py-2.5 text-zinc-700">
                                {String(item.quantity).padStart(2, "0")}
                              </td>
                              <td className="border-r border-zinc-200 px-4 py-2.5 text-zinc-600">
                                {item.unit || "—"}
                              </td>
                              <td className="border-r border-zinc-200 px-4 py-2.5 text-zinc-700">
                                {formatCurrency(item.unitCost)}
                              </td>
                              <td className="px-4 py-2.5 font-medium text-zinc-900">
                                {formatCurrency(item.subTotal)}
                              </td>
                            </tr>
                          ))}
                      </Fragment>
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
