"use client";

import { useActionState, useEffect } from "react";
import {
  createCategory,
  updateCategory,
  type CostEstimateActionState,
} from "@/lib/cost-estimate/actions";
import type { CostCategory } from "@/lib/cost-estimate/data";

const initialState: CostEstimateActionState = {};

export function CategoryForm({
  projectId,
  category,
  onSuccess,
}: {
  projectId: number;
  category?: Pick<CostCategory, "id" | "name">;
  onSuccess?: () => void;
}) {
  const boundAction = category
    ? updateCategory.bind(null, category.id, projectId)
    : createCategory.bind(null, projectId);
  const [state, formAction, pending] = useActionState(
    boundAction,
    initialState
  );

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
      <p className="text-sm text-zinc-500">
        {category
          ? "Rename this category."
          : "Create a new category to group related tasks in your cost breakdown structure."}
      </p>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="categoryName"
          className="text-sm font-medium text-zinc-800"
        >
          Category Name
        </label>
        <input
          id="categoryName"
          name="categoryName"
          required
          defaultValue={category?.name}
          placeholder="e.g., Foundation, Electrical, Plumbing"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
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
          {pending ? "Saving..." : category ? "Save" : "Add Category"}
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
