"use client";

import { RequiredMark } from "@/components/ui/required-mark";
import { useActionState, useEffect, useId, useState } from "react";
import Link from "next/link";
import { ChevronDown, Folder } from "lucide-react";
import { ModalFooter, ModalHeaderActions } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  createEquipment,
  updateEquipment,
  setEquipmentServiceStatus,
  type EquipmentActionState,
} from "@/lib/equipment/actions";
import { EQUIPMENT_CATEGORIES } from "@/lib/equipment/categories";
import type { EquipmentRow } from "@/lib/equipment/data";
import { equipmentTaskDateRange, equipmentUseStatus } from "@/lib/equipment/usage-status";
import { EquipmentUsageBadge } from "@/components/inventory/equipment-usage-badge";

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
  const [serviceConfirm, setServiceConfirm] = useState(false);
  const [servicePending, setServicePending] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const boundAction = equipment
    ? updateEquipment.bind(null, equipment.id)
    : createEquipment;
  const [state, formAction, pending] = useActionState(
    boundAction,
    initialState
  );
  const formId = useId();
  const taskAssignments = equipment?.status === "maintenance" ? [] : equipment?.taskAssignments ?? [];
  const nextServiceStatus = equipment?.status === "maintenance" ? "available" : "maintenance";
  const serviceLabel = nextServiceStatus === "maintenance" ? "Mark for maintenance" : "Mark as available";
  async function changeServiceStatus() {
    if (!equipment || readOnly || servicePending) return;
    setServicePending(true); setServiceError(null);
    try {
      const result = await setEquipmentServiceStatus(equipment.id, equipment.status, nextServiceStatus);
      if (result.error) { setServiceError(result.error); return; }
      setServiceConfirm(false); onSuccess?.();
    } catch { setServiceError("Could not change equipment status. Please try again."); }
    finally { setServicePending(false); }
  }

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
      {!readOnly && !editing && equipment && equipment.status !== "retired" && (
        <ModalHeaderActions>
          <button type="button"
            onClick={() => { setServiceError(null); setServiceConfirm(true); }}
            className="cursor-pointer rounded border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
            {serviceLabel}
          </button>
        </ModalHeaderActions>
      )}

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
          <dt className="text-zinc-500">Status</dt><dd className="flex flex-wrap items-center justify-between gap-2">
            <EquipmentUsageBadge status={equipmentUseStatus(equipment)} />
          </dd>
          <dt className="text-zinc-500">Description</dt><dd className="whitespace-pre-wrap break-words">{equipment.description || "Not recorded"}</dd>
        </dl>
      )}
      {equipment && <section className="-mx-6 mt-2 border-t border-zinc-200">
        <h3 className="flex items-center gap-2 border-b border-zinc-200 px-6 py-4 text-sm font-semibold text-zinc-900">
          <Folder aria-hidden="true" className="size-4 text-zinc-400" />Assignments
        </h3>
        {taskAssignments.length ? <table className="w-full table-fixed border-collapse text-left text-sm">
          <colgroup><col className="w-[38%]" /><col /><col className="w-[112px]" /></colgroup>
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
            <tr><th scope="col" className="py-2 pr-3 pl-6 font-medium">Task</th>
              <th scope="col" className="px-3 py-2 font-medium">Planned dates</th>
              <th scope="col" className="py-2 pr-6 pl-3 text-right font-medium">Status</th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {taskAssignments.map((task, index) => <tr key={`${task.projectId}-${task.itemKey}-${task.kind}-${index}`}>
              <td className="py-3 pr-3 pl-6 align-middle"><p className="break-words text-zinc-900">{task.taskName}</p>
                {task.canViewProject === false ? <span className="text-xs text-zinc-500">{task.projectName}</span> : <Link className="text-xs text-zinc-500 hover:underline" href={`${basePath}/projects/${task.projectId}`}>{task.projectName}</Link>}</td>
              <td className="px-3 py-3 align-middle text-xs leading-5 text-zinc-500">{equipmentTaskDateRange(task.startDate, task.endDate)}</td>
              <td className="py-3 pr-6 pl-3 text-right align-middle"><EquipmentUsageBadge status={task.useStatus} /></td>
            </tr>)}
          </tbody>
        </table> : <p className="px-6 py-4 text-sm text-zinc-400">{equipment.assignmentLoadError ? "Could not load all assignments. Refresh and try again." : "No task assignments."}</p>}
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
      <ConfirmDialog open={serviceConfirm} title={nextServiceStatus === "maintenance" ? "Mark for maintenance?" : "Mark as available?"}
        message={nextServiceStatus === "available" ? "Confirm that repairs or servicing are complete and this equipment is ready to be assigned."
          : equipment?.status === "assigned" ? "This removes all task assignments across projects and takes the equipment out of service. Saved progress and cost records are kept."
          : "This removes all task assignments and takes the equipment out of service until maintenance is complete."}
        confirmLabel={serviceLabel} pendingLabel="Saving..." pending={servicePending} error={serviceError}
        onConfirm={changeServiceStatus} onCancel={() => { if (!servicePending) setServiceConfirm(false); }} />
    </div>
  );
}
