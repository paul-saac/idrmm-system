"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { ViewMenu, type ViewOption } from "@/components/ui/view-menu";
import type { ProgressMaterialUsage } from "@/lib/materials/data";
import type { MaterialRecord } from "@/lib/materials/records";
import { materialKey } from "@/lib/task-progress/calculate";

type RecordView = "materials" | "requests";
const VIEWS: ViewOption<RecordView>[] = [
  { value: "materials", label: "Material usage" },
  { value: "requests", label: "Material requests" },
];

function day(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}
function number(value: number) {
  return value.toLocaleString("en-PH", { maximumFractionDigits: 2 });
}
function peso(value: number) {
  return `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function MaterialUsageRecordView({ entries, records, onViewChange, onOpenProgressLog }: {
  entries: ProgressMaterialUsage[];
  records: MaterialRecord[];
  onViewChange: (view: RecordView) => void;
  onOpenProgressLog: (itemKey: string, entryDate: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "planned" | "additional">("all");
  const priced = useMemo(() => {
    const byMaterial = new Map(records.map((record) => [record.key, record]));
    return entries.map((entry) => {
      const record = byMaterial.get(materialKey(entry.materialName, entry.unit));
      const item = record?.items.find((candidate) => candidate.key === entry.itemKey);
      const rate = entry.unitCost ?? (item && item.planned > 0
        ? item.budget / item.planned
        : record && record.planned > 0 ? record.budget / record.planned : 0);
      return { ...entry, planned: entry.unitCost === null, plannedQuantity: item?.planned ?? 0, rate, value: entry.quantity * rate };
    });
  }, [entries, records]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = priced.filter((entry) =>
      (kind === "all" || (kind === "planned") === entry.planned) &&
      (!q || entry.materialName.toLowerCase().includes(q) || entry.itemName.toLowerCase().includes(q))
    );
    return filtered;
  }, [priced, query, kind]);
  const totalValue = shown.reduce((sum, entry) => sum + entry.value, 0);

  return <div className="flex flex-col gap-3">
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
      <div className="flex items-baseline gap-3">
        <h2 className="text-base font-semibold text-zinc-900">Material usage record</h2>
        <span className="text-xs text-zinc-400">{entries.length} {entries.length === 1 ? "usage entry" : "usage entries"}</span>
      </div>
    </div>
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-3">
        <ViewMenu views={VIEWS} value="materials" onChange={onViewChange} />
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search material or task..." aria-label="Search material usage"
            className="w-full rounded-md border border-zinc-200 bg-white py-2 pr-3 pl-9 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200" />
        </div>
        <div className="relative">
          <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} aria-label="Filter material usage type"
            className="cursor-pointer appearance-none rounded-md border border-zinc-200 bg-white py-2 pr-9 pl-3 text-sm text-zinc-700 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200">
            <option value="all">All usage</option><option value="planned">Planned materials</option><option value="additional">Additional materials</option>
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-zinc-500" />
        </div>
      </div>
      {shown.length === 0 ? (
        <EmptyState className="py-10 text-center text-sm text-zinc-400">
          {entries.length
            ? "No usage entries match your filters."
            : "No materials have been recorded in Today's Log yet."}
        </EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[64rem] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-500">
                <tr>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-4 py-3">Material</th>
                  <th className="px-4 py-3">Task</th>
                  <th className="px-4 py-3 text-right">Quantity used</th>
                  <th className="px-4 py-3 text-right">Planned quantity</th>
                  <th className="px-4 py-3 text-right">Reference unit rate</th>
                  <th className="px-5 py-3 text-right">Reference value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {shown.map((entry) => (
                  <tr
                    key={entry.id}
                    tabIndex={0}
                    role="link"
                    onClick={() => onOpenProgressLog(entry.itemKey, entry.entryDate)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") onOpenProgressLog(entry.itemKey, entry.entryDate);
                    }}
                    className="cursor-pointer transition hover:bg-zinc-50"
                  >
                    <td className="whitespace-nowrap px-5 py-3.5 text-zinc-600">
                      {day(entry.entryDate)}
                    </td>
                    <td className="px-4 py-3.5 font-semibold text-zinc-900">
                      {entry.materialName}
                    </td>
                    <td className="px-4 py-3.5 text-zinc-600">{entry.itemName}</td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right font-semibold tabular-nums">
                      {number(entry.quantity)}
                      {entry.unit ? (
                        <span className="font-normal text-zinc-400"> {entry.unit}</span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums">
                      {entry.plannedQuantity > 0 ? (
                        <>
                          {number(entry.plannedQuantity)}
                          {entry.unit ? (
                            <span className="text-zinc-400"> {entry.unit}</span>
                          ) : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums">
                      {entry.rate > 0 ? peso(entry.rate) : "—"}
                    </td>
                    <td className="px-5 py-3.5 text-right font-semibold tabular-nums">
                      {entry.value > 0 ? peso(entry.value) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 px-5 py-3 text-xs text-zinc-500">
            <div>
              Showing <span className="font-semibold text-zinc-700">{shown.length}</span> of{" "}
              <span className="font-semibold text-zinc-700">{entries.length}</span>{" "}
              {entries.length === 1 ? "entry" : "entries"}
              <span className="text-zinc-400"> · Reference values are not purchase expenses</span>
            </div>
            {totalValue > 0 && (
              <div>
                Total:{" "}
                <span className="font-semibold text-zinc-900 tabular-nums">
                  {peso(totalValue)}
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  </div>;
}
