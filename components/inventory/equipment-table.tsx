"use client";

import { useActionState } from "react";
import { Send, Trash2, Undo2 } from "lucide-react";
import { EditIcon } from "@/components/icons/edit-icon";
import {
  BLANK,
  BODY,
  CELL,
  HEAD_CELL,
  HEAD_ROW,
  ICON_BUTTON,
  SelectAllCell,
  SelectCell,
  TABLE,
  TABLE_FRAME,
  rowClass,
} from "@/components/ui/list-table";
import {
  deleteEquipment,
  returnEquipment,
  type EquipmentActionState,
} from "@/lib/equipment/actions";
import type { EquipmentRow } from "@/lib/equipment/data";

const NEUTRAL_BUTTON = `${ICON_BUTTON} hover:bg-zinc-100 hover:text-zinc-700`;

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
  const { label, className } =
    equipment.status === "assigned"
      ? { label: "Assigned", className: "bg-amber-50 text-amber-700" }
      : equipment.status === "maintenance"
        ? { label: "Maintenance", className: "bg-red-50 text-red-700" }
        : equipment.status === "retired"
          ? { label: "Retired", className: "bg-zinc-100 text-zinc-500" }
          : // "available" reads as "Returned" once it has assignment
            // history — the same green end-state, a more informative label.
            {
              label: equipment.lastReturnedAt ? "Returned" : "Available",
              className: "bg-emerald-50 text-emerald-700",
            };
  return (
    <span className={`rounded-sm px-2 py-0.5 text-xs font-medium whitespace-nowrap ${className}`}>
      {label}
    </span>
  );
}

/** A row action's own error, just under it. */
function ActionError({ message }: { message: string }) {
  return (
    <span
      role="alert"
      className="absolute top-full left-0 z-10 mt-1 w-48 rounded-md border border-red-200 bg-white px-2 py-1 text-xs font-normal text-red-600 shadow-sm"
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
          title="Delete"
          aria-label={`Delete ${equipmentName}`}
          className={`${ICON_BUTTON} hover:bg-red-50 hover:text-red-600`}
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
          className={NEUTRAL_BUTTON}
        >
          <Undo2 className="size-3.5" />
        </button>
      </form>
      {state?.error && <ActionError message={state.error} />}
    </span>
  );
}

/** The company's tools and equipment, in the Team table's own style (see
 * list-table) — checkboxes and the Actions column only where it's
 * editable (not the foreman portal's view-only copy). */
export function EquipmentTable({
  equipment,
  selected,
  onCheck,
  onEdit,
  onAssign,
  readOnly = false,
}: {
  equipment: EquipmentRow[];
  /** Checked item ids. */
  selected: ReadonlySet<number>;
  onCheck: (ids: number[], checked: boolean) => void;
  onEdit: (equipment: EquipmentRow) => void;
  onAssign: (equipment: EquipmentRow) => void;
  readOnly?: boolean;
}) {
  const ids = equipment.map((item) => item.id);
  const checkedCount = ids.filter((id) => selected.has(id)).length;
  const allChecked = checkedCount === ids.length;

  return (
    <div className={TABLE_FRAME}>
      <table className={TABLE}>
        <thead>
          <tr className={HEAD_ROW}>
            {!readOnly && (
              <SelectAllCell
                checked={allChecked}
                indeterminate={checkedCount > 0 && !allChecked}
                onChange={() => onCheck(ids, !allChecked)}
                label="Select all equipment"
              />
            )}
            <th className={HEAD_CELL}>Asset Tag</th>
            <th className={HEAD_CELL}>Name</th>
            <th className={HEAD_CELL}>Category</th>
            <th className={HEAD_CELL}>Description</th>
            <th className={HEAD_CELL}>Status</th>
            <th className={HEAD_CELL}>Assigned Project</th>
            <th className={HEAD_CELL}>Last Activity</th>
            {!readOnly && <th className={HEAD_CELL}>Actions</th>}
          </tr>
        </thead>
        <tbody className={BODY}>
          {equipment.map((item) => {
            const lastActivity = item.lastAssignedAt ?? item.lastReturnedAt;
            const checked = selected.has(item.id);
            return (
              <tr key={item.id} className={rowClass(checked)}>
                {!readOnly && (
                  <SelectCell
                    checked={checked}
                    onChange={() => onCheck([item.id], !checked)}
                    label={`Select ${item.name}`}
                  />
                )}
                <td className={`${CELL} font-medium whitespace-nowrap text-zinc-900`}>
                  {item.assetTag}
                </td>
                <td className={`${CELL} font-medium text-zinc-900`}>{item.name}</td>
                <td className={CELL}>{item.category || BLANK}</td>
                <td className={`${CELL} max-w-64 truncate`} title={item.description ?? undefined}>
                  {item.description || BLANK}
                </td>
                <td className={CELL}>
                  <StatusBadge equipment={item} />
                </td>
                <td className={CELL}>{item.currentProjectName ?? BLANK}</td>
                <td className={`${CELL} whitespace-nowrap text-zinc-500`}>
                  {lastActivity ? formatDateTime(lastActivity) : BLANK}
                </td>
                {!readOnly && (
                  <td className={CELL}>
                    <div className="flex items-center gap-1">
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
                          title="Assign to a project"
                          aria-label={`Assign ${item.name}`}
                          className={NEUTRAL_BUTTON}
                        >
                          <Send className="size-3.5" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => onEdit(item)}
                        title="Edit"
                        aria-label={`Edit ${item.name}`}
                        className={NEUTRAL_BUTTON}
                      >
                        <EditIcon className="size-3.5" />
                      </button>
                      <DeleteEquipmentButton equipmentId={item.id} equipmentName={item.name} />
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
