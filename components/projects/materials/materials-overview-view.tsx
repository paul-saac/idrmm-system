"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { ClipboardList, PackageMinus, SquareCheck, TrendingDown } from "lucide-react";
import { dailyLogEntryHref } from "@/lib/daily-logs/flag-state";
import type { MaterialStatus, MaterialUsageHistoryEntry, TodayProcurementEntry } from "@/lib/materials/data";

export type MaterialsOverviewCounts = {
  totalMaterials: number;
  availableMaterials: number;
  lowStockMaterials: number;
  consumedMaterials: number;
};

const PROCUREMENT_TYPE_LABELS: Record<string, string> = {
  direct_purchase: "Direct Purchase",
  supplier_delivery: "Supplier Delivery",
};

const PROCUREMENT_TYPE_BADGE: Record<string, string> = {
  direct_purchase: "bg-violet-50 text-violet-700",
  supplier_delivery: "bg-amber-50 text-amber-700",
};

function formatCurrency(amount: number) {
  return `₱${amount.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
}

function formatDateLong(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// rounded-sm (not rounded-full) to match Material Usage History's own
// StatusBadge shape/colors exactly — same status domain, same table.
function UsageStatusBadge({ status }: { status: MaterialStatus }) {
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
    <div className="relative rounded-t-lg border border-zinc-200 bg-white p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-zinc-500">{label}</p>
        <span className="flex-shrink-0 text-zinc-400">{icon}</span>
      </div>
      <p className="mt-2 text-xl font-semibold text-zinc-900">
        {String(value).padStart(2, "0")}
      </p>
      {/* A plain fill bar, not a border-b — see StatCard's own comment
          in project-detail-view.tsx for why a border-b here mitered a
          visible diagonal notch into the corner instead of a straight
          edge. */}
      <div className="absolute inset-x-0 bottom-0 h-1 bg-zinc-900" />
    </div>
  );
}

/**
 * A quick-glance slice of Material Usage History — the newest handful
 * of entries (already sorted newest-first by listMaterialUsageHistory),
 * not the full paginated ledger that lives on its own sub-tab. Each row
 * still links straight to the exact entry on its Daily Log, same as the
 * full history table.
 */
function RecentMaterialUsageCard({
  projectId,
  entries,
}: {
  projectId: number;
  entries: MaterialUsageHistoryEntry[];
}) {
  const recent = entries.slice(0, 6);

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-zinc-900">
          Recent Material Usage
        </h3>
      </div>
      {recent.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-400">
          No material usage recorded yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
              <tr>
                <th className="w-32 border-r border-zinc-200 px-4 py-2.5">Date</th>
                <th className="border-r border-zinc-200 px-4 py-2.5">Material Name</th>
                <th className="w-36 border-r border-zinc-200 px-4 py-2.5">Status</th>
                <th className="w-56 px-4 py-2.5">Activity</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((entry) => (
                <tr
                  key={entry.id}
                  className="cursor-pointer border-b border-zinc-100 transition-colors last:border-0 hover:bg-zinc-50"
                >
                  <td className="border-r border-zinc-200 px-4 py-2.5 text-zinc-600">
                    <Link
                      href={dailyLogEntryHref(
                        projectId,
                        entry.dailyLogId,
                        "material_usage_item",
                        entry.id
                      )}
                      className="block"
                    >
                      {formatDateLong(entry.logDate)}
                    </Link>
                  </td>
                  <td className="truncate border-r border-zinc-200 px-4 py-2.5 font-medium text-zinc-900">
                    <Link
                      href={dailyLogEntryHref(
                        projectId,
                        entry.dailyLogId,
                        "material_usage_item",
                        entry.id
                      )}
                      className="block truncate"
                    >
                      {entry.materialName}
                    </Link>
                  </td>
                  <td className="border-r border-zinc-200 px-4 py-2.5">
                    <UsageStatusBadge status={entry.status} />
                  </td>
                  <td className="truncate px-4 py-2.5 text-zinc-600">
                    {entry.activity || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Every material procurement entry logged on *today's* Daily Log, in
 * full detail (supplier, items, quantities, costs) — not just a count.
 * A project has at most one daily log per date, so "today" is always
 * at most one log's worth of entries. Includes a still-pending log's
 * procurement (unlike the Expenses tab's own Material Expenses ledger,
 * which only counts *approved* logs) — this is "what came in today,"
 * not a financial record yet.
 */
function TodayProcurementCard({
  projectId,
  entries,
}: {
  projectId: number;
  entries: TodayProcurementEntry[];
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-zinc-900">
          Material Procurement (Today)
        </h3>
        <span className="text-xs text-zinc-400">{formatDateLong(todayIso())}</span>
      </div>
      {entries.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-400">
          No material procurement recorded today.
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-zinc-100 p-4">
          {entries.map((entry) => (
            <div key={entry.id} className="py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-sm px-2 py-0.5 text-xs font-medium ${PROCUREMENT_TYPE_BADGE[entry.procurementType]}`}
                  >
                    {PROCUREMENT_TYPE_LABELS[entry.procurementType]}
                  </span>
                  {entry.supplierName && (
                    <span className="text-sm text-zinc-700">
                      <span className="text-zinc-400">Supplier / Store </span>
                      {entry.supplierName}
                    </span>
                  )}
                  {entry.additionalFees > 0 && (
                    <span className="text-xs text-zinc-500">
                      + {formatCurrency(entry.additionalFees)} fees
                    </span>
                  )}
                </div>
                <Link
                  href={dailyLogEntryHref(
                    projectId,
                    entry.dailyLogId,
                    "material_procurement",
                    entry.id
                  )}
                  className="inline-flex flex-shrink-0 cursor-pointer items-center rounded-sm border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
                >
                  View Details
                </Link>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-zinc-500">
                    <tr>
                      <th className="px-2 py-2 font-medium">Material Name</th>
                      <th className="px-2 py-2 font-medium">Specification</th>
                      <th className="px-2 py-2 font-medium">Quantity</th>
                      <th className="px-2 py-2 font-medium">Unit</th>
                      <th className="px-2 py-2 font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {entry.items.map((item) => (
                      <tr key={item.id}>
                        <td className="px-2 py-2.5 font-medium text-zinc-900">
                          {item.materialName}
                        </td>
                        <td className="px-2 py-2.5 text-zinc-600">
                          {item.specification || "—"}
                        </td>
                        <td className="px-2 py-2.5 text-zinc-700">{item.quantity}</td>
                        <td className="px-2 py-2.5 text-zinc-600">
                          {item.unit || "—"}
                        </td>
                        <td className="px-2 py-2.5 text-zinc-700">
                          {formatCurrency(item.cost)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Materials Overview sub-tab: the summary card row, plus a quick-glance
 * Recent Material Usage table and today's Material Procurement in full
 * detail — the two pieces this sub-tab was missing (see the git history
 * on this file for the earlier "comes later" placeholder note).
 */
export function MaterialsOverviewView({
  projectId,
  counts = {
    totalMaterials: 0,
    availableMaterials: 0,
    lowStockMaterials: 0,
    consumedMaterials: 0,
  },
  materialUsageHistory,
  todayProcurement,
}: {
  projectId: number;
  counts?: MaterialsOverviewCounts;
  materialUsageHistory: MaterialUsageHistoryEntry[];
  todayProcurement: TodayProcurementEntry[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          label="Consumed Materials"
          value={counts.consumedMaterials}
          icon={<PackageMinus className="size-4" />}
        />
      </div>

      <RecentMaterialUsageCard projectId={projectId} entries={materialUsageHistory} />
      <TodayProcurementCard projectId={projectId} entries={todayProcurement} />
    </div>
  );
}
