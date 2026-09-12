"use client";

import { useActionState, useState } from "react";
import { Pencil, Trash2, Undo2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { EquipmentAssignmentForm } from "@/components/projects/equipment/equipment-assignment-form";
import {
  deleteEquipmentAssignment,
  returnEquipment,
  type EquipmentActionState,
} from "@/lib/equipment/actions";
import type { EquipmentAssignmentRow } from "@/lib/equipment/data";

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function StatusBadge({ returnedAt }: { returnedAt: string | null }) {
  if (returnedAt) {
    return (
      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        Returned
      </span>
    );
  }
  return (
    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
      Not returned
    </span>
  );
}

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
 * "Assigned Equipments" sub-tab — the full checkout history for this
 * project (returned or not), what an admin's "Assign" on the Inventory
 * page reflects here (see lib/equipment/data.ts's
 * listProjectEquipmentAssignments). Editing/deleting a row here updates
 * the same equipment_assignments record Inventory's Assign/Return
 * actions write, so the two stay in sync either direction.
 */
export function ProjectEquipmentView({
  projectId,
  assignments,
}: {
  projectId: number;
  assignments: EquipmentAssignmentRow[];
}) {
  const [editTarget, setEditTarget] = useState<EquipmentAssignmentRow | null>(
    null
  );

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-zinc-900">
          Assigned Equipments
        </h3>
      </div>

      {assignments.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-sm text-zinc-400">
            No equipment has been assigned to this project yet.
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            Assign equipment from the Inventory page.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
              <tr>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Purpose</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Assigned Date</th>
                <th className="px-4 py-2.5">Return Date</th>
                <th className="px-4 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {assignments.map((assignment) => (
                <tr key={assignment.id} className="transition-colors hover:bg-zinc-50">
                  <td className="px-4 py-2.5 font-medium text-zinc-900">
                    {assignment.equipmentName}
                  </td>
                  <td
                    className="max-w-64 truncate px-4 py-2.5 text-zinc-600"
                    title={assignment.purpose ?? undefined}
                  >
                    {assignment.purpose || "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge returnedAt={assignment.returnedAt} />
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500">
                    {formatDateTime(assignment.assignedAt)}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500">
                    {assignment.returnedAt
                      ? formatDateTime(assignment.returnedAt)
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      {!assignment.returnedAt && (
                        <ReturnAssignmentButton
                          equipmentId={assignment.equipmentId}
                          projectId={projectId}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => setEditTarget(assignment)}
                        aria-label="Edit assignment"
                        className="cursor-pointer rounded p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
                      >
                        <Pencil className="size-3.5" />
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
              ))}
            </tbody>
          </table>
        </div>
      )}

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
