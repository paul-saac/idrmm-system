"use client";

import { useActionState } from "react";
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Pencil,
  Send,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  deleteEquipment,
  returnEquipment,
  type EquipmentActionState,
} from "@/lib/equipment/actions";
import type { EquipmentRow } from "@/lib/equipment/data";

export type SortKey = "name" | "status" | "lastActivity";
export type SortDir = "asc" | "desc";

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
  if (equipment.status === "assigned") {
    return (
      <span className="rounded-sm bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
        Assigned
      </span>
    );
  }
  if (equipment.status === "maintenance") {
    return (
      <span className="rounded-sm bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
        Maintenance
      </span>
    );
  }
  if (equipment.status === "retired") {
    return (
      <span className="rounded-sm bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500">
        Retired
      </span>
    );
  }
  // "available" reads as "Returned" once it has assignment history — the
  // same green end-state as a fresh, never-assigned item, just a more
  // informative label.
  return (
    <span className="rounded-sm bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
      {equipment.lastReturnedAt ? "Returned" : "Available"}
    </span>
  );
}

function SortableHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = sortKey === activeKey;
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ChevronUp : ChevronDown;

  return (
    <th className="px-4 py-2.5 font-medium">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`flex cursor-pointer items-center gap-1 transition-colors hover:text-zinc-900 ${
          active ? "text-zinc-900" : ""
        }`}
      >
        {label}
        <Icon className="size-3.5" />
      </button>
    </th>
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
  const [state, formAction, pending] = useActionState(
    boundAction,
    deleteInitialState
  );

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
          aria-label="Delete equipment"
          className="cursor-pointer rounded p-1.5 text-zinc-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Trash2 className="size-3.5" />
        </button>
      </form>
      {state?.error && (
        <span
          role="alert"
          className="absolute top-full right-0 z-10 mt-1 w-48 rounded-md border border-red-200 bg-white px-2 py-1 text-right text-xs font-normal text-red-600 shadow-sm"
        >
          {state.error}
        </span>
      )}
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
  const [state, formAction, pending] = useActionState(
    boundAction,
    returnInitialState
  );

  return (
    <span className="relative inline-flex">
      <form action={formAction}>
        <button
          type="submit"
          disabled={pending}
          aria-label="Return equipment"
          title="Mark as returned"
          className="cursor-pointer rounded p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Undo2 className="size-3.5" />
        </button>
      </form>
      {state?.error && (
        <span
          role="alert"
          className="absolute top-full right-0 z-10 mt-1 w-48 rounded-md border border-red-200 bg-white px-2 py-1 text-right text-xs font-normal text-red-600 shadow-sm"
        >
          {state.error}
        </span>
      )}
    </span>
  );
}

export function EquipmentTable({
  equipment,
  sortKey,
  sortDir,
  onSort,
  onEdit,
  onAssign,
}: {
  equipment: EquipmentRow[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  onEdit: (equipment: EquipmentRow) => void;
  onAssign: (equipment: EquipmentRow) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-zinc-900">Available Tools</h3>
      </div>

      {equipment.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-400">
          No equipment recorded yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
              <tr>
                <th className="px-4 py-2.5">Asset Tag</th>
                <SortableHeader
                  label="Name"
                  sortKey="name"
                  activeKey={sortKey}
                  dir={sortDir}
                  onSort={onSort}
                />
                <th className="px-4 py-2.5">Category</th>
                <th className="px-4 py-2.5">Description</th>
                <SortableHeader
                  label="Status"
                  sortKey="status"
                  activeKey={sortKey}
                  dir={sortDir}
                  onSort={onSort}
                />
                <th className="px-4 py-2.5">Assigned Project</th>
                <SortableHeader
                  label="Last Activity"
                  sortKey="lastActivity"
                  activeKey={sortKey}
                  dir={sortDir}
                  onSort={onSort}
                />
                <th className="px-4 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {equipment.map((item) => {
                const lastActivity = item.lastAssignedAt ?? item.lastReturnedAt;
                return (
                  <tr key={item.id} className="transition-colors hover:bg-zinc-50">
                    <td className="px-4 py-2.5 font-medium text-zinc-900">
                      {item.assetTag}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-800">{item.name}</td>
                    <td className="px-4 py-2.5 text-zinc-600">
                      {item.category || "—"}
                    </td>
                    <td className="max-w-64 truncate px-4 py-2.5 text-zinc-600" title={item.description ?? undefined}>
                      {item.description || "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge equipment={item} />
                    </td>
                    <td className="px-4 py-2.5 text-zinc-600">
                      {item.currentProjectName ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-500">
                      {lastActivity ? formatDateTime(lastActivity) : "—"}
                    </td>
                    <td className="px-4 py-2.5">
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
                            aria-label="Assign equipment"
                            title="Assign to a project"
                            className="cursor-pointer rounded p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
                          >
                            <Send className="size-3.5" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => onEdit(item)}
                          aria-label="Edit equipment"
                          className="cursor-pointer rounded p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <DeleteEquipmentButton
                          equipmentId={item.id}
                          equipmentName={item.name}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
