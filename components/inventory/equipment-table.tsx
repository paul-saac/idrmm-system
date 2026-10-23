"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Folder, Send, Trash2, Undo2 } from "lucide-react";
import { EditIcon } from "@/components/icons/edit-icon";
import { SelectAllCell, SelectCell, BLANK } from "@/components/ui/list-table";
import {
  deleteEquipment,
  returnEquipment,
  type EquipmentActionState,
} from "@/lib/equipment/actions";
import type { EquipmentRow } from "@/lib/equipment/data";

const TH = "px-4 py-3 font-medium";
const TD = "px-4 py-3.5";

const ICON_BTN =
  "cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-50";

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function StatusBadge({ equipment }: { equipment: EquipmentRow }) {
  const isReturned = equipment.lastReturnedAt != null && equipment.status === "available";
  const { label, className } =
    equipment.status === "assigned"
      ? { label: "Assigned", className: "bg-amber-50 text-amber-700" }
      : equipment.status === "maintenance"
      ? { label: "Maintenance", className: "bg-red-50 text-red-700" }
      : equipment.status === "retired"
      ? { label: "Retired", className: "bg-zinc-100 text-zinc-500" }
      : isReturned
      ? { label: "Returned", className: "bg-teal-50 text-teal-700" }
      : { label: "Available", className: "bg-emerald-50 text-emerald-700" };

  return (
    <span
      className={`rounded-sm px-2 py-0.5 text-xs font-medium whitespace-nowrap ${className}`}
    >
      {label}
    </span>
  );
}

/** A row action's own error, floating just under it. */
function ActionError({ message }: { message: string }) {
  return (
    <span
      role="alert"
      className="absolute top-full right-0 z-10 mt-1 w-48 rounded-md border border-red-200 bg-white px-2 py-1 text-right text-xs font-normal text-red-600 shadow-sm"
    >
      {message}
    </span>
  );
}

const deleteInitialState: EquipmentActionState = {};

function DeleteEquipmentButton({
  equipmentId,
  equipmentName,
}: {
  equipmentId: number;
  equipmentName: string;
}) {
  const boundAction = deleteEquipment.bind(null, equipmentId);
  const [state, formAction, pending] = useActionState(boundAction, deleteInitialState);

  return (
    <span className="relative inline-flex">
      <form
        action={formAction}
        onSubmit={(e) => {
          if (!window.confirm(`Delete "${equipmentName}"? This cannot be undone.`)) {
            e.preventDefault();
          }
        }}
      >
        <button
          type="submit"
          disabled={pending}
          title="Delete equipment"
          aria-label={`Delete ${equipmentName}`}
          className="cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 className="size-3.5" />
        </button>
      </form>
      {state?.error && <ActionError message={state.error} />}
    </span>
  );
}

const returnInitialState: EquipmentActionState = {};

function ReturnEquipmentButton({
  equipmentId,
  projectId,
}: {
  equipmentId: number;
  projectId: number;
}) {
  const boundAction = returnEquipment.bind(null, equipmentId, projectId);
  const [state, formAction, pending] = useActionState(boundAction, returnInitialState);

  return (
    <span className="relative inline-flex">
      <form action={formAction}>
        <button
          type="submit"
          disabled={pending}
          title="Mark as returned"
          aria-label="Return equipment"
          className={ICON_BTN}
        >
          <Undo2 className="size-3.5" />
        </button>
      </form>
      {state?.error && <ActionError message={state.error} />}
    </span>
  );
}

/**
 * Tools and equipment record table — styled cleanly to match the members table:
 * standard rounded-lg container, rounded-sm badges, plain text asset tags, and comfortable row heights.
 */
export function EquipmentTable({
  equipment,
  selected,
  onCheck,
  onEdit,
  onAssign,
  basePath = "/admin",
  readOnly = false,
}: {
  equipment: EquipmentRow[];
  /** Checked item ids. */
  selected: ReadonlySet<number>;
  onCheck: (ids: number[], checked: boolean) => void;
  onEdit: (equipment: EquipmentRow) => void;
  onAssign: (equipment: EquipmentRow) => void;
  basePath?: string;
  readOnly?: boolean;
}) {
  const ids = equipment.map((item) => item.id);
  const checkedCount = ids.filter((id) => selected.has(id)).length;
  const allChecked = ids.length > 0 && checkedCount === ids.length;

  return (
    <div className="min-w-0 rounded-lg border border-zinc-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-5xl text-left text-[13px] text-zinc-600">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-500">
              {!readOnly && (
                <SelectAllCell
                  checked={allChecked}
                  indeterminate={checkedCount > 0 && !allChecked}
                  onChange={() => onCheck(ids, !allChecked)}
                  label="Select all equipment"
                />
              )}
              <th className={TH}>Asset Tag</th>
              <th className={TH}>Name</th>
              <th className={TH}>Category</th>
              <th className={TH}>Description</th>
              <th className={TH}>Status</th>
              <th className={TH}>Assigned Project</th>
              <th className={TH}>Last Activity</th>
              {!readOnly && (
                <th className={`${TH} text-right`}>
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {equipment.map((item) => {
              const lastActivity = item.lastAssignedAt ?? item.lastReturnedAt;
              const checked = selected.has(item.id);
              return (
                <tr
                  key={item.id}
                  className={`transition-colors ${
                    checked ? "bg-zinc-100" : "hover:bg-zinc-50"
                  }`}
                >
                  {!readOnly && (
                    <SelectCell
                      checked={checked}
                      onChange={() => onCheck([item.id], !checked)}
                      label={`Select ${item.name}`}
                    />
                  )}
                  <td className={`${TD} font-medium whitespace-nowrap text-zinc-900`}>
                    {item.assetTag}
                  </td>
                  <td className={`${TD} font-semibold text-zinc-900`}>
                    {item.name}
                  </td>
                  <td className={`${TD} text-zinc-600`}>
                    {item.category || BLANK}
                  </td>
                  <td
                    className={`${TD} max-w-xs truncate text-zinc-500`}
                    title={item.description ?? undefined}
                  >
                    {item.description || BLANK}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <StatusBadge equipment={item} />
                  </td>
                  <td className={`${TD} text-zinc-600`}>
                    {item.currentProjectId && item.currentProjectName ? (
                      <span className="flex min-w-0 items-center gap-1.5" title={item.currentProjectName}>
                        <Folder
                          aria-hidden
                          className="size-3.5 shrink-0 text-zinc-400"
                        />
                        <Link
                          href={`${basePath}/projects/${item.currentProjectId}`}
                          className="truncate font-medium text-zinc-900 hover:underline"
                        >
                          {item.currentProjectName}
                        </Link>
                      </span>
                    ) : (
                      BLANK
                    )}
                  </td>
                  <td className={`${TD} whitespace-nowrap text-xs text-zinc-500 tabular-nums`}>
                    {lastActivity ? formatDateTime(lastActivity) : BLANK}
                  </td>
                  {!readOnly && (
                    <td className={`${TD} text-right whitespace-nowrap`}>
                      <div className="flex items-center justify-end gap-1">
                        {item.status === "assigned" ? (
                          item.currentProjectId != null && (
                            <ReturnEquipmentButton
                              equipmentId={item.id}
                              projectId={item.currentProjectId}
                            />
                          )
                        ) : item.status === "available" ? (
                          <button
                            type="button"
                            onClick={() => onAssign(item)}
                            title="Assign to project"
                            aria-label={`Assign ${item.name}`}
                            className={ICON_BTN}
                          >
                            <Send className="size-3.5" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => onEdit(item)}
                          title="Edit equipment"
                          aria-label={`Edit ${item.name}`}
                          className={ICON_BTN}
                        >
                          <EditIcon className="size-3.5" />
                        </button>
                        <DeleteEquipmentButton
                          equipmentId={item.id}
                          equipmentName={item.name}
                        />
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t border-zinc-200 px-6 py-3 text-xs text-zinc-500">
        Showing <span className="font-semibold text-zinc-700">{equipment.length}</span>{" "}
        {equipment.length === 1 ? "equipment item" : "tools and equipment items"}
        {checkedCount > 0 && (
          <span className="ml-2 font-medium text-zinc-700">
            ({checkedCount} selected)
          </span>
        )}
      </div>
    </div>
  );
}
