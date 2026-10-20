"use client";

import { useActionState, useState } from "react";
import { ArrowRightLeft, Trash2, Undo2 } from "lucide-react";
import { EditIcon } from "@/components/icons/edit-icon";
import { Modal } from "@/components/ui/modal";
import { EquipmentAssignmentForm } from "@/components/projects/equipment/equipment-assignment-form";
import { EquipmentTaskAssignmentForm } from "@/components/projects/equipment/equipment-task-assignment-form";
import {
  deleteEquipmentAssignment,
  returnEquipment,
  type EquipmentActionState,
} from "@/lib/equipment/actions";
import type {
  EquipmentAssignmentRow,
  EquipmentTaskMovementRow,
  EquipmentTaskOption,
} from "@/lib/equipment/data";

/** "Oct 16, 2026" — from a timestamp. */
function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Calendar days on site, both ends counted — the day it came through the
 * day it left, or today while it's still there. */
export function daysOnSite(assignedAt: string, returnedAt: string | null) {
  const start = new Date(assignedAt);
  start.setHours(0, 0, 0, 0);
  const end = returnedAt ? new Date(returnedAt) : new Date();
  end.setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
}

const Dash = () => <span className="text-zinc-300">—</span>;

const deleteInitialState: EquipmentActionState = {};

function DeleteAssignmentButton({
  assignmentId,
  equipmentId,
  projectId,
  equipmentName,
}: {
  assignmentId: number;
  equipmentId: number;
  projectId: number;
  equipmentName: string;
}) {
  const boundAction = deleteEquipmentAssignment.bind(
    null,
    assignmentId,
    equipmentId,
    projectId
  );
  const [state, formAction, pending] = useActionState(
    boundAction,
    deleteInitialState
  );

  return (
    <span className="relative inline-flex">
      <form
        action={formAction}
        onSubmit={(e) => {
          if (
            !window.confirm(
              `Delete this assignment record for "${equipmentName}"? This cannot be undone.`
            )
          ) {
            e.preventDefault();
          }
        }}
      >
        <button
          type="submit"
          disabled={pending}
          aria-label="Delete assignment"
          title="Delete assignment"
          className="cursor-pointer rounded p-1.5 text-zinc-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Trash2 className="size-3.5" />
        </button>
      </form>
      {state?.error && (
        <span
          role="alert"
          className="absolute top-full right-0 z-10 mt-1 w-48 rounded-md border border-red-200 bg-white px-2 py-1 text-right text-xs font-normal text-red-600 shadow-sm"
        >
          {state.error}
        </span>
      )}
    </span>
  );
}

const returnInitialState: EquipmentActionState = {};

function ReturnAssignmentButton({
  equipmentId,
  projectId,
}: {
  equipmentId: number;
  projectId: number;
}) {
  const boundAction = returnEquipment.bind(null, equipmentId, projectId);
  const [state, formAction, pending] = useActionState(
    boundAction,
    returnInitialState
  );

  return (
    <span className="relative inline-flex">
      <form action={formAction}>
        <button
          type="submit"
          disabled={pending}
          aria-label="Return equipment"
          title="Mark as returned"
          className="cursor-pointer rounded p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Undo2 className="size-3.5" />
        </button>
      </form>
      {state?.error && (
        <span
          role="alert"
          className="absolute top-full right-0 z-10 mt-1 w-48 rounded-md border border-red-200 bg-white px-2 py-1 text-right text-xs font-normal text-red-600 shadow-sm"
        >
          {state.error}
        </span>
      )}
    </span>
  );
}

/**
 * The Equipment record's Assigned equipment view — every piece of the
 * Inventory's equipment this project has had, on site or returned, what an
 * admin's Assign on the Inventory page puts here (see
 * listProjectEquipmentAssignments): its asset tag, what it's for, when it
 * came and left, and how many days it's been on site. Marking it returned,
 * editing or deleting a row here writes the same equipment_assignments
 * record Inventory's own Assign/Return do, so the two stay in sync.
 * Listed as given.
 */
export function AssignedEquipmentTable({
  projectId,
  assignments,
  tasks,
}: {
  projectId: number;
  assignments: EquipmentAssignmentRow[];
  tasks: EquipmentTaskOption[];
}) {
  const [editTarget, setEditTarget] = useState<EquipmentAssignmentRow | null>(null);
  const [taskTarget, setTaskTarget] = useState<EquipmentAssignmentRow | null>(null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[64rem] text-left text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-500">
          <tr>
            <th className="px-5 py-3">Equipment</th>
            <th className="px-4 py-3">Purpose</th>
            <th className="px-4 py-3">Current task</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Assigned</th>
            <th className="px-4 py-3">Returned</th>
            <th className="px-4 py-3 text-center">Days on site</th>
            <th className="w-28 py-3 pr-5">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {assignments.map((assignment) => {
            const onSite = !assignment.returnedAt;
            return (
              <tr key={assignment.id} className="transition-colors hover:bg-zinc-50">
                <td className="max-w-72 px-5 py-3.5">
                  <p className="truncate font-semibold text-zinc-900" title={assignment.equipmentName}>
                    {assignment.equipmentName}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-zinc-400">{assignment.equipmentAssetTag}</p>
                </td>
                <td
                  className="max-w-64 truncate px-4 py-3.5 text-zinc-600"
                  title={assignment.purpose ?? undefined}
                >
                  {assignment.purpose || <Dash />}
                </td>
                <td className="max-w-64 px-4 py-3.5">
                  {assignment.currentTaskName ? (
                    <>
                      <p className="truncate font-medium text-zinc-800" title={assignment.currentTaskName}>{assignment.currentTaskName}</p>
                      {assignment.taskAssignedAt && <p className="mt-0.5 text-xs text-zinc-400">Since {formatDay(assignment.taskAssignedAt)}</p>}
                    </>
                  ) : onSite ? (
                    <span className="text-xs font-medium text-amber-600">Task required</span>
                  ) : <Dash />}
                </td>
                <td className="px-4 py-3.5">
                  <span
                    className={`rounded-sm px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
                      onSite ? "bg-sky-50 text-sky-700" : "bg-zinc-100 text-zinc-600"
                    }`}
                  >
                    {onSite ? "On site" : "Returned"}
                  </span>
                </td>
                <td className="px-4 py-3.5 whitespace-nowrap text-zinc-600">
                  {formatDay(assignment.assignedAt)}
                </td>
                <td className="px-4 py-3.5 whitespace-nowrap text-zinc-600">
                  {assignment.returnedAt ? formatDay(assignment.returnedAt) : <Dash />}
                </td>
                <td className="px-4 py-3.5 text-center font-semibold text-zinc-900 tabular-nums">
                  {daysOnSite(assignment.assignedAt, assignment.returnedAt)}
                </td>
                <td className="py-3.5 pr-5">
                  <div className="flex items-center justify-end gap-1">
                    {onSite && (
                      <button
                        type="button"
                        onClick={() => setTaskTarget(assignment)}
                        aria-label={assignment.currentTaskId ? "Move equipment to another task" : "Assign equipment to task"}
                        title={assignment.currentTaskId ? "Move to another task" : "Assign to task"}
                        className="cursor-pointer rounded p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
                      >
                        <ArrowRightLeft className="size-3.5" />
                      </button>
                    )}
                    {onSite && (
                      <ReturnAssignmentButton
                        equipmentId={assignment.equipmentId}
                        projectId={projectId}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => setEditTarget(assignment)}
                      aria-label="Edit assignment"
                      title="Edit assignment"
                      className="cursor-pointer rounded p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
                    >
                      <EditIcon className="size-3.5" />
                    </button>
                    <DeleteAssignmentButton
                      assignmentId={assignment.id}
                      equipmentId={assignment.equipmentId}
                      projectId={projectId}
                      equipmentName={assignment.equipmentName}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Modal
        open={taskTarget !== null}
        onClose={() => setTaskTarget(null)}
        title={taskTarget?.currentTaskId ? "Move Equipment" : "Assign Equipment to Task"}
      >
        {taskTarget && (
          <EquipmentTaskAssignmentForm
            key={`${taskTarget.id}-${taskTarget.currentTaskId ?? "none"}`}
            assignment={taskTarget}
            projectId={projectId}
            tasks={tasks}
            onSuccess={() => setTaskTarget(null)}
          />
        )}
      </Modal>

      <Modal
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
        title="Edit Assignment"
      >
        {editTarget && (
          <EquipmentAssignmentForm
            key={editTarget.id}
            assignment={editTarget}
            projectId={projectId}
            onSuccess={() => setEditTarget(null)}
          />
        )}
      </Modal>
    </div>
  );
}

export function EquipmentMonitoringTable({ movements }: { movements: EquipmentTaskMovementRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[62rem] text-left text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-500">
          <tr>
            <th className="px-5 py-3">Equipment</th>
            <th className="px-4 py-3">Task</th>
            <th className="px-4 py-3">Assigned</th>
            <th className="px-4 py-3">Released</th>
            <th className="px-4 py-3">Movement</th>
            <th className="px-4 py-3">Assigned by</th>
            <th className="px-4 py-3">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {movements.map((movement) => (
            <tr key={movement.id} className="hover:bg-zinc-50">
              <td className="px-5 py-3.5"><p className="font-semibold text-zinc-900">{movement.equipmentName}</p><p className="text-xs text-zinc-400">{movement.equipmentAssetTag}</p></td>
              <td className="px-4 py-3.5 font-medium text-zinc-700">{movement.taskName}</td>
              <td className="px-4 py-3.5 whitespace-nowrap text-zinc-600">{formatDay(movement.assignedAt)}</td>
              <td className="px-4 py-3.5 whitespace-nowrap text-zinc-600">{movement.releasedAt ? formatDay(movement.releasedAt) : <Dash />}</td>
              <td className="px-4 py-3.5"><span className={`rounded-sm px-2 py-0.5 text-xs font-medium ${movement.releaseReason === "returned" ? "bg-zinc-100 text-zinc-600" : movement.releaseReason === "moved" ? "bg-amber-50 text-amber-700" : "bg-sky-50 text-sky-700"}`}>{movement.releaseReason === "returned" ? "Returned" : movement.releaseReason === "moved" ? "Moved" : "Current"}</span></td>
              <td className="px-4 py-3.5 text-zinc-600">{movement.assignedByName ?? <Dash />}</td>
              <td className="max-w-64 truncate px-4 py-3.5 text-zinc-500" title={movement.notes ?? undefined}>{movement.notes || <Dash />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
