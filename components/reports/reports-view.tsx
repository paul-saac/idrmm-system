"use client";

import { useRef } from "react";
import { FileText, Wallet, Receipt, TrendingUp, TrendingDown } from "lucide-react";
import type { ReportData, DateRange } from "@/lib/reports/data";
import {
  projectStatusLabel,
  projectStatusBadgeClasses,
} from "@/lib/projects/status";
import { ProjectPicker, type ProjectOption } from "@/components/reports/project-picker";
import { StatCard } from "@/components/reports/stat-card";
import { MonthlyExpenseChart } from "@/components/reports/monthly-expense-chart";
import { TopMaterialsChart } from "@/components/reports/top-materials-chart";
import { DonutChart } from "@/components/reports/donut-chart";
import { DateRangeFilter } from "@/components/reports/date-range-filter";
import { ExportButtons } from "@/components/reports/export-buttons";
import {
  MaterialExpenseTable,
  LaborExpenseTable,
  EquipmentExpenseTable,
} from "@/components/reports/expense-tables";
import { CATEGORY_COLORS, STATUS_COLORS } from "@/components/reports/colors";

function formatCurrency(amount: number) {
  return `₱${amount.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

function formatSignedCurrency(amount: number) {
  const sign = amount < 0 ? "-" : "+";
  return `${sign}${formatCurrency(Math.abs(amount))}`;
}

function formatDate(iso: string | null) {
  if (!iso) return "Not set";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ReportsView({
  projects,
  selectedProjectId,
  data,
  range,
}: {
  projects: ProjectOption[];
  selectedProjectId: number | null;
  data: ReportData | null;
  range: DateRange;
}) {
  const reportRef = useRef<HTMLDivElement>(null);

  if (projects.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-zinc-500">
          No projects yet — create one to generate reports.
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <p className="text-sm text-zinc-500">Select a project to view its report.</p>
        <ProjectPicker projects={projects} selectedProjectId={selectedProjectId} />
      </div>
    );
  }

  const totalActual =
    data.overview.actual.labor +
    data.overview.actual.material +
    data.overview.actual.equipment +
    data.overview.actual.other;
  const totalPlanned =
    data.overview.planned.labor +
    data.overview.planned.material +
    data.overview.planned.equipment +
    data.overview.planned.other;
  const allocatedBudget = data.project.allocatedBudget ?? 0;
  const costVariance = allocatedBudget - totalActual;
  const remaining = Math.max(0, allocatedBudget - totalActual);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3">
        <DateRangeFilter projectId={data.project.id} range={range} />
        <ExportButtons data={data} reportRef={reportRef} />
      </div>

      <div ref={reportRef} className="flex flex-col gap-4">
      <div className="rounded-lg bg-zinc-800 p-5 text-white">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{data.project.name}</h2>
              <span
                className={`rounded-sm px-2 py-0.5 text-xs font-medium ${projectStatusBadgeClasses(data.project.status)}`}
              >
                {projectStatusLabel(data.project.status)}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-zinc-300">
              {data.project.location && <>{data.project.location} · </>}
              Project Manager: {data.project.projectManagerName ?? "—"} · Foreman:{" "}
              {data.project.foremanName ?? "—"}
            </p>
          </div>
          <ProjectPicker projects={projects} selectedProjectId={selectedProjectId} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Estimated Cost"
          value={formatCurrency(data.totalEstimatedCost)}
          icon={FileText}
        />
        <StatCard
          label="Allocated Budget"
          value={formatCurrency(allocatedBudget)}
          icon={Wallet}
        />
        <StatCard
          label="Actual Expense"
          value={formatCurrency(totalActual)}
          icon={Receipt}
        />
        <StatCard
          label="Cost Variance"
          value={formatSignedCurrency(costVariance)}
          icon={costVariance >= 0 ? TrendingUp : TrendingDown}
          tone={costVariance >= 0 ? "positive" : "negative"}
        />
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-zinc-500">Overall Progress</p>
            <p className="text-2xl font-semibold text-zinc-900">
              {data.progressPercent}%
            </p>
          </div>
          <div className="flex gap-6 text-xs text-zinc-500">
            <div>
              <p className="text-zinc-400">Start Date</p>
              <p className="mt-0.5 font-medium text-zinc-700">
                {formatDate(data.project.startDate)}
              </p>
            </div>
            <div>
              <p className="text-zinc-400">Target Completion</p>
              <p className="mt-0.5 font-medium text-zinc-700">
                {formatDate(data.project.targetEndDate)}
              </p>
            </div>
          </div>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-sm bg-zinc-100">
          <div
            className="h-full rounded-sm bg-emerald-500"
            style={{ width: `${Math.min(100, Math.max(0, data.progressPercent))}%` }}
          />
        </div>
        <p className="mt-3 text-xs text-zinc-400 italic">
          Delay risk and forecasted completion date will appear here once the
          Automated Delay Risk Assessment / Completion Forecasting module ships.
        </p>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-zinc-900">Monthly Expense</h3>
        <MonthlyExpenseChart data={data.monthlySeries} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-zinc-900">
            Top Material By Cost
          </h3>
          <TopMaterialsChart data={data.topMaterials} />
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-zinc-900">Material Costs</h3>
          <DonutChart
            id="material-costs"
            segments={[
              {
                label: "Planned Costs",
                value: data.overview.planned.material,
                color: STATUS_COLORS.planned,
                formattedValue: formatCurrency(data.overview.planned.material),
              },
              {
                label: "Actual Costs",
                value: data.overview.actual.material,
                color: STATUS_COLORS.actual,
                formattedValue: formatCurrency(data.overview.actual.material),
              },
              {
                label: "Balance",
                value: data.overview.planned.material - data.overview.actual.material,
                color: STATUS_COLORS.balance,
                formattedValue: formatSignedCurrency(
                  data.overview.planned.material - data.overview.actual.material
                ),
              },
            ]}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-zinc-900">
            Cost Breakdown by Category
          </h3>
          <DonutChart
            id="cost-breakdown"
            segments={[
              {
                label: "Material",
                value: data.overview.actual.material,
                color: CATEGORY_COLORS.material,
                formattedValue: formatCurrency(data.overview.actual.material),
              },
              {
                label: "Equipment",
                value: data.overview.actual.equipment,
                color: CATEGORY_COLORS.equipment,
                formattedValue: formatCurrency(data.overview.actual.equipment),
              },
              {
                label: "Labor",
                value: data.overview.actual.labor,
                color: CATEGORY_COLORS.labor,
                formattedValue: formatCurrency(data.overview.actual.labor),
              },
              {
                label: "Other",
                value: data.overview.actual.other,
                color: CATEGORY_COLORS.other,
                formattedValue: formatCurrency(data.overview.actual.other),
              },
            ]}
          />
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-zinc-900">
            Budget Utilization
          </h3>
          <DonutChart
            id="budget-utilization"
            segments={[
              {
                label: "Spent",
                value: totalActual,
                color: STATUS_COLORS.spent,
                formattedValue: formatCurrency(totalActual),
              },
              {
                label: "Remaining",
                value: remaining,
                color: STATUS_COLORS.remaining,
                formattedValue:
                  allocatedBudget - totalActual < 0
                    ? "₱0 (over budget)"
                    : formatCurrency(remaining),
              },
            ]}
          />
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-zinc-900">
            Planned vs Actual Cost
          </h3>
          <DonutChart
            id="planned-vs-actual"
            segments={[
              {
                label: "Planned Costs",
                value: totalPlanned,
                color: STATUS_COLORS.planned,
                formattedValue: formatCurrency(totalPlanned),
              },
              {
                label: "Actual Costs",
                value: totalActual,
                color: STATUS_COLORS.actual,
                formattedValue: formatCurrency(totalActual),
              },
              {
                label: "Balance",
                value: totalPlanned - totalActual,
                color: STATUS_COLORS.balance,
                formattedValue: formatSignedCurrency(totalPlanned - totalActual),
              },
            ]}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <MaterialExpenseTable groups={data.materialRows} />
        <LaborExpenseTable groups={data.laborRows} />
        <EquipmentExpenseTable groups={data.equipmentRows} />
      </div>
      </div>
    </div>
  );
}
