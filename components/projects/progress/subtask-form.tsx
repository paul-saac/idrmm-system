"use client";

import { useActionState, useEffect, useId } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import {
  createTask,
  deleteTask,
  updateSubtask,
  type CostEstimateActionState,
} from "@/lib/cost-estimate/actions";
import type { TaskMaterialAssignment } from "@/lib/cost-estimate/data";

const initialState: CostEstimateActionState = {};

/**
 * The Gantt Chart Schedule's own "Add/Edit Task" form — a lightweight,
 * scheduling-only counterpart to the Cost Estimate Breakdown's own
 * TaskForm (which stays as-is, unchanged, for entering cost/quantity
 * data — the only place left that still does). Deliberately a separate
 * component rather than a variant of TaskForm: this one is always
 * opened from a specific phase (so the category is already known —
 * submitted as a hidden field on create, never asked for here), and
 * skips Estimated Quantity/Unit/Labor/Material/Equipment Estimate/Other
 * Cost Items entirely — those default to 0/empty on create (unchanged
 * in createTask) and, once set, are left untouched by an edit here;
 * they can still be filled in from the Cost Estimate Breakdown's own
 * Edit form.
 *
 * Deliberately doesn't manage Start/End date, Priority, materials, or
 * manpower either, despite estimate_tasks/estimate_task_material_
 * assignments/estimate_task_labor_assignments having room for all of
 * them — each one now has its own dedicated place: Start/End and
 * Priority are the Gantt task list's own cells (dragging the bar, or
 * picking directly there — see CustomTaskListTable in
 * gantt-chart-view.tsx); materials are the Material Breakdown modal's
 * own table (this form's "Assigned Resources" section just links there
 * — see onViewMaterials below, which highlights this exact task's own
 * row once it opens); manpower (a role+headcount cost-planning list,
 * unrelated to the Gantt task list's own "Assigned" column of real
 * named workers) had its only remaining UI removed from here per an
 * explicit request, with nothing elsewhere in the app surfacing it
 * anymore either. updateSubtask itself was trimmed to match — it no
 * longer touches any of these four on save, so editing just the
 * name/milestone/successor here can never silently wipe out a
 * schedule, priority, or assignment list someone set elsewhere.
 *
 * The one relationship field means two different things depending on
 * mode, both labeled "Successor," but backed by two different server
 * actions:
 *  - Creating a task: nothing else could already point *at* a task that
 *    doesn't exist yet, so the only relationship settable here is the
 *    new task's own predecessor (createTask's existing predecessorTaskId
 *    field) — "this new task starts after X."
 *  - Editing an existing task: the field instead manages the *inverse*
 *    relationship (updateSubtask's own successorTaskId) — "X starts
 *    after this task" — pre-filled with whichever sibling (if any)
 *    already has its own predecessor pointing here (see
 *    applyPredecessor in lib/cost-estimate/actions.ts).
 * Either way, the dropdown only ever offers `siblingTasks` — every
 * other task already in this same phase — matching the same
 * same-phase-only rule enforced both client- and server-side.
 *
 * Deleting an existing task lives here too (a Delete button, edit mode
 * only) rather than as its own standalone control in the task list's
 * own Task name cell — that cell's own edit button (see
 * gantt-chart-view.tsx's CustomTaskListTable) is the only per-row
 * control there, matching how the task list reads at a glance: one
 * button per row that opens "the task's own controls," not two
 * competing ones a misclick could trigger. The delete button submits
 * its own separate
 * <form> (a <form> can't nest inside another), positioned in the same
 * row as Cancel/Save via the outer wrapper below.
 */
export function SubtaskForm({
  projectId,
  categoryId,
  task,
  siblingTasks,
  onViewMaterials,
  onSuccess,
}: {
  projectId: number;
  categoryId: number;
  task?: {
    id: number;
    name: string;
    isMilestone: boolean;
    /** Read-only here — shown as a quick preview list under Assigned
     * Resources; See All is what actually edits this list, over in the
     * Material Breakdown modal. */
    materialAssignments: TaskMaterialAssignment[];
  };
  siblingTasks: { id: number; name: string; predecessorTaskId: number | null }[];
  /** Closes this modal and opens the Material Breakdown modal with this
   * task's own row highlighted — undefined in create mode (nothing to
   * highlight yet), same "edit mode only" gating Delete already uses. */
  onViewMaterials?: () => void;
  onSuccess?: () => void;
}) {
  const isEdit = task !== undefined;
  const boundAction = isEdit
    ? updateSubtask.bind(null, task.id, projectId)
    : createTask.bind(null, projectId);
  const [state, formAction, pending] = useActionState(
    boundAction,
    initialState
  );
  const formId = useId();
  const router = useRouter();

  useEffect(() => {
    if (state.success) {
      // Both createTask and updateSubtask already call revalidatePath,
      // which is normally enough on its own for a <form action={...}>
      // bound to a Server Action — Next.js refreshes the current
      // route's Server Component tree automatically once the action
      // resolves. Calling router.refresh() here too costs nothing
      // (a no-op against an already-fresh tree) but matches every other
      // server round trip in gantt-chart-view.tsx (persistTaskDates),
      // which all call it explicitly rather than depend solely on that
      // implicit behavior.
      router.refresh();
      onSuccess?.();
    }
    // Only re-run when the action produces a new result — `onSuccess` is
    // passed inline by the parent and would otherwise re-run this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Bound to -1 in add mode (task is undefined) purely so this hook can
  // still be called unconditionally — the button that would actually
  // submit this action only renders at all once `isEdit` is true, see
  // the delete <form> below.
  const [deleteState, deleteFormAction, deletePending] = useActionState(
    deleteTask.bind(null, task?.id ?? -1, projectId),
    initialState
  );

  useEffect(() => {
    if (deleteState.success) {
      router.refresh();
      onSuccess?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteState]);

  // The sibling (if any) that already treats this task as its own
  // predecessor — i.e. this task's current successor. Always undefined
  // on create: nothing can point at a task before it exists.
  const currentSuccessor = task
    ? siblingTasks.find((t) => t.predecessorTaskId === task.id)
    : undefined;
  const relationshipOptions = siblingTasks.filter((t) => t.id !== task?.id);

  return (
    <div className="flex h-full min-h-full flex-col gap-4">
      <form id={formId} action={formAction} className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="categoryId" value={categoryId} />

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`${formId}-taskName`}
            className="text-sm font-medium text-zinc-800"
          >
            Task Name
          </label>
          <input
            id={`${formId}-taskName`}
            name="taskName"
            required
            defaultValue={task?.name}
            placeholder="e.g., Concrete Footings"
            className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            id={`${formId}-isMilestone`}
            name="isMilestone"
            type="checkbox"
            defaultChecked={task?.isMilestone ?? false}
            className="size-4 cursor-pointer rounded border-zinc-300 text-zinc-800 focus:ring-2 focus:ring-zinc-200"
          />
          <label
            htmlFor={`${formId}-isMilestone`}
            className="cursor-pointer text-sm font-medium text-zinc-800"
          >
            Milestone
          </label>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`${formId}-relationship`}
            className="text-sm font-medium text-zinc-800"
          >
            Successor
          </label>
          <select
            id={`${formId}-relationship`}
            name={isEdit ? "successorTaskId" : "predecessorTaskId"}
            defaultValue={isEdit ? (currentSuccessor?.id ?? "") : ""}
            className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          >
            <option value="">
              {isEdit ? "None — no successor" : "None — starts independently"}
            </option>
            {relationshipOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {isEdit && (
          <div className="flex flex-col gap-2 border-t border-zinc-200 pt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-zinc-800">
                Assigned Resources
              </h3>
              {onViewMaterials && (
                <button
                  type="button"
                  onClick={onViewMaterials}
                  className="cursor-pointer text-xs font-medium text-zinc-500 transition hover:text-zinc-800"
                >
                  See All
                </button>
              )}
            </div>
            {task.materialAssignments.length === 0 ? (
              <p className="text-xs text-zinc-400">
                No materials assigned to this task yet.
              </p>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded-md border border-zinc-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
                    <tr>
                      <th className="border-b border-zinc-200 px-3 py-1.5">
                        Material
                      </th>
                      <th className="border-b border-zinc-200 px-3 py-1.5 text-right">
                        Qty
                      </th>
                      <th className="border-b border-zinc-200 px-3 py-1.5 text-right">
                        Unit
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {task.materialAssignments.map((material, index) => (
                      <tr
                        key={material.id}
                        className={
                          index !== task.materialAssignments.length - 1
                            ? "border-b border-zinc-100"
                            : ""
                        }
                      >
                        <td className="px-3 py-1.5 text-zinc-700">
                          {material.materialName}
                        </td>
                        <td className="px-3 py-1.5 text-right text-zinc-600">
                          {material.plannedQuantity}
                        </td>
                        <td className="px-3 py-1.5 text-right text-zinc-600">
                          {material.unit ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </form>

      {state?.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      {deleteState?.error && (
        <p role="alert" className="text-sm text-red-600">
          {deleteState.error}
        </p>
      )}

      <div className="mt-auto flex items-center justify-between gap-3">
        {task ? (
          <form
            action={deleteFormAction}
            onSubmit={(e) => {
              if (!window.confirm(`Delete "${task.name}"?`)) {
                e.preventDefault();
              }
            }}
          >
            <button
              type="submit"
              disabled={deletePending}
              className="flex cursor-pointer items-center gap-1.5 rounded border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 className="size-3.5" />
              {deletePending ? "Deleting..." : "Delete"}
            </button>
          </form>
        ) : (
          // Keeps Cancel/Save pinned to the right whether or not a
          // Delete button is present on the left.
          <span />
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onSuccess}
            className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            disabled={pending}
            className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
