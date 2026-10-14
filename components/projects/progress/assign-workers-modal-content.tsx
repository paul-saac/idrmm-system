"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import {
  AvailabilityBadge,
  describeAssignment,
  groupAssignmentsByWorker,
} from "@/components/team/availability";
import { usePortal } from "@/components/portal/portal-context";
import type { Worker, WorkerAssignment } from "@/lib/workers/data";
import type { WorkerActionState } from "@/lib/workers/actions";

function formatDateRange(start: Date, end: Date) {
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} - ${fmt(end)}`;
}

/**
 * Opened from a row's own "Assigned" cell in the Gantt task list (see
 * gantt-chart-view.tsx) — a checkbox picker over the whole company Team
 * (the admin's Team page; there's no per-project roster any more), each
 * member shown with their title and availability: Assigned when they're
 * already on another task or phase that hasn't ended yet (any project —
 * hover the badge for which), Available otherwise. Scoped to whichever
 * one row opened it — a task or, one level up, a category with no tasks
 * yet (see CategoryWorkerAssignments's own doc comment) — via `onSave`, so
 * this component itself doesn't need to know which kind of row it's
 * editing; the caller wires it to setTaskWorkers or setCategoryWorkers.
 *
 * startDate/endDate are the SAME Date objects already shown in that
 * row's own Start/End Gantt columns, reused as-is so this badge always
 * matches what's on screen for that row.
 */
export function AssignWorkersModalContent({
  rowName,
  startDate,
  endDate,
  workers,
  assignments,
  current,
  assignedWorkerIds,
  onSave,
  onClose,
}: {
  /** The task or category name shown in this modal's own intro line —
   * "Assign workers to <rowName>." */
  rowName: string;
  startDate: Date;
  endDate: Date;
  workers: Worker[];
  /** Every member's assignments (lib/workers/data.ts) — the open ones
   * decide availability. */
  assignments: WorkerAssignment[];
  /** The row being edited — left out of its own members' availability. */
  current: { kind: "task" | "category"; id: number };
  assignedWorkerIds: number[];
  onSave: (workerIds: number[]) => Promise<WorkerActionState>;
  onClose: () => void;
}) {
  const { isAdmin } = usePortal();
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(assignedWorkerIds)
  );
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const otherAssignments = useMemo(
    () =>
      groupAssignmentsByWorker(
        assignments.filter(
          (a) => a.open && !(a.kind === current.kind && a.itemId === current.id)
        )
      ),
    [assignments, current.kind, current.id]
  );

  const q = query.trim().toLowerCase();
  const visibleWorkers = q
    ? workers.filter(
        (worker) =>
          worker.fullName.toLowerCase().includes(q) ||
          (worker.title ?? "").toLowerCase().includes(q)
      )
    : workers;

  function toggle(workerId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(workerId)) {
        next.delete(workerId);
      } else {
        next.add(workerId);
      }
      return next;
    });
  }

  async function handleSave() {
    setError(null);
    setPending(true);
    const result = await onSave(Array.from(selected));
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onClose();
  }

  return (
    <div className="flex h-full min-h-full flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-500">
          Assign workers to{" "}
          <span className="font-medium text-zinc-700">{rowName}</span>.
        </p>
        <span className="shrink-0 px-2 py-1 text-xs font-medium text-zinc-500">
          {formatDateRange(startDate, endDate)}
        </span>
      </div>

      {workers.length === 0 ? (
        <p className="py-4 text-center text-sm text-zinc-400">No team members yet.</p>
      ) : (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search the team"
              className="w-full rounded-md border border-zinc-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
            {visibleWorkers.map((worker) => {
              const others = otherAssignments.get(worker.id) ?? [];
              return (
                <label
                  key={worker.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-zinc-700 transition hover:bg-zinc-50"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(worker.id)}
                    onChange={() => toggle(worker.id)}
                    className="size-4 shrink-0 cursor-pointer rounded border-zinc-300 text-zinc-900 focus:ring-2 focus:ring-zinc-200"
                  />
                  <span className="truncate">{worker.fullName}</span>
                  {worker.title && (
                    <span className="shrink-0 text-xs text-zinc-400">{worker.title}</span>
                  )}
                  <span
                    className="ml-auto shrink-0"
                    title={others.length > 0 ? others.map(describeAssignment).join("\n") : undefined}
                  >
                    <AvailabilityBadge assigned={others.length > 0} />
                  </span>
                </label>
              );
            })}
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="mt-auto flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Cancel
        </button>
        {/* The Team page is the admin's alone — members are added there. */}
        {isAdmin && (
          <Link
            href="/admin/team"
            className="flex cursor-pointer items-center gap-1.5 rounded border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
          >
            <Plus className="size-4" />
            Add Members
          </Link>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
