"use client";

import { PieChart, Pie, Cell, Tooltip } from "recharts";
import { CHART_INK } from "@/components/reports/colors";

export type DonutSegment = {
  label: string;
  value: number;
  color: string;
  /** Pre-formatted for display (e.g. "₱120,000" or "-₱6,000") — the
   * donut doesn't know whether its values are currency, percent, etc. */
  formattedValue: string;
};

function formatCurrency(amount: number) {
  return `₱${amount.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

/**
 * A small part-to-whole donut with its legend below, used for every
 * Planned/Actual/Balance and category-breakdown chart on the Reports
 * page — one component so the mark spec (gap between segments, no
 * color-only labels) only has to be right once. Values can be negative
 * (e.g. an over-budget "Balance") — the donut only plots magnitude, the
 * sign lives in the legend's formattedValue text.
 */
export function DonutChart({ id, segments }: { id: string; segments: DonutSegment[] }) {
  const plottable = segments.filter((s) => s.value !== 0);
  const isEmpty = plottable.every((s) => s.value === 0) || plottable.length === 0;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="h-40 w-40">
        {isEmpty ? (
          <div className="flex h-full w-full items-center justify-center rounded-full border-8 border-zinc-100">
            <span className="text-xs text-zinc-400">No data</span>
          </div>
        ) : (
          // Fixed pixel width/height rather than ResponsiveContainer: a
          // small fixed-size donut doesn't need to track its parent's
          // size, and ResponsiveContainer's ResizeObserver-based sizing
          // is unreliable on first paint inside a CSS grid cell (renders
          // a near-zero box until a resize event fires) — a known
          // recharts limitation, not something to work around per-donut.
          //
          // The explicit `id` matters more than usual here: recharts 3
          // keeps each chart's state in a shared store keyed by an
          // auto-generated id when none is given, and with several
          // PieChart instances mounted at once (four donuts on this one
          // page) that auto-generated id can collide across instances —
          // observed as sectors only sweeping a few degrees instead of
          // the full circle, as if computing angles against a mixed-in
          // total from a different chart. A distinct id per donut avoids
          // that entirely.
          <PieChart id={id} width={160} height={160}>
            <Pie
              data={plottable.map((s) => ({ ...s, value: Math.abs(s.value) }))}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={78}
              paddingAngle={plottable.length > 1 ? 3 : 0}
              stroke="#ffffff"
              strokeWidth={2}
            >
              {plottable.map((s) => (
                <Cell key={s.label} fill={s.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name) => [formatCurrency(Number(value ?? 0)), name]}
              contentStyle={{
                borderRadius: 8,
                borderColor: CHART_INK.grid,
                fontSize: 12,
              }}
            />
          </PieChart>
        )}
      </div>
      <ul className="flex w-full flex-col gap-1.5">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-3 text-xs">
            <span className="flex items-center gap-1.5 text-zinc-600">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              {s.label}
            </span>
            <span className="font-medium text-zinc-900">{s.formattedValue}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
