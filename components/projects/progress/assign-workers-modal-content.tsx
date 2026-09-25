"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { Worker } from "@/lib/workers/data";
import type { WorkerActionState } from "@/lib/workers/actions";

function formatDateRange(start: Date, end: Date) {
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} - ${fmt(end)}`;
}

/**
 * Opened from a row's own "Assigned" cell in the Gantt task list (see
 * gantt-chart-view.tsx) — a checkbox picker over the project's own
 * Members roster (see members-modal-content.tsx). Scoped to whichever
 * one row opened it — a task or, one level up, a category with no tasks
 * yet (see CategoryWorkerAssignments's own doc comment) — via `onSave`
 * rather than a taskId prop directly, so this component itself doesn't
 * need to know or care which kind of row it's editing; the caller wires
 * it to setTaskWorkers or setCategoryWorkers. Called directly as a plain
 * async function (not useActionState — both setters take a plain
 * workerIds array, not FormData), same convention gantt-chart-view.tsx's
 * own updateTaskSchedule already uses for a direct server-action call
 * with manual pending state.
 *
 * startDate/endDate are the SAME Date objects already shown in that
 * row's own Start/End Gantt columns (a task's own planned dates, or a
 * category's own rollup/direct dates) — reused as-is here rather than
 * re-derived, so whatever this badge shows always matches what's
 * already on screen for that row, fallback placeholder included.
 *
 * "+ Add Person" is a plain button, not its own inline add-worker form
 * — the roster itself now has a real add flow of its own (see
 * members-modal-content.tsx's own spreadsheet-style rows), so this just
 * calls onAddPerson to hand off to that same modal instead of
 * duplicating a second, smaller add form in here.
 */
export function AssignWorkersModalContent({
  rowName,
  startDate,
  endDate,
  workers,
  assignedWorkerIds,
  onSave,
  onAddPerson,
  onClose,
}: {
  /** The task or category name shown in this modal's own intro line —
   * "Assign workers to <rowName>." */
  rowName: string;
  startDate: Date;
  endDate: Date;
  workers: Worker[];
  assignedWorkerIds: number[];
  onSave: (workerIds: number[]) => Promise<WorkerActionState>;
  /** Closes this modal and opens the Members modal instead — this
   * app's Modal is a single right-docked panel, not built to stack, so
   * "add a person" here means handing off rather than layering. */
  onAddPerson: () => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(assignedWorkerIds)
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
        {workers.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-400">
            No workers in the roster yet — add some below.
          </p>
        ) : (
          workers.map((worker) => (
            <label
              key={worker.id}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-zinc-700 transition hover:bg-zinc-50"
            >
              <input
                type="checkbox"
                checked={selected.has(worker.id)}
                onChange={() => toggle(worker.id)}
                className="size-4 shrink-0 cursor-pointer rounded border-zinc-300 text-zinc-800 focus:ring-2 focus:ring-zinc-200"
              />
              <span className="truncate">{worker.fullName}</span>
              {worker.trade && (
                <span className="shrink-0 text-xs text-zinc-400">
                  {worker.trade}
                </span>
              )}
            </label>
          ))
        )}
      </div>

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
        <button
          type="button"
          onClick={onAddPerson}
          className="flex cursor-pointer items-center gap-1.5 rounded border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          <Plus className="size-4" />
          Add Person
        </button>
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
