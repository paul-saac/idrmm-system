"use client";

import { useMemo, useState } from "react";
import { CalendarDays, Plus } from "lucide-react";
import { DailyLogCard } from "@/components/projects/daily-logs/daily-log-card";
import { AddDailyLogModal } from "@/components/projects/daily-logs/add-daily-log-modal";
import type { DailyLogStatus, DailyLogSummary } from "@/lib/daily-logs/data";
import type { CostCategory } from "@/lib/cost-estimate/data";
import type { ProjectMaterial } from "@/lib/materials/data";
import type { MaterialRequestDetail } from "@/lib/material-requests/data";
import type { EquipmentRequestDetail } from "@/lib/equipment-requests/data";

const STATUS_OPTIONS: { value: "all" | DailyLogStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

export function DailyLogsView({
  projectId,
  categories,
  materials,
  materialRequests,
  equipmentRequests,
  logs,
}: {
  projectId: number;
  categories: CostCategory[];
  materials: ProjectMaterial[];
  materialRequests: MaterialRequestDetail[];
  equipmentRequests: EquipmentRequestDetail[];
  logs: DailyLogSummary[];
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | DailyLogStatus>(
    "all"
  );
  const [dateFilter, setDateFilter] = useState("");

  const categoryOptions = useMemo(
    () =>
      categories.map((category) => ({
        id: category.id,
        name: category.name,
        tasks: category.tasks.map((task) => ({
          id: task.id,
          name: task.name,
          unit: task.unit,
          estimatedQuantity: task.estimatedQuantity,
        })),
      })),
    [categories]
  );

  const filtered = logs.filter((log) => {
    const matchesStatus = statusFilter === "all" || log.status === statusFilter;
    const matchesDate = !dateFilter || log.logDate === dateFilter;
    return matchesStatus && matchesDate;
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as "all" | DailyLogStatus)
          }
          className="cursor-pointer appearance-none rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <label className="flex cursor-pointer items-center gap-1.5 rounded border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50">
          <CalendarDays className="size-4" />
          {dateFilter || "Filter By Date"}
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="absolute size-0 opacity-0"
          />
        </label>
        {dateFilter && (
          <button
            type="button"
            onClick={() => setDateFilter("")}
            className="cursor-pointer text-xs text-zinc-400 underline hover:text-zinc-600"
          >
            Clear
          </button>
        )}

        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="flex cursor-pointer items-center gap-1.5 rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800"
        >
          <Plus className="size-4" />
          Add Daily Log
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white py-16 text-center">
          <p className="text-sm font-medium text-zinc-700">
            {logs.length === 0
              ? "No daily logs yet"
              : "No daily logs match your filters"}
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            {logs.length === 0
              ? "Add a daily log to start recording progress on site."
              : "Try a different status or date."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((log) => (
            <DailyLogCard key={log.id} projectId={projectId} log={log} />
          ))}
        </div>
      )}

      <AddDailyLogModal
        projectId={projectId}
        categories={categoryOptions}
        materials={materials}
        materialRequests={materialRequests}
        equipmentRequests={equipmentRequests}
        existingLogDates={logs.map((log) => log.logDate)}
        open={addOpen}
        onClose={() => setAddOpen(false)}
      />
    </div>
  );
}
