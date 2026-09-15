"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import {
  createTask,
  updateTask,
  type CostEstimateActionState,
} from "@/lib/cost-estimate/actions";
import { UNIT_OPTIONS, OTHER_UNIT } from "@/lib/cost-estimate/units";
import type { CostCategory, CostTask } from "@/lib/cost-estimate/data";

const initialState: CostEstimateActionState = {};

type OtherCostRow = {
  key: number;
  costName?: string;
  amount?: number;
};

export function TaskForm({
  projectId,
  categories,
  task,
  defaultCategoryId,
  onSuccess,
}: {
  projectId: number;
  categories: Pick<CostCategory, "id" | "name">[];
  task?: CostTask;
  defaultCategoryId?: number;
  onSuccess?: () => void;
}) {
  const boundAction = task
    ? updateTask.bind(null, task.id, projectId)
    : createTask.bind(null, projectId);
  const [state, formAction, pending] = useActionState(
    boundAction,
    initialState
  );
  const formId = useId();

  // Unit is a fixed dropdown, with "Other" as an escape hatch that
  // reveals a text input — covers a task whose saved unit isn't one of
  // the predefined choices (e.g. entered before this dropdown existed).
  const initialUnitIsKnown =
    !task?.unit || (UNIT_OPTIONS as readonly string[]).includes(task.unit);
  const [selectedUnit, setSelectedUnit] = useState(
    initialUnitIsKnown ? (task?.unit ?? "") : OTHER_UNIT
  );

  // Stable per-row keys that survive add/remove, independent of the
  // rows' array index (using index as key would misattribute a row's
  // inputs to the wrong data after removing an earlier row). Existing
  // items already have real (positive) DB ids, so those are reused
  // directly; newly-added rows count down from -1 so they can never
  // collide with one. The counter is only ever touched from the "Add
  // Other Cost Item" click handler, never during render.
  const nextNewKeyRef = useRef(-1);

  const [otherCostRows, setOtherCostRows] = useState<OtherCostRow[]>(() =>
    (task?.otherCostItems ?? []).map((item) => ({
      key: item.id,
      costName: item.costName,
      amount: item.amount,
    }))
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
    <form action={formAction} className="grid gap-4 sm:grid-cols-2" noValidate>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <label
          htmlFor={`${formId}-categoryId`}
          className="text-sm font-medium text-zinc-800"
        >
          Select Category
        </label>
        <select
          id={`${formId}-categoryId`}
          name="categoryId"
          required
          defaultValue={task?.categoryId ?? defaultCategoryId ?? ""}
          className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        >
          <option value="" disabled>
            Select Phase Category
          </option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        {categories.length === 0 && (
          <p className="text-xs text-amber-600">
            Add a category first before adding task items.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <label
          htmlFor={`${formId}-taskName`}
          className="text-sm font-medium text-zinc-800"
        >
          Task Description
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

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${formId}-estimatedQuantity`}
          className="text-sm font-medium text-zinc-800"
        >
          Estimated Quantity
        </label>
        <input
          id={`${formId}-estimatedQuantity`}
          name="estimatedQuantity"
          type="number"
          min="0"
          step="0.01"
          defaultValue={task?.estimatedQuantity ?? ""}
          placeholder="00.0"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${formId}-unit`}
          className="text-sm font-medium text-zinc-800"
        >
          Unit
        </label>
        <select
          id={`${formId}-unit`}
          // Only the active control submits as "unit" — the select when
          // a predefined unit is chosen, the text input when "Other" is.
          name={selectedUnit === OTHER_UNIT ? undefined : "unit"}
          value={selectedUnit}
          onChange={(e) => setSelectedUnit(e.target.value)}
          className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        >
          <option value="">Select unit</option>
          {UNIT_OPTIONS.map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
          <option value={OTHER_UNIT}>Other (specify)</option>
        </select>
        {selectedUnit === OTHER_UNIT && (
          <input
            name="unit"
            required
            defaultValue={!initialUnitIsKnown ? (task?.unit ?? "") : ""}
            placeholder="Enter custom unit"
            className="mt-1.5 rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${formId}-laborEstimate`}
          className="text-sm font-medium text-zinc-800"
        >
          Labor Estimate
        </label>
        <input
          id={`${formId}-laborEstimate`}
          name="laborEstimate"
          type="number"
          min="0"
          step="0.01"
          defaultValue={task?.laborEstimate ?? ""}
          placeholder="00.0"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${formId}-materialEstimate`}
          className="text-sm font-medium text-zinc-800"
        >
          Material Estimate
        </label>
        <input
          id={`${formId}-materialEstimate`}
          name="materialEstimate"
          type="number"
          min="0"
          step="0.01"
          defaultValue={task?.materialEstimate ?? ""}
          placeholder="00.0"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${formId}-equipmentEstimate`}
          className="text-sm font-medium text-zinc-800"
        >
          Equipment Estimate
        </label>
        <input
          id={`${formId}-equipmentEstimate`}
          name="equipmentEstimate"
          type="number"
          min="0"
          step="0.01"
          defaultValue={task?.equipmentEstimate ?? ""}
          placeholder="00.0"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${formId}-plannedStartDate`}
          className="text-sm font-medium text-zinc-800"
        >
          Planned Start Date
        </label>
        <input
          id={`${formId}-plannedStartDate`}
          name="plannedStartDate"
          type="date"
          defaultValue={task?.plannedStartDate ?? ""}
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${formId}-plannedEndDate`}
          className="text-sm font-medium text-zinc-800"
        >
          Planned End Date
        </label>
        <input
          id={`${formId}-plannedEndDate`}
          name="plannedEndDate"
          type="date"
          defaultValue={task?.plannedEndDate ?? ""}
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      {/* Milestone and Predecessor are set from the Gantt Chart Schedule
          instead (its own subtask form + drag-to-connect predecessor
          arrows) — this form no longer shows them, but still carries
          whatever's already set through as hidden fields so saving a
          plain cost/quantity edit here can't silently wipe either one. */}
      <input
        type="hidden"
        name="predecessorTaskId"
        defaultValue={task?.predecessorTaskId ?? ""}
      />
      {task?.isMilestone && (
        <input type="hidden" name="isMilestone" value="on" />
      )}

      <div className="flex flex-col gap-3 border-t border-zinc-200 pt-4 sm:col-span-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-zinc-800">
            Other Cost Items
          </h3>
          <button
            type="button"
            onClick={() =>
              setOtherCostRows((rows) => [
                ...rows,
                { key: nextNewKeyRef.current-- },
              ])
            }
            className="flex cursor-pointer items-center gap-1 rounded border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
          >
            <Plus className="size-3.5" />
            Add Other Cost Item
          </button>
        </div>

        {otherCostRows.length === 0 && (
          <p className="text-xs text-zinc-400">
            No additional costs for this task.
          </p>
        )}

        {otherCostRows.map((row) => (
          <div key={row.key} className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <label className="text-xs text-zinc-500">Cost Name</label>
              <input
                name="otherCostName"
                defaultValue={row.costName}
                placeholder="e.g., Permit Fee"
                className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
              />
            </div>
            <div className="flex w-28 flex-shrink-0 flex-col gap-1.5">
              <label className="text-xs text-zinc-500">Amount</label>
              <input
                name="otherCostAmount"
                type="number"
                min="0"
                step="0.01"
                defaultValue={row.amount ?? ""}
                placeholder="00.0"
                className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
              />
            </div>
            <button
              type="button"
              onClick={() =>
                setOtherCostRows((rows) =>
                  rows.filter((r) => r.key !== row.key)
                )
              }
              aria-label="Remove other cost item"
              className="cursor-pointer rounded border border-zinc-200 p-2 text-zinc-400 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
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
          {pending ? "Saving..." : "Save"}
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
