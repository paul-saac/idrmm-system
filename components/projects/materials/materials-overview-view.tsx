import type { ReactNode } from "react";
import { ClipboardList, PackageMinus, SquareCheck, TrendingDown } from "lucide-react";

export type MaterialsOverviewCounts = {
  totalMaterials: number;
  availableMaterials: number;
  lowStockMaterials: number;
  consumedMaterials: number;
};

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
    <div className="rounded-lg border border-zinc-200 bg-white p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-zinc-500">{label}</p>
        <span className="flex-shrink-0 text-zinc-400">{icon}</span>
      </div>
      <p className="mt-2 text-xl font-semibold text-zinc-900">
        {String(value).padStart(2, "0")}
      </p>
    </div>
  );
}

/**
 * Materials Overview sub-tab: just the summary card row for now — the
 * "Recent Material Usage Logs" / "Recent Material Procurement" tables
 * below them come later, once the Materials Monitoring/Usage Logs/
 * Requests sub-tabs (and the data model behind them) are built.
 *
 * counts is a hardcoded zero-state until that data model exists — the
 * project doesn't have a per-project material stock table yet, only the
 * generic `materials` catalog and `material_requests`/`material_usage`
 * tables, none of which track on-hand quantity or a low-stock threshold.
 */
export function MaterialsOverviewView({
  counts = {
    totalMaterials: 0,
    availableMaterials: 0,
    lowStockMaterials: 0,
    consumedMaterials: 0,
  },
}: {
  counts?: MaterialsOverviewCounts;
}) {
  return (
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
  );
}
