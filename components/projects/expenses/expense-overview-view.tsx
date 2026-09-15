import type { ReactNode } from "react";
import { Receipt, HardHat, Boxes, Wrench } from "lucide-react";
import { TotalCostsChart } from "@/components/projects/total-costs-chart";
import { ExpenseDonutCard } from "@/components/projects/expenses/expense-donut-chart";
import type { ExpenseOverview } from "@/lib/expenses/data";

function ExpenseStatCard({
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
 * The Expenses tab's Overview sub-tab — a roll-up of the other four
 * sub-tabs' own data (see summarizeExpenses in lib/expenses/data.ts),
 * not a separate query. "Planned" comes from the Cost Estimate's own
 * per-column totals, the only place a planned figure exists in this
 * project; "Actual" is the sum of every approved daily log's entries.
 */
export function ExpenseOverviewView({
  overview,
}: {
  overview: ExpenseOverview;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ExpenseStatCard
          label="Total Expenses"
          value={overview.counts.total}
          icon={<Receipt className="size-4" />}
        />
        <ExpenseStatCard
          label="Labor Expenses"
          value={overview.counts.labor}
          icon={<HardHat className="size-4" />}
        />
        <ExpenseStatCard
          label="Material Expenses"
          value={overview.counts.material}
          icon={<Boxes className="size-4" />}
        />
        <ExpenseStatCard
          label="Equipment Expenses"
          value={overview.counts.equipment}
          icon={<Wrench className="size-4" />}
        />
      </div>

      <TotalCostsChart
        subtitle="Actual spend by category, this project"
        bars={[
          {
            label: "Total Material Costs",
            value: overview.actual.material,
            colorClass: "bg-sky-300",
          },
          {
            label: "Total Labor Costs",
            value: overview.actual.labor,
            colorClass: "bg-amber-200",
          },
          {
            label: "Total Equipment Costs",
            value: overview.actual.equipment,
            colorClass: "bg-violet-200",
          },
          {
            label: "Total Other Costs",
            value: overview.actual.other,
            colorClass: "bg-rose-200",
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ExpenseDonutCard
          title="Material Costs"
          planned={overview.planned.material}
          actual={overview.actual.material}
        />
        <ExpenseDonutCard
          title="Labor Costs"
          planned={overview.planned.labor}
          actual={overview.actual.labor}
        />
        <ExpenseDonutCard
          title="Equipment Costs"
          planned={overview.planned.equipment}
          actual={overview.actual.equipment}
        />
        <ExpenseDonutCard
          title="Other Costs"
          planned={overview.planned.other}
          actual={overview.actual.other}
        />
      </div>
    </div>
  );
}
