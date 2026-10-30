"use client";

import { RequiredMark } from "@/components/ui/required-mark";
import { EmptyState } from "@/components/ui/empty-state";
import { ModalFooter } from "@/components/ui/modal";

import { useActionState, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import {
  createTask,
  updateSubtask,
  type CostEstimateActionState,
} from "@/lib/cost-estimate/actions";
import type { CostCategory, TaskMaterialAssignment } from "@/lib/cost-estimate/data";
import { currentProjectSuccessor, projectSuccessorOptions, scheduleRowKey } from "@/lib/cost-estimate/successor-options";

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
 * manpower either — each one has its own dedicated place: Start/End and
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
 * Normal tasks retain sibling choices. Milestones may select any saved
 * main task or subtask in this project through the typed project picker.
 *
 * Deleting an existing task is in this modal's own ⋮ menu (see
 * gantt-chart-view.tsx's Edit Task modal), not a control on the task
 * list's row — that row's edit button stays its one per-row control.
 */
export function SubtaskForm({
  projectId,
  categoryId,
  task,
  siblingTasks,
  projectCategories,
  onViewMaterials,
  onRequestDelete,
  onSuccess,
  onSave,
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
  projectCategories?: CostCategory[];
  /** Closes this modal and opens the Material Breakdown modal with this
   * task's own row highlighted — undefined in create mode (nothing to
   * highlight yet), same "edit mode only" gating Delete already uses. */
  onViewMaterials?: () => void;
  onRequestDelete?: () => void;
  onSuccess?: () => void;
  /** The parent retains the background save after the edit form closes. */
  onSave?: (form: FormData) => void;
}) {
  const isEdit = task !== undefined;
  const projectLinkMode = isEdit && projectCategories !== undefined;
  const [milestone, setMilestone] = useState(task?.isMilestone ?? false);
  const [successorSelection, setSuccessorSelection] = useState(() => task && projectCategories
    ? currentProjectSuccessor(projectCategories, { kind: "task", id: task.id }) : "");
  const projectOptions = task && projectCategories ? projectSuccessorOptions(projectCategories, { kind: "task", id: task.id }, milestone) : [];
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

  // The sibling (if any) that already treats this task as its own
  // predecessor — i.e. this task's current successor. Always undefined
  // on create: nothing can point at a task before it exists.
  const currentSuccessor = task
    ? siblingTasks.find((t) => t.predecessorTaskId === task.id)
    : undefined;
  const relationshipOptions = siblingTasks.filter((t) => t.id !== task?.id);

  return (
    <div className="flex h-full min-h-full flex-col gap-4">
      <form id={formId} action={formAction} onSubmit={isEdit && onSave ? event => {
        event.preventDefault();
        onSave(new FormData(event.currentTarget));
      } : undefined} className="flex flex-col gap-4" noValidate autoComplete="off">
        <input type="hidden" name="categoryId" value={categoryId} />

        {/* Create mode only — an existing task is renamed from the Gantt
            task list's own Task cell (renameTask), and its name is this
            modal's title. */}
        {!isEdit && (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={`${formId}-taskName`}
              className="text-sm font-medium text-zinc-900"
            >
              Task Name<RequiredMark /></label>
            <input
              id={`${formId}-taskName`}
              name="taskName"
              required
              autoComplete="off"
              placeholder="e.g., Concrete Footings"
              className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
            />
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="relative flex size-4 shrink-0">
            <input
              id={`${formId}-isMilestone`}
              name="isMilestone"
              type="checkbox"
              checked={milestone}
              onChange={event => {
                const checked = event.target.checked;
                setMilestone(checked);
                if (task && projectCategories && !projectSuccessorOptions(projectCategories, { kind: "task", id: task.id }, checked)
                  .some(option => scheduleRowKey(option) === successorSelection)) setSuccessorSelection("");
              }}
              className="peer size-4 cursor-pointer appearance-none rounded-sm border border-zinc-300 bg-zinc-100 transition checked:border-zinc-900 checked:bg-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:outline-none"
            />
            <Check
              strokeWidth={3}
              className="pointer-events-none absolute inset-0 m-auto size-3 text-white opacity-0 peer-checked:opacity-100"
            />
          </span>
          <label
            htmlFor={`${formId}-isMilestone`}
            className="cursor-pointer text-sm font-medium text-zinc-900"
          >
            Milestone
          </label>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`${formId}-relationship`}
            className="text-sm font-medium text-zinc-900"
          >
            Successor
          </label>
          <div className="relative">
            <select
              id={`${formId}-relationship`}
              name={projectLinkMode ? "successorRowKey" : isEdit ? "successorTaskId" : "predecessorTaskId"}
              value={projectLinkMode ? successorSelection : undefined}
              defaultValue={projectLinkMode ? undefined : isEdit ? (currentSuccessor?.id ?? "") : ""}
              onChange={projectLinkMode ? event => setSuccessorSelection(event.target.value) : undefined}
              className="flex h-[38px] w-full min-w-0 cursor-pointer appearance-none items-center rounded-md border border-zinc-200 bg-white px-3 py-2 pr-8 text-left text-sm leading-5 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
            >
              <option value="">
                {isEdit ? "Select a successor task" : "None — starts independently"}
              </option>
              {projectLinkMode ? projectOptions.map(option => (
                <option key={scheduleRowKey(option)} value={scheduleRowKey(option)}>{option.name}</option>
              )) : relationshipOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-zinc-400" />
          </div>
        </div>

        {isEdit && (
          <div className="-mx-6 flex flex-col gap-2 border-t border-zinc-200 px-6 pt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-zinc-900">
                Assigned Resources
              </h3>
              {onViewMaterials && (
                <button
                  type="button"
                  onClick={onViewMaterials}
                  className="cursor-pointer text-xs font-medium text-zinc-500 transition hover:text-zinc-900"
                >
                  See All
                </button>
              )}
            </div>
            {task.materialAssignments.length === 0 ? (
              <EmptyState compact className="py-3">
                No materials assigned to this task yet.
              </EmptyState>
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
      <ModalFooter>
        <button
          type="button"
          onClick={onSuccess}
          className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Cancel
        </button>
        {isEdit && onRequestDelete && (
          <button
            type="button"
            onClick={onRequestDelete}
            className="cursor-pointer rounded border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
          >
            Delete
          </button>
        )}
        <button
          type="submit"
          form={formId}
          disabled={pending}
          className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save"}
        </button>
      </ModalFooter>
    </div>
  );
}
