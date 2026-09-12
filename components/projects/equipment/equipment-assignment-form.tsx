"use client";

import { useActionState, useEffect, useId } from "react";
import {
  updateEquipmentAssignment,
  type EquipmentActionState,
} from "@/lib/equipment/actions";
import type { EquipmentAssignmentRow } from "@/lib/equipment/data";

const initialState: EquipmentActionState = {};

// <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" with no
// timezone suffix — an ISO timestamp's trailing "Z"/seconds has to come
// off, or the browser just shows the field empty.
function toDateTimeLocal(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EquipmentAssignmentForm({
  assignment,
  projectId,
  onSuccess,
}: {
  assignment: EquipmentAssignmentRow;
  projectId: number;
  onSuccess?: () => void;
}) {
  const boundAction = updateEquipmentAssignment.bind(
    null,
    assignment.id,
    assignment.equipmentId,
    projectId
  );
  const [state, formAction, pending] = useActionState(
    boundAction,
    initialState
  );
  const formId = useId();

  useEffect(() => {
    if (state.success) {
      onSuccess?.();
    }
    // Only re-run when the action produces a new result — `onSuccess` is
    // passed inline by the parent and would otherwise re-run this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
        <span className="font-medium text-zinc-900">
          {assignment.equipmentName}
        </span>
        <span className="ml-1.5 text-zinc-400">
          {assignment.equipmentAssetTag}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${formId}-purpose`}
          className="text-sm font-medium text-zinc-800"
        >
          Purpose{" "}
          <span className="font-normal text-zinc-400">(optional)</span>
        </label>
        <textarea
          id={`${formId}-purpose`}
          name="purpose"
          rows={2}
          defaultValue={assignment.purpose ?? ""}
          placeholder="e.g., To be used for mixing cement, sand, and gravel"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`${formId}-assignedAt`}
            className="text-sm font-medium text-zinc-800"
          >
            Assigned Date
          </label>
          <input
            id={`${formId}-assignedAt`}
            name="assignedAt"
            type="datetime-local"
            required
            defaultValue={toDateTimeLocal(assignment.assignedAt)}
            className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`${formId}-returnedAt`}
            className="text-sm font-medium text-zinc-800"
          >
            Return Date{" "}
            <span className="font-normal text-zinc-400">(optional)</span>
          </label>
          <input
            id={`${formId}-returnedAt`}
            name="returnedAt"
            type="datetime-local"
            defaultValue={
              assignment.returnedAt ? toDateTimeLocal(assignment.returnedAt) : ""
            }
            className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
          <p className="text-xs text-zinc-400">
            Leave blank if not yet returned.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onSuccess}
          className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save"}
        </button>
      </div>

      {state?.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}
