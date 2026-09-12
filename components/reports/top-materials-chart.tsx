"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";
import { ResponsiveContainer } from "recharts";
import type { TopMaterial } from "@/lib/reports/data";
import { SEQUENTIAL_HUE, CHART_INK } from "@/components/reports/colors";

function formatCurrency(amount: number) {
  return `₱${amount.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

/** Ranked magnitude of one measure (cost) across materials — a single
 * sequential hue, not a categorical palette, since these bars aren't a
 * fixed reusable entity set the way Material/Labor/Equipment are. */
export function TopMaterialsChart({ data }: { data: TopMaterial[] }) {
  if (data.length === 0) {
    return (
      <p className="flex h-56 items-center justify-center text-sm text-zinc-400">
        No material costs recorded yet.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 24, bottom: 4, left: 4 }}
      >
        <CartesianGrid horizontal={false} stroke={CHART_INK.grid} />
        <XAxis
          type="number"
          tick={{ fill: CHART_INK.muted, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: CHART_INK.grid }}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fill: CHART_INK.secondary, fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={100}
        />
        <Tooltip
          formatter={(value) => formatCurrency(Number(value ?? 0))}
          contentStyle={{
            borderRadius: 8,
            borderColor: CHART_INK.grid,
            fontSize: 12,
          }}
        />
        <Bar dataKey="cost" radius={[0, 4, 4, 0]} maxBarSize={22}>
          {data.map((entry) => (
            <Cell key={entry.name} fill={SEQUENTIAL_HUE} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
