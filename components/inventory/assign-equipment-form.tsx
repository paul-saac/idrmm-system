"use client";

import { RequiredMark } from "@/components/ui/required-mark";
import { useActionState, useEffect, useId } from "react";
import { ChevronDown } from "lucide-react";
import { ModalFooter } from "@/components/ui/modal";
import { assignEquipment, type EquipmentActionState } from "@/lib/equipment/actions";
import type { EquipmentRow } from "@/lib/equipment/data";

const initialState: EquipmentActionState = {};

export function AssignEquipmentForm({
  equipment,
  projects,
  onSuccess,
}: {
  equipment: EquipmentRow;
  projects: { id: number; name: string }[];
  onSuccess?: () => void;
}) {
  const boundAction = assignEquipment.bind(null, equipment.id);
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
      <form id={formId} action={formAction} className="flex flex-col gap-4" noValidate>
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
          <span className="font-medium text-zinc-900">{equipment.name}</span>
          <span className="ml-1.5 text-zinc-400">{equipment.assetTag}</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`${formId}-projectId`}
            className="text-sm font-medium text-zinc-900"
          >
            Assign to Project<RequiredMark /></label>
          <div className="relative">
            <select
              id={`${formId}-projectId`}
              name="projectId"
              required
              defaultValue=""
              className="flex h-[38px] w-full min-w-0 cursor-pointer appearance-none items-center rounded-md border border-zinc-200 bg-white px-3 py-2 pr-8 text-left text-sm leading-5 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
            >
              <option value="" disabled hidden>
                Select a project
              </option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-zinc-400" />
          </div>
          {projects.length === 0 && (
            <p className="text-xs text-amber-600">
              No projects to assign to yet — create a project first.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`${formId}-notes`}
            className="text-sm font-medium text-zinc-900"
          >
            Purpose{" "}
            <span className="font-normal text-zinc-400">(optional)</span>
          </label>
          <textarea
            id={`${formId}-notes`}
            name="notes"
            rows={2}
            className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        </div>
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
        <button
          type="submit"
          form={formId}
          disabled={pending || projects.length === 0}
          className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Assigning..." : "Assign"}
        </button>
      </ModalFooter>
    </div>
  );
}
