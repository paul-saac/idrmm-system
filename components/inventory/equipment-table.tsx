"use client";

import { useActionState, useState } from "react";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { SelectAllCell, SelectCell, BLANK } from "@/components/ui/list-table";
import {
  deleteEquipment,
  type EquipmentActionState,
} from "@/lib/equipment/actions";
import type { EquipmentRow } from "@/lib/equipment/data";
import { equipmentUseStatus } from "@/lib/equipment/usage-status";
import { EquipmentUsageBadge } from "@/components/inventory/equipment-usage-badge";

const TH = "px-4 py-3 font-medium";
const TD = "px-4 py-3.5";

/** Show current unfinished work, or the next planned allocation when idle. */
function currentAssignments(equipment: EquipmentRow) {
  if (equipment.status === "maintenance") return [];
  const assignments = equipment.taskAssignments ?? [];
  const ongoing = assignments.filter(task => task.useStatus === "ongoing");
  if (ongoing.length) return ongoing;
  return assignments.filter(task => task.useStatus === "upcoming" || task.useStatus === "planned")
    .sort((a, b) => (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999"))
    .slice(0, 1);
}

function StatusBadge({ equipment }: { equipment: EquipmentRow }) {
  return <EquipmentUsageBadge status={equipmentUseStatus(equipment)} />;
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

/**
 * Tools and equipment record table — styled cleanly to match the members table:
 * standard rounded-lg container, rounded-sm badges, plain text asset tags, and comfortable row heights.
 */
export function EquipmentTable({
  equipment,
  selected,
  onCheck,
  onEdit,
  onDelete,
  readOnly = false,
}: {
  equipment: EquipmentRow[];
  /** Checked item ids. */
  selected: ReadonlySet<number>;
  onCheck: (ids: number[], checked: boolean) => void;
  onEdit: (equipment: EquipmentRow) => void;
  onDelete?: (equipment: EquipmentRow) => void;
  basePath?: string;
  readOnly?: boolean;
}) {
  const [ascending, setAscending] = useState(true);
  const sortedEquipment = [...equipment].sort((a, b) => (ascending ? 1 : -1) * a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const ids = equipment.map((item) => item.id);
  const checkedCount = ids.filter((id) => selected.has(id)).length;
  const allChecked = ids.length > 0 && checkedCount === ids.length;

  return (
    <div className="min-w-0 rounded-lg border border-zinc-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-5xl table-fixed text-left text-[13px] text-zinc-600">
          <colgroup>
            {!readOnly && <col className="w-[3%]" />}
            <col className="w-[7%]" />
            <col className="w-[18%]" />
            <col className="w-[10%]" />
            <col className="w-[16%]" />
            <col className="w-[10%]" />
            <col />
            {!readOnly && <col className="w-[80px]" />}
          </colgroup>
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
              <th className={TH} aria-sort={ascending ? "ascending" : "descending"}>
                <button type="button" onClick={() => setAscending(value => !value)} className="flex cursor-pointer items-center gap-1 font-medium transition hover:text-zinc-900">
                  Name<ChevronDown aria-label={ascending ? "A to Z" : "Z to A"} className={`size-3.5 ${ascending ? "" : "rotate-180"}`} />
                </button>
              </th>
              <th className={TH}>Category</th>
              <th className={TH}>Description</th>
              <th className={TH}>Status</th>
              <th className={TH}>Assignment status</th>
              {!readOnly && (
                <th className={`${TH} text-right`}>
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {sortedEquipment.map((item) => {
              const assignments = currentAssignments(item);
              const checked = selected.has(item.id);
              return (
                <tr
                  key={item.id}
                  tabIndex={0}
                  aria-label={`View ${item.name}`}
                  onClick={() => onEdit(item)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEdit(item); }
                  }}
                  className={`cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 transition-colors ${
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
                    className={`${TD} truncate text-zinc-500`}
                    title={item.description ?? undefined}
                  >
                    {item.description || BLANK}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <StatusBadge equipment={item} />
                  </td>
                  <td className={`${TD} text-zinc-600`}>
                    {assignments.length ? <div className="space-y-2">
                      {assignments.map(task => <div key={`${task.projectId}-${task.itemKey}`} className="flex items-center gap-2">
                        <span className="min-w-0 truncate" title={`${task.projectName} > ${task.taskName}`}>{task.projectName}<ChevronRight aria-hidden="true" className="mx-1 inline-block size-3 align-middle text-zinc-400" />{" "}{task.taskName}</span>
                        <span className="shrink-0"><EquipmentUsageBadge status={task.useStatus} /></span>
                      </div>)}
                    </div> : item.assignmentLoadError ? "Status unavailable" : BLANK}
                  </td>
                  {!readOnly && (
                    <td className={`${TD} text-right whitespace-nowrap`} onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {onDelete ? (
                          <button
                            type="button"
                            onClick={() => onDelete(item)}
                            title="Delete equipment"
                            aria-label={`Delete ${item.name}`}
                            className="cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        ) : (
                          <DeleteEquipmentButton
                            equipmentId={item.id}
                            equipmentName={item.name}
                          />
                        )}
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
