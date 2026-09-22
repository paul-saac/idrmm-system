"use client";

import { useActionState, useEffect, useId } from "react";
import { Trash2 } from "lucide-react";
import {
  createCategory,
  deleteCategory,
  updateCategory,
  type CostEstimateActionState,
} from "@/lib/cost-estimate/actions";
import type { CostCategory } from "@/lib/cost-estimate/data";

const initialState: CostEstimateActionState = {};

export function CategoryForm({
  projectId,
  category,
  showDeleteButton,
  onSuccess,
}: {
  projectId: number;
  category?: Pick<CostCategory, "id" | "name">;
  /** Adds a Delete button (edit mode only) to this same modal — the
   * Gantt Chart's own task list (the only place this form is used;
   * editing a category/task lives there exclusively, not on the Cost
   * Estimate Breakdown page, which is read-only) wants delete to live
   * only in the edit form, not as a separate Actions-column icon (see
   * gantt-chart-view.tsx). Kept as an opt-in prop rather than always-on
   * since add mode (category === undefined) never wants one. */
  showDeleteButton?: boolean;
  onSuccess?: () => void;
}) {
  const boundAction = category
    ? updateCategory.bind(null, category.id, projectId)
    : createCategory.bind(null, projectId);
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

  return (
    <div className="flex flex-col gap-4">
      <form id={formId} action={formAction} className="flex flex-col gap-4" noValidate>
        <p className="text-sm text-zinc-500">
          {category
            ? "Rename this category."
            : "Create a new category to group related tasks in your cost breakdown structure."}
        </p>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`${formId}-categoryName`}
            className="text-sm font-medium text-zinc-800"
          >
            Category Name
          </label>
          <input
            id={`${formId}-categoryName`}
            name="categoryName"
            required
            defaultValue={category?.name}
            placeholder="e.g., Foundation, Electrical, Plumbing"
            className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        </div>
      </form>

      <div className="flex items-center justify-between gap-3">
        {showDelete && category ? (
          <form
            action={deleteFormAction}
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
            {pending ? "Saving..." : category ? "Save" : "Add Category"}
          </button>
        </div>
      </div>

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
    </div>
  );
}
