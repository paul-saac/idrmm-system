"use client";

import { RequiredMark } from "@/components/ui/required-mark";
import { EmptyState } from "@/components/ui/empty-state";
import { useActionState, useEffect, useId } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Trash2 } from "lucide-react";
import { ModalFooter } from "@/components/ui/modal";
import {
  createCategory,
  deleteCategory,
  updateCategory,
  type CostEstimateActionState,
} from "@/lib/cost-estimate/actions";
import type { CostCategory, TaskMaterialAssignment } from "@/lib/cost-estimate/data";

const initialState: CostEstimateActionState = {};

export function CategoryForm({
  projectId,
  category,
  siblingCategories,
  onViewMaterials,
  showDeleteButton,
  onRequestDelete,
  onSuccess,
  onSave,
}: {
  projectId: number;
  /** hasTasks false (a task-less, "standalone" category) adds a
   * Milestone checkbox, seeded from isMilestone. */
  category?: Pick<CostCategory, "id" | "name"> & {
    hasTasks?: boolean;
    isMilestone?: boolean;
    materialAssignments?: TaskMaterialAssignment[];
  };
  siblingCategories?: {
    id: number;
    name: string;
    predecessorCategoryId: number | null;
  }[];
  onViewMaterials?: () => void;
  /** Adds a Delete button (edit mode only) to this same modal — the
   * Gantt Chart's own task list (the only place this form is used;
   * editing a category/task lives there exclusively, not on the Cost
   * Estimate Breakdown page, which is read-only) wants delete to live
   * only in the edit form, not as a separate Actions-column icon (see
   * gantt-chart-view.tsx). Kept as an opt-in prop rather than always-on
   * since add mode (category === undefined) never wants one. */
  showDeleteButton?: boolean;
  onRequestDelete?: () => void;
  onSuccess?: () => void;
  /** The Gantt owns optimistic edit saves so closing this form cannot lose
   * the save result or its error handler. Create mode keeps its normal action. */
  onSave?: (form: FormData) => void;
}) {
  const boundAction = category
    ? updateCategory.bind(null, category.id, projectId)
    : createCategory.bind(null, projectId);
  const [state, formAction, pending] = useActionState(
    boundAction,
    initialState
  );
  const formId = useId();
  const router = useRouter();

  useEffect(() => {
    if (state.success) {
      router.refresh();
      onSuccess?.();
    }
    // Only re-run when the action produces a new result — `onSuccess` is
    // passed inline by the parent and would otherwise re-run this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Bound to -1 when there's no category (add mode, or the caller opted
  // out of showDeleteButton) purely so this hook can still be called
  // unconditionally — nothing renders the button that would actually
  // submit it in that case.
  const [deleteState, deleteFormAction, deletePending] = useActionState(
    deleteCategory.bind(null, category?.id ?? -1, projectId),
    initialState
  );

  useEffect(() => {
    if (deleteState.success) {
      onSuccess?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteState]);

  const showDelete = showDeleteButton && category !== undefined;
  const currentSuccessor = category
    ? (siblingCategories ?? []).find(
        (c) => c.predecessorCategoryId === category.id
      )
    : undefined;
  const relationshipOptions = (siblingCategories ?? []).filter(
    (c) => c.id !== category?.id
  );
  const materialAssignments = category?.materialAssignments ?? [];

  return (
    <div className="flex flex-col gap-4">
      <form id={formId} action={formAction} onSubmit={category && onSave ? event => {
        event.preventDefault();
        onSave(new FormData(event.currentTarget));
      } : undefined} className="flex flex-col gap-4" noValidate autoComplete="off">
        {category ? (
          <input type="hidden" name="categoryName" value={category.name} />
        ) : (
          <>
            <p className="text-sm text-zinc-500">
              Create a new category to group related tasks in your cost breakdown structure.
            </p>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={`${formId}-categoryName`}
                className="text-sm font-medium text-zinc-900"
              >
                Category Name<RequiredMark /></label>
              <input
                id={`${formId}-categoryName`}
                name="categoryName"
                required
                autoComplete="off"
                placeholder="e.g., Foundation, Electrical, Plumbing"
                className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
              />
            </div>
          </>
        )}

        {/* Same Milestone checkbox as a task's own (SubtaskForm), for a
            category that stands as a task of its own. milestoneField
            tells updateCategory it's here — an unticked box sends
            nothing. */}
        {category?.hasTasks === false && (
          <>
            <div className="flex items-center gap-2">
              <input type="hidden" name="milestoneField" value="1" />
              <span className="relative flex size-4 shrink-0">
                <input
                  id={`${formId}-isMilestone`}
                  name="isMilestone"
                  type="checkbox"
                  defaultChecked={category.isMilestone ?? false}
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
                  name="successorCategoryId"
                  defaultValue={currentSuccessor?.id ?? ""}
                  className="flex h-[38px] w-full min-w-0 cursor-pointer appearance-none items-center rounded-md border border-zinc-200 bg-white px-3 py-2 pr-8 text-left text-sm leading-5 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
                >
                  <option value="">None — no successor</option>
                  {relationshipOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-zinc-400" />
              </div>
            </div>
          </>
        )}

        {category && (
          <div
            className={`-mx-6 flex flex-col gap-2 px-6 ${
              category.hasTasks === false ? "border-t border-zinc-200 pt-4" : ""
            }`}
          >
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
            {materialAssignments.length === 0 ? (
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
                    {materialAssignments.map((material, index) => (
                      <tr
                        key={material.id}
                        className={
                          index !== materialAssignments.length - 1
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
      {showDelete && deleteState?.error && (
        <p role="alert" className="text-sm text-red-600">
          {deleteState.error}
        </p>
      )}

      <ModalFooter>
        {showDelete && category && !onRequestDelete && (
          <form
            action={deleteFormAction}
            className="mr-auto"
            onSubmit={(e) => {
              if (!window.confirm(`Delete "${category.name}"?`)) {
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
        )}
        <button
          type="button"
          onClick={onSuccess}
          className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Cancel
        </button>
        {onRequestDelete && (
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
          {pending ? "Saving..." : category ? "Save" : "Add Category"}
        </button>
      </ModalFooter>
    </div>
  );
}
