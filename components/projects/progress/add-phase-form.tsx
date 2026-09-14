"use client";

import { useActionState, useEffect, useId } from "react";
import {
  createPhaseWithFirstTask,
  type CostEstimateActionState,
} from "@/lib/cost-estimate/actions";

const initialState: CostEstimateActionState = {};

/**
 * The Gantt Chart Schedule's own "Add Phase" form — creates a new phase
 * together with a first, schedulable task in one step (see
 * createPhaseWithFirstTask's own doc comment for why, and why there's
 * no separate task-name field here). This is deliberately a separate
 * component from the Cost Estimate Breakdown's plain CategoryForm
 * (name-only) rather than a shared/extended one: the two forms serve
 * different moments — Cost Estimate Breakdown is building out cost
 * structure and doesn't need dates yet, the Gantt is a scheduling tool
 * where an undated phase is a placeholder, not a useful row.
 */
export function AddPhaseForm({
  projectId,
  onSuccess,
}: {
  projectId: number;
  onSuccess?: () => void;
}) {
  const boundAction = createPhaseWithFirstTask.bind(null, projectId);
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
    <form action={formAction} className="grid gap-4 sm:grid-cols-2" noValidate>
      <p className="text-sm text-zinc-500 sm:col-span-2">
        Creates a new phase on the schedule, ready to place on the
        timeline. Cost details can be filled in later from its own Edit
        form.
      </p>

      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <label
          htmlFor={`${formId}-categoryName`}
          className="text-sm font-medium text-zinc-800"
        >
          Phase Name
        </label>
        <input
          id={`${formId}-categoryName`}
          name="categoryName"
          required
          placeholder="e.g., Foundation, Electrical, Plumbing"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${formId}-plannedStartDate`}
          className="text-sm font-medium text-zinc-800"
        >
          Start Date
        </label>
        <input
          id={`${formId}-plannedStartDate`}
          name="plannedStartDate"
          type="date"
          required
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${formId}-plannedEndDate`}
          className="text-sm font-medium text-zinc-800"
        >
          End Date
        </label>
        <input
          id={`${formId}-plannedEndDate`}
          name="plannedEndDate"
          type="date"
          required
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex items-center gap-2 sm:col-span-2">
        <input
          id={`${formId}-isMilestone`}
          name="isMilestone"
          type="checkbox"
          className="size-4 cursor-pointer rounded border-zinc-300 text-zinc-800 focus:ring-2 focus:ring-zinc-200"
        />
        <label
          htmlFor={`${formId}-isMilestone`}
          className="cursor-pointer text-sm font-medium text-zinc-800"
        >
          Milestone
        </label>
        <span className="text-xs text-zinc-400">
          — a point-in-time event, shown as a diamond instead of a bar.
        </span>
      </div>

      <div className="flex items-center justify-end gap-3 sm:col-span-2">
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
          {pending ? "Saving..." : "Add Phase"}
        </button>
      </div>

      {state?.error && (
        <p role="alert" className="text-sm text-red-600 sm:col-span-2">
          {state.error}
        </p>
      )}
    </form>
  );
}
