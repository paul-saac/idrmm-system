"use client";

import { EmptyState } from "@/components/ui/empty-state";

import { useMemo, useState } from "react";
import { ChevronRight, Receipt } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { EXPENSE_CATEGORIES, summarizeProgressExpenses, type ProgressExpense } from "@/lib/expenses/progress";
import type { CostAmounts } from "@/lib/task-progress/calculate";

const labels = { material: "Material", equipment: "Equipment", labor: "Labor", other: "Other" };
const money = (value: number) => `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateLabel = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
const axisMoney = (value: number) => `₱${new Intl.NumberFormat("en", { notation: "compact" }).format(value)}`;

export function ProgressExpensesView({ entries, planned, onOpenProgressLog }: {
  entries: ProgressExpense[];
  planned: CostAmounts;
  onOpenProgressLog: (itemKey: string, entryDate: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const summary = useMemo(() => summarizeProgressExpenses(entries), [entries]);
  const comparison = EXPENSE_CATEGORIES.map((key) => ({ name: labels[key], planned: planned[key], logged: summary.actual[key] }));

  return (
    <div className="flex flex-col gap-6 pt-6">
      <section className="rounded border border-zinc-200 bg-white">
        <button type="button" aria-expanded={open} aria-controls="expense-overview-details" onClick={() => setOpen(!open)} className="flex w-full cursor-pointer items-center gap-3 px-5 py-3.5 text-left hover:bg-zinc-50">
          <Receipt aria-hidden className="size-4 shrink-0 text-zinc-400" />
          <span className="text-sm font-semibold text-zinc-900">Expense overview</span>
          <span className="min-w-0 flex-1 truncate text-sm text-zinc-400">Costs and spending comparisons</span>
          <span className="ml-auto flex shrink-0 items-center gap-1 text-sm text-zinc-700">{open ? "Hide details" : "View details"}<ChevronRight className={`size-4 transition-transform ${open ? "rotate-90" : ""}`} /></span>
        </button>
        {open && <div id="expense-overview-details" className="border-t border-zinc-200">
          <div className="grid divide-x divide-y divide-zinc-200 border-b-2 border-zinc-900 sm:grid-cols-2 xl:grid-cols-5">
            {[{ label: "Total expenses", value: summary.total }, ...EXPENSE_CATEGORIES.map((key) => ({ label: `${labels[key]} expenses`, value: summary.actual[key] }))].map((card) => (
              <div key={card.label} className="p-5"><p className="text-sm text-zinc-500">{card.label}</p><p className="mt-2 text-2xl font-bold tabular-nums text-zinc-900">{money(card.value)}</p></div>
            ))}
          </div>
          <div className="grid divide-y divide-zinc-200 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] lg:divide-x lg:divide-y-0">
            <div className="min-w-0 p-5">
              <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900">Planned vs. actual expenses</h3>
                  <p className="mt-1 text-xs text-zinc-400">Cost estimate and saved progress costs · PHP</p>
                </div>
                <div className="flex items-center gap-4 text-xs text-zinc-500">
                  <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-zinc-300" />Planned</span>
                  <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-teal-700" />Actual</span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={comparison} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid vertical={false} stroke="#f4f4f5" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#71717a" }} tickLine={false} axisLine={{ stroke: "#e4e4e7" }} />
                  <YAxis tickFormatter={axisMoney} width={65} tick={{ fontSize: 11, fill: "#a1a1aa" }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(value) => money(Number(value ?? 0))} contentStyle={{ borderColor: "#e4e4e7", borderRadius: 4, fontSize: 12 }} />
                  <Bar dataKey="planned" name="Planned" fill="#d4d4d8" maxBarSize={60} isAnimationActive={false} />
                  <Bar dataKey="logged" name="Actual" fill="#0f766e" maxBarSize={60} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
              <p className="mt-4 border-t border-zinc-200 pt-3 text-xs leading-relaxed text-zinc-400">Planned costs come from the cost estimate. Material actuals use recorded purchases; other categories use saved progress logs. Usage is not charged again.</p>
            </div>
            <div className="min-w-0 p-5">
              <h3 className="text-sm font-semibold text-zinc-900">Spending by category</h3>
              <p className="mt-1 text-xs text-zinc-400">Share of total actual expenses</p>
              <div className="mt-6 space-y-5">
                {EXPENSE_CATEGORIES.map((key) => {
                  const percent = summary.total > 0 ? summary.actual[key] / summary.total * 100 : 0;
                  return <div key={key}>
                    <div className="mb-2 flex items-center justify-between gap-3 text-sm text-zinc-700">
                      <span>{labels[key]}</span><span className="tabular-nums">{money(summary.actual[key])}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-1 flex-1 overflow-hidden rounded-sm bg-zinc-100" aria-hidden>
                        <div className="h-full rounded-sm bg-teal-700" style={{ width: `${percent}%` }} />
                      </div>
                      <span className="w-12 text-right text-xs tabular-nums text-zinc-400">{percent.toFixed(1)}%</span>
                    </div>
                  </div>;
                })}
              </div>
              <div className="mt-6 flex items-center justify-between gap-3 border-t border-zinc-200 pt-4 text-sm">
                <span className="text-zinc-500">Actual total</span><span className="font-semibold tabular-nums text-zinc-900">{money(summary.total)}</span>
              </div>
            </div>
          </div>
        </div>}
      </section>

      {EXPENSE_CATEGORIES.map((category) => {
        const rows = entries.filter((entry) => entry.costs[category] > 0);
        return <section key={category} aria-labelledby={`${category}-expense-heading`}>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 id={`${category}-expense-heading`} className="text-sm font-semibold text-zinc-800">{labels[category]} expenses</h2>
            <span className="text-xs text-zinc-400">{rows.length}</span>
          </div>
          <div className="overflow-x-auto rounded border border-zinc-200 bg-white">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-500"><tr><th className="w-40 px-5 py-3">{category === "material" ? "Purchase date" : "Log date"}</th><th className="px-5 py-3">{category === "material" ? "Material / invoice" : "Task / phase"}</th><th className="px-5 py-3">{category === "material" ? "Supplier" : "Saved by"}</th><th className="px-5 py-3 text-right">Amount</th></tr></thead>
              <tbody className="divide-y divide-zinc-100">{rows.length ? rows.map((entry) => <tr key={entry.id} onClick={category === "material" ? undefined : () => onOpenProgressLog(entry.itemKey, entry.entryDate)} className="cursor-pointer hover:bg-sky-50/60 focus-within:bg-sky-50/60">
                <td className="px-5 py-4 align-top">{category === "material" ? dateLabel(entry.entryDate) : <button type="button" onClick={(event) => { event.stopPropagation(); onOpenProgressLog(entry.itemKey, entry.entryDate); }} aria-label={`View ${labels[category].toLowerCase()} progress log for ${entry.itemName}, ${dateLabel(entry.entryDate)}`} className="cursor-pointer text-sky-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-sky-500">{dateLabel(entry.entryDate)}</button>}</td>
                <td className="px-5 py-4 align-top font-medium">
                  {category === "equipment" && entry.equipmentName ? (
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-zinc-900">{entry.equipmentName}</span>
                        {entry.isUnplanned && (
                          <span className="shrink-0 rounded bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700">
                            Unplanned
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs font-normal text-zinc-500">
                        Task: {entry.itemName}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <span>{entry.itemName}</span>
                      {category === "material" && (
                        <div className="text-xs font-normal text-zinc-400">
                          {entry.invoiceNumber || "No invoice reference"}
                        </div>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-5 py-4 align-top text-zinc-500">{(category === "material" ? entry.supplier : entry.savedByName) ?? "—"}</td>
                <td className="px-5 py-4 align-top text-right font-medium tabular-nums">{money(entry.costs[category])}</td>
              </tr>) : <tr><td colSpan={4} className="px-5 py-10"><EmptyState compact>No {labels[category].toLowerCase()} expenses recorded yet.</EmptyState></td></tr>}</tbody>
            </table>
          </div>
        </section>;
      })}
    </div>
  );
}
