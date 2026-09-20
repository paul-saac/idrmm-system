"use client";

import { useState } from "react";
import { setTaskWorkers } from "@/lib/workers/actions";
import type { Worker } from "@/lib/workers/data";

/**
 * Opened from one task row's own "Assigned" cell (see gantt-chart-view.tsx)
 * — a checkbox picker over the project's own Members roster (see
 * members-modal-content.tsx), scoped to that one task. Called directly
 * as a plain async function (not useActionState — setTaskWorkers takes
 * a plain workerIds array, not FormData), same convention this file's
 * own updateTaskSchedule/setPredecessor already use for a direct
 * server-action call with manual pending state.
 */
export function AssignWorkersModalContent({
  projectId,
  taskId,
  taskName,
  workers,
  assignedWorkerIds,
  onClose,
}: {
  projectId: number;
  taskId: number;
  taskName: string;
  workers: Worker[];
  assignedWorkerIds: number[];
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
    const result = await setTaskWorkers(taskId, projectId, Array.from(selected));
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onClose();
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500">
        Assign workers to{" "}
        <span className="font-medium text-zinc-700">{taskName}</span>.
      </p>

      <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
        {workers.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-400">
            No workers in the roster yet — add some from the Members
            button first.
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

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Cancel
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
