"use client";

import { RequiredMark } from "@/components/ui/required-mark";
import { useActionState, useEffect, useId, useState } from "react";
import Link from "next/link";
import { ChevronDown, Folder, ListTodo } from "lucide-react";
import { ModalFooter } from "@/components/ui/modal";
import {
  createEquipment,
  updateEquipment,
  type EquipmentActionState,
} from "@/lib/equipment/actions";
import { EQUIPMENT_CATEGORIES } from "@/lib/equipment/categories";
import type { EquipmentRow } from "@/lib/equipment/data";

const initialState: EquipmentActionState = {};

export function EquipmentForm({
  equipment,
  onRequestDelete,
  onSuccess,
  readOnly = false,
  basePath = "/admin",
}: {
  equipment?: EquipmentRow;
  onRequestDelete?: () => void;
  onSuccess?: () => void;
  readOnly?: boolean;
  basePath?: string;
}) {
  const [editing, setEditing] = useState(!equipment);
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
      {!readOnly && editing ? <form id={formId} action={formAction} autoComplete="off" className="grid gap-4 sm:grid-cols-2" noValidate>
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
              <option value="" hidden>Select category</option>
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

        {!equipment && (<div className="flex flex-col gap-1.5 sm:col-span-2">
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
            defaultValue=""
            placeholder="e.g., SN-2024-00871"
            className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        </div>)}

      </form> : equipment && (
        <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-3 text-sm">
          <dt className="text-zinc-500">Asset Tag</dt><dd>{equipment.assetTag}</dd>
          <dt className="text-zinc-500">Category</dt><dd>{equipment.category || "Not recorded"}</dd>
          <dt className="text-zinc-500">Description</dt><dd className="whitespace-pre-wrap break-words">{equipment.description || "Not recorded"}</dd>
        </dl>
      )}
      {equipment && <section className="mt-2 border-t border-zinc-200 pt-4">
        <h3 className="mb-3 text-sm font-semibold text-zinc-900">Assignments</h3>
        <div className="flex items-center gap-2 text-sm">
          <Folder className="size-4 text-zinc-400" />
          <span className="text-zinc-500">Assigned project</span>
          {equipment.currentProjectId && equipment.currentProjectName
            ? <Link href={`${basePath}/projects/${equipment.currentProjectId}`} className="font-medium text-zinc-900 hover:underline">{equipment.currentProjectName}</Link>
            : <span className="text-zinc-400">Not assigned</span>}
        </div>
        <h4 className="mt-4 mb-2 text-xs font-medium text-zinc-500">Tasks</h4>
        {(equipment.taskAssignments ?? []).length ? <div className="divide-y divide-zinc-100">
          {equipment.taskAssignments!.map((task, index) => <div key={`${task.projectId}-${task.itemKey}-${task.kind}-${index}`} className="flex items-start gap-2 py-2 text-sm">
            <ListTodo className="mt-0.5 size-4 shrink-0 text-zinc-400" />
            <div className="min-w-0 flex-1"><p className="break-words text-zinc-900">{task.taskName}</p><Link className="text-xs text-zinc-500 hover:underline" href={`${basePath}/projects/${task.projectId}`}>{task.projectName}</Link></div>
            <span className="text-xs text-zinc-500">{task.kind === "in_use" ? "In use" : "Planned"}</span>
          </div>)}
        </div> : <p className="text-sm text-zinc-400">{equipment.assignmentLoadError ? "Could not load all assignments. Refresh and try again." : "No task assignments."}</p>}
      </section>}

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
        {!readOnly && equipment && onRequestDelete && (
          <button
            type="button"
            onClick={onRequestDelete}
            className="cursor-pointer rounded border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
          >
            Delete
          </button>
        )}
        {!readOnly && !editing && <button type="button" onClick={() => setEditing(true)} className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800">Edit</button>}
        {!readOnly && editing && <button
          type="submit"
          form={formId}
          disabled={pending}
          className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save"}
        </button>}
      </ModalFooter>
    </div>
  );
}
