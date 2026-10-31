"use client";

import { RequiredMark } from "@/components/ui/required-mark";
import { useActionState, useEffect, useId } from "react";
import { moveEquipmentToTask, type EquipmentActionState } from "@/lib/equipment/actions";
import type { EquipmentAssignmentRow, EquipmentTaskOption } from "@/lib/equipment/data";

const initialState: EquipmentActionState = {};

export function EquipmentTaskAssignmentForm({
  assignment,
  projectId,
  tasks,
  onSuccess,
}: {
  assignment: EquipmentAssignmentRow;
  projectId: number;
  tasks: EquipmentTaskOption[];
  onSuccess: () => void;
}) {
  const action = moveEquipmentToTask.bind(null, assignment.id, projectId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const formId = useId();

  useEffect(() => {
    if (state.success) onSuccess();
    // onSuccess is passed inline by the table.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
        <p className="font-medium text-zinc-900">{assignment.equipmentName}</p>
        <p className="text-xs text-zinc-400">{assignment.equipmentAssetTag}</p>
      </div>

      {assignment.currentTaskName && (
        <div>
          <p className="text-xs font-medium text-zinc-500">Current task</p>
          <p className="mt-1 text-sm text-zinc-900">{assignment.currentTaskName}</p>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-task`} className="text-sm font-medium text-zinc-900">
          {assignment.currentTaskId ? "Move to task" : "Assign to task"}
        <RequiredMark /></label>
        <select
          id={`${formId}-task`}
          name="taskId"
          required
          defaultValue=""
          className="rounded border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        >
          <option value="" disabled hidden>Select a task</option>
          {tasks.filter((task) => task.id !== assignment.currentTaskId).map((task) => (
            <option key={task.id} value={task.id}>{task.phaseName} — {task.name}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-notes`} className="text-sm font-medium text-zinc-900">
          Movement notes <span className="font-normal text-zinc-400">(optional)</span>
        </label>
        <textarea id={`${formId}-notes`} name="notes" rows={2} className="rounded border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200" />
      </div>

      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}

      <div className="flex justify-end gap-3">
        <button type="button" onClick={onSuccess} className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">Cancel</button>
        <button type="submit" disabled={pending || tasks.length === 0} className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60">
          {pending ? "Saving..." : assignment.currentTaskId ? "Move Equipment" : "Assign Equipment"}
        </button>
      </div>
    </form>
  );
}
