"use client";

import { RequiredMark } from "@/components/ui/required-mark";
import { useActionState, useEffect, useId } from "react";
import { ChevronDown } from "lucide-react";
import { ModalFooter } from "@/components/ui/modal";
import {
  createEquipment,
  updateEquipment,
  type EquipmentActionState,
} from "@/lib/equipment/actions";
import { EQUIPMENT_CATEGORIES } from "@/lib/equipment/categories";
import type { EquipmentRow } from "@/lib/equipment/data";

const initialState: EquipmentActionState = {};

const STATUS_OPTIONS = [
  { value: "available", label: "Available" },
  { value: "maintenance", label: "Maintenance" },
  { value: "retired", label: "Retired" },
] as const;

export function EquipmentForm({
  equipment,
  onRequestDelete,
  onSuccess,
}: {
  equipment?: EquipmentRow;
  onRequestDelete?: () => void;
  onSuccess?: () => void;
}) {
  const boundAction = equipment
    ? updateEquipment.bind(null, equipment.id)
    : createEquipment;
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
    <div className="flex flex-col gap-4">
      <form id={formId} action={formAction} autoComplete="off" className="grid gap-4 sm:grid-cols-2" noValidate>
        {equipment && (
          // Asset Tag is system-assigned (see nextAssetTag in
          // lib/equipment/actions.ts) — shown read-only once it exists,
          // never collected as input. Add mode has nothing to show yet, so
          // Equipment Name below takes the full row there instead.
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-zinc-900">
              Asset Tag
            </label>
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500">
              {equipment.assetTag}
            </div>
          </div>
        )}

        <div className={`flex flex-col gap-1.5 ${equipment ? "" : "sm:col-span-2"}`}>
          <label
            htmlFor={`${formId}-name`}
            className="text-sm font-medium text-zinc-900"
          >
            Equipment Name<RequiredMark /></label>
          <input
            id={`${formId}-name`}
            name="name"
            required
            defaultValue={equipment?.name}
            placeholder="e.g., Concrete Mixer"
            className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label
            htmlFor={`${formId}-category`}
            className="text-sm font-medium text-zinc-900"
          >
            Category
          </label>
          <div className="relative">
            <select
              id={`${formId}-category`}
              name="category"
              defaultValue={equipment?.category ?? ""}
              className="flex h-[38px] w-full min-w-0 cursor-pointer appearance-none items-center rounded-md border border-zinc-200 bg-white px-3 py-2 pr-8 text-left text-sm leading-5 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
            >
              <option value="">Select category</option>
              {EQUIPMENT_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-zinc-400" />
          </div>
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label
            htmlFor={`${formId}-description`}
            className="text-sm font-medium text-zinc-900"
          >
            Description
          </label>
          <textarea
            id={`${formId}-description`}
            name="description"
            defaultValue={equipment?.description ?? ""}
            rows={3}
            placeholder="e.g., Portable concrete mixing machine"
            className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        </div>

        <div className={`flex flex-col gap-1.5 ${equipment ? "" : "sm:col-span-2"}`}>
          <label
            htmlFor={`${formId}-serialNumber`}
            className="text-sm font-medium text-zinc-900"
          >
            Serial Number{" "}
            <span className="font-normal text-zinc-400">(optional)</span>
          </label>
          <input
            id={`${formId}-serialNumber`}
            name="serialNumber"
            defaultValue={equipment?.serialNumber ?? ""}
            placeholder="e.g., SN-2024-00871"
            className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        </div>

        {equipment && (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-zinc-900">Status</label>
            {equipment.status === "assigned" ? (
              <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500">
                Assigned to {equipment.currentProjectName ?? "a project"} — return
                it first to change status
              </div>
            ) : (
              <div className="relative">
                <select
                  name="status"
                  defaultValue={equipment.status}
                  className="flex h-[38px] w-full min-w-0 cursor-pointer appearance-none items-center rounded-md border border-zinc-200 bg-white px-3 py-2 pr-8 text-left text-sm leading-5 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-zinc-400" />
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
        {equipment && onRequestDelete && (
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
