"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { EditIcon } from "@/components/icons/edit-icon";
import {
  createWorker,
  updateWorker,
  deleteWorker,
  type WorkerActionState,
} from "@/lib/workers/actions";
import type { Worker } from "@/lib/workers/data";

const initialState: WorkerActionState = {};

/** One roster row — click-to-edit turns it into its own inline form
 * (name + trade + Save/Cancel), same "no nested modal" reasoning as the
 * rest of this component: this whole roster already lives inside one
 * Modal (see gantt-chart-view.tsx), and this app's Modal is a single
 * right-docked panel, not built to stack.
 *
 * The edit form calls updateWorker directly from its own onSubmit
 * (manual pending/error state) rather than useActionState + an effect
 * watching state.success to close editing — the latter needs to call
 * setEditing from inside an effect body, which this project's hooks
 * lint rule (react-hooks/set-state-in-effect) disallows; a direct call
 * from the submit handler itself has nowhere the linter can flag,
 * matching the same convention gantt-chart-view.tsx's own direct
 * server-action calls (handleUndo/handleRedo) already use. */
function WorkerRow({ projectId, worker }: { projectId: number; worker: Worker }) {
  const [editing, setEditing] = useState(false);
  const [updatePending, setUpdatePending] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteState, deleteFormAction, deletePending] = useActionState(
    deleteWorker.bind(null, worker.id, projectId),
    initialState
  );

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setUpdateError(null);
    setUpdatePending(true);
    const result = await updateWorker(worker.id, projectId, initialState, formData);
    setUpdatePending(false);
    if (result.error) {
      setUpdateError(result.error);
      return;
    }
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="border-b border-zinc-100 py-2">
        <form onSubmit={handleSave} className="flex items-center gap-2">
          <input
            name="fullName"
            required
            autoFocus
            defaultValue={worker.fullName}
            className="min-w-0 flex-1 rounded border border-zinc-200 px-2 py-1 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
          <input
            name="trade"
            defaultValue={worker.trade ?? ""}
            placeholder="Trade"
            className="w-28 rounded border border-zinc-200 px-2 py-1 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
          <button
            type="submit"
            disabled={updatePending}
            className="shrink-0 cursor-pointer rounded bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {updatePending ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="shrink-0 cursor-pointer rounded border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50"
          >
            Cancel
          </button>
        </form>
        {updateError && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {updateError}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="border-b border-zinc-100 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-sm text-zinc-800">
          {worker.fullName}
          {worker.trade && (
            <span className="ml-2 text-xs text-zinc-400">{worker.trade}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`Edit ${worker.fullName}`}
            title="Edit"
            className="cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
          >
            <EditIcon className="size-3.5" />
          </button>
          <form
            action={deleteFormAction}
            onSubmit={(e) => {
              if (!window.confirm(`Remove ${worker.fullName} from the roster?`)) {
                e.preventDefault();
              }
            }}
          >
            <button
              type="submit"
              disabled={deletePending}
              aria-label={`Remove ${worker.fullName}`}
              title="Remove"
              className="cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 className="size-3.5" />
            </button>
          </form>
        </div>
      </div>
      {deleteState.error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {deleteState.error}
        </p>
      )}
    </div>
  );
}

/**
 * The Gantt Chart Schedule's own "Members" toolbar button opens this —
 * a project-scoped roster of real people (name + optional trade) for
 * task-level accountability, separate from estimate_task_labor_
 * assignments' own role+headcount cost-estimation rows (see
 * 0038_task_worker_assignments.sql's own comment). Assigning a roster
 * entry to a specific task happens from the task list's own "Assigned"
 * column, not here — this modal only maintains the roster itself.
 */
export function MembersModalContent({
  projectId,
  workers,
  onClose,
}: {
  projectId: number;
  workers: Worker[];
  onClose: () => void;
}) {
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    createWorker.bind(null, projectId),
    initialState
  );

  // Uncontrolled add-form — reset it after a successful add instead of
  // leaving the just-submitted name/trade sitting there, same as any
  // other "add another" row-adding form in this app.
  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500">
        People currently or soon working on this project. Assign them to
        specific tasks from that task&apos;s own &quot;Assigned&quot; column.
      </p>

      <div className="flex max-h-80 flex-col overflow-y-auto">
        {workers.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-400">
            No workers added yet.
          </p>
        ) : (
          workers.map((worker) => (
            <WorkerRow key={worker.id} projectId={projectId} worker={worker} />
          ))
        )}
      </div>

      <form
        ref={formRef}
        action={formAction}
        className="flex items-end gap-2 border-t border-zinc-200 pt-4"
        noValidate
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label
            htmlFor={`${formId}-fullName`}
            className="text-xs font-medium text-zinc-600"
          >
            Name
          </label>
          <input
            id={`${formId}-fullName`}
            name="fullName"
            required
            autoComplete="off"
            placeholder="e.g., Juan Dela Cruz"
            className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        </div>
        <div className="flex w-32 flex-col gap-1">
          <label
            htmlFor={`${formId}-trade`}
            className="text-xs font-medium text-zinc-600"
          >
            Trade
          </label>
          <input
            id={`${formId}-trade`}
            name="trade"
            autoComplete="off"
            placeholder="Electrician"
            className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded bg-zinc-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus className="size-4" />
          Add
        </button>
      </form>
      {state?.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Close
        </button>
      </div>
    </div>
  );
}
