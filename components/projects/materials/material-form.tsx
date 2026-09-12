"use client";

import { useActionState, useEffect, useId, useState } from "react";
import {
  createProjectMaterial,
  updateProjectMaterial,
  type MaterialActionState,
} from "@/lib/materials/actions";
import { OTHER_UNIT, UNIT_OPTIONS } from "@/lib/cost-estimate/units";
import type { MaterialStatus, ProjectMaterial } from "@/lib/materials/data";

const initialState: MaterialActionState = {};

const STATUS_OPTIONS: { value: MaterialStatus; label: string }[] = [
  { value: "available", label: "Available" },
  { value: "low_stock", label: "Low Stock" },
  { value: "fully_consumed", label: "Fully Consumed" },
];

export function MaterialForm({
  projectId,
  material,
  onSuccess,
}: {
  projectId: number;
  material?: ProjectMaterial;
  onSuccess?: () => void;
}) {
  const boundAction = material
    ? updateProjectMaterial.bind(null, material.id, projectId)
    : createProjectMaterial.bind(null, projectId);
  const [state, formAction, pending] = useActionState(
    boundAction,
    initialState
  );
  const formId = useId();

  // Same fixed-list-with-"Other"-escape-hatch pattern as the Cost
  // Estimate Task form's Unit field, for the same reason: keeps units
  // consistent across records instead of free-typed variants of the
  // same unit ("bag" vs "bags" vs "sack").
  const initialUnitIsKnown =
    !material?.unit || (UNIT_OPTIONS as readonly string[]).includes(material.unit);
  const [selectedUnit, setSelectedUnit] = useState(
    initialUnitIsKnown ? (material?.unit ?? "") : OTHER_UNIT
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
      {material && (
        // Material ID is system-assigned (see nextMaterialCode in
        // lib/materials/actions.ts) — shown read-only once it exists,
        // never collected as input. Add mode has nothing to show yet, so
        // Material Name below takes the full row there instead.
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-zinc-800">
            Material ID
          </label>
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500">
            {material.materialCode}
          </div>
        </div>
      )}

      <div className={`flex flex-col gap-1.5 ${material ? "" : "sm:col-span-2"}`}>
        <label
          htmlFor={`${formId}-materialName`}
          className="text-sm font-medium text-zinc-800"
        >
          Material Name
        </label>
        <input
          id={`${formId}-materialName`}
          name="materialName"
          required
          defaultValue={material?.materialName}
          placeholder="e.g., Plywood"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <label
          htmlFor={`${formId}-specification`}
          className="text-sm font-medium text-zinc-800"
        >
          Specification / Size
        </label>
        <input
          id={`${formId}-specification`}
          name="specification"
          defaultValue={material?.specification ?? ""}
          placeholder="e.g., 3/8 in. x 4 ft x 8ft"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${formId}-quantity`}
          className="text-sm font-medium text-zinc-800"
        >
          Quantity
        </label>
        <input
          id={`${formId}-quantity`}
          name="quantity"
          type="number"
          min="0"
          step="0.01"
          defaultValue={material?.quantity ?? ""}
          placeholder="00"
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
            defaultValue={!initialUnitIsKnown ? (material?.unit ?? "") : ""}
            placeholder="Enter custom unit"
            className="mt-1.5 rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        )}
      </div>

      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <label
          htmlFor={`${formId}-status`}
          className="text-sm font-medium text-zinc-800"
        >
          Material Status
        </label>
        <select
          id={`${formId}-status`}
          name="status"
          defaultValue={material?.status ?? "available"}
          className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
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
