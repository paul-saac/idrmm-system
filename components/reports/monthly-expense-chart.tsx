"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { MonthlyExpensePoint } from "@/lib/reports/data";
import { CATEGORY_COLORS, CHART_INK } from "@/components/reports/colors";

function formatCurrency(amount: number) {
  return `₱${amount.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

function formatAxisValue(amount: number) {
  if (amount >= 1000) return `${Math.round(amount / 1000)},000`;
  return `${amount}`;
}

export function MonthlyExpenseChart({ data }: { data: MonthlyExpensePoint[] }) {
  if (data.length === 0) {
    return (
      <p className="flex h-64 items-center justify-center text-sm text-zinc-400">
        No approved expenses yet to chart.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={CHART_INK.grid} />
        <XAxis
          dataKey="label"
          tick={{ fill: CHART_INK.muted, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: CHART_INK.grid }}
        />
        <YAxis
          tick={{ fill: CHART_INK.muted, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatAxisValue}
          width={56}
        />
        <Tooltip
          formatter={(value) => formatCurrency(Number(value ?? 0))}
          contentStyle={{
            borderRadius: 8,
            borderColor: CHART_INK.grid,
            fontSize: 12,
          }}
        />
        <Legend
          verticalAlign="bottom"
          height={28}
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, color: CHART_INK.secondary }}
        />
        <Area
          type="monotone"
          dataKey="equipment"
          name="Equipment"
          stackId="1"
          stroke={CATEGORY_COLORS.equipment}
          fill={CATEGORY_COLORS.equipment}
          fillOpacity={0.18}
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="labor"
          name="Labor"
          stackId="1"
          stroke={CATEGORY_COLORS.labor}
          fill={CATEGORY_COLORS.labor}
          fillOpacity={0.18}
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="material"
          name="Material"
          stackId="1"
          stroke={CATEGORY_COLORS.material}
          fill={CATEGORY_COLORS.material}
          fillOpacity={0.18}
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
