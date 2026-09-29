"use client";

import { useActionState, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, ListFilter, Plus, Search, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { MaterialForm } from "@/components/projects/materials/material-form";
import {
  deleteProjectMaterial,
  type MaterialActionState,
} from "@/lib/materials/actions";
import type {
  MaterialBreakdownEntry,
  MaterialStatus,
  ProjectMaterial,
} from "@/lib/materials/data";

const STATUS_FILTERS: { value: MaterialStatus | "all"; label: string }[] = [
  { value: "all", label: "All Statuses" },
  { value: "available", label: "Available" },
  { value: "low_stock", label: "Low Stock" },
  { value: "fully_consumed", label: "Fully Consumed" },
];

function StatusBadge({ status }: { status: MaterialStatus }) {
  if (status === "available") {
    return (
      <span className="rounded-sm bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        Available
      </span>
    );
  }
  if (status === "low_stock") {
    return (
      <span className="rounded-sm bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
        Low Stock
      </span>
    );
  }
  return (
    <span className="rounded-sm bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
      Fully Consumed
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "2-digit",
    year: "numeric",
  });
}

type CombinedRow =
  | { kind: "stock"; material: ProjectMaterial }
  | { kind: "breakdown"; entry: MaterialBreakdownEntry };

const deleteInitialState: MaterialActionState = {};

function DeleteMaterialButton({
  materialId,
  projectId,
  materialName,
}: {
  materialId: number;
  projectId: number;
  materialName: string;
}) {
  const boundAction = deleteProjectMaterial.bind(null, materialId, projectId);
  const [state, formAction, pending] = useActionState(
    boundAction,
    deleteInitialState
  );

  return (
    <span className="relative inline-flex">
      <form
        action={formAction}
        onSubmit={(e) => {
          if (!window.confirm(`Delete "${materialName}"? This cannot be undone.`)) {
            e.preventDefault();
          }
        }}
      >
        <button
          type="submit"
          disabled={pending}
          aria-label="Delete material"
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

export function MaterialsMonitoringView({
  projectId,
  materials,
  materialBreakdownEntries,
  toolbarSlot,
}: {
  projectId: number;
  materials: ProjectMaterial[];
  /** Read-only reflection of the Cost Estimate Breakdown's own Material
   * Breakdown modal — see listMaterialBreakdownEntries's own doc
   * comment. A separate *data* source from `materials` above (real
   * project_materials stock vs. a free-text cost-planning line, still
   * not linked to each other), but shown together in the same Material
   * Record Table below (see CombinedRow) rather than a separate table,
   * per an explicit request. */
  materialBreakdownEntries: MaterialBreakdownEntry[];
  /** DOM node (rendered by the parent's sub-tabs row) this view's own
   * "Add Material" button portals into — see SubTabsRow in
   * project-detail-view.tsx. */
  toolbarSlot: HTMLDivElement | null;
}) {
  const [statusFilter, setStatusFilter] = useState<MaterialStatus | "all">(
    "all"
  );
  const [query, setQuery] = useState("");
  const [formModal, setFormModal] = useState<
    { mode: "add" } | { mode: "edit"; material: ProjectMaterial } | null
  >(null);

  // One shared list, one shared table — see MaterialsMonitoringView's own
  // doc comment on materialBreakdownEntries for why these two stay
  // separate *data* sources even while sharing this one *view*. Stock
  // rows first (already sorted newest-updated-first), breakdown rows
  // appended after.
  const combinedRows = useMemo<CombinedRow[]>(
    () => [
      ...materials.map((material): CombinedRow => ({ kind: "stock", material })),
      ...materialBreakdownEntries.map(
        (entry): CombinedRow => ({ kind: "breakdown", entry })
      ),
    ],
    [materials, materialBreakdownEntries]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return combinedRows.filter((row) => {
      // Status is a stock-only concept (available/low-stock/fully-
      // consumed) — a breakdown row has no such state, so it only shows
      // while every status is included, not a specific one.
      const matchesStatus =
        statusFilter === "all" ||
        (row.kind === "stock" && row.material.status === statusFilter);
      if (!matchesStatus) return false;
      if (!q) return true;
      if (row.kind === "stock") {
        return (
          row.material.materialName.toLowerCase().includes(q) ||
          row.material.materialCode.toLowerCase().includes(q) ||
          (row.material.specification ?? "").toLowerCase().includes(q)
        );
      }
      return (
        row.entry.materialName.toLowerCase().includes(q) ||
        (row.entry.specification ?? "").toLowerCase().includes(q) ||
        row.entry.taskName.toLowerCase().includes(q) ||
        row.entry.categoryName.toLowerCase().includes(q)
      );
    });
  }, [combinedRows, statusFilter, query]);

  return (
    <div className="flex flex-col gap-4">
      {toolbarSlot &&
        createPortal(
          <button
            type="button"
            onClick={() => setFormModal({ mode: "add" })}
            className="flex cursor-pointer items-center gap-1.5 rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800"
          >
            <Plus className="size-4" />
            Add Material
          </button>,
          toolbarSlot
        )}

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-zinc-900">
            Material Record Table
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-2 text-zinc-600">
              <ListFilter className="size-4 flex-shrink-0 text-zinc-400" />
              <select
                aria-label="Filter by status"
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as MaterialStatus | "all")
                }
                className="cursor-pointer bg-transparent text-sm text-zinc-700 outline-none"
              >
                {STATUS_FILTERS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="relative min-w-[300px] flex-1">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search Material Name, Id, Specification..."
                className="w-full rounded-md border border-zinc-200 py-2 pl-3 pr-9 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
              />
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-zinc-400">
            {combinedRows.length === 0
              ? "No materials recorded yet."
              : "No materials match your filters."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
                <tr>
                  <th className="px-4 py-2.5">Material Name</th>
                  <th className="px-4 py-2.5">Specification / Size</th>
                  <th className="px-4 py-2.5">Quantity</th>
                  <th className="px-4 py-2.5">Unit</th>
                  <th className="px-4 py-2.5">Material Status</th>
                  <th className="px-4 py-2.5">Last Updated</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filtered.map((row) =>
                  row.kind === "stock" ? (
                    <tr
                      key={`stock-${row.material.id}`}
                      className="transition-colors hover:bg-zinc-50"
                    >
                      <td className="px-4 py-2.5 font-medium text-zinc-900">
                        {row.material.materialName}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-600">
                        {row.material.specification || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-600">
                        {String(row.material.quantity).padStart(2, "0")}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-600">
                        {row.material.unit || "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge status={row.material.status} />
                      </td>
                      <td className="px-4 py-2.5 text-zinc-600">
                        {formatDate(row.material.lastUpdated)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              setFormModal({ mode: "edit", material: row.material })
                            }
                            aria-label="View material"
                            className="cursor-pointer rounded p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
                          >
                            <Eye className="size-3.5" />
                          </button>
                          <DeleteMaterialButton
                            materialId={row.material.id}
                            projectId={projectId}
                            materialName={row.material.materialName}
                          />
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr
                      key={`breakdown-${row.entry.id}`}
                      className="transition-colors hover:bg-zinc-50"
                    >
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-zinc-900">
                          {row.entry.materialName}
                        </span>
                        {/* No dedicated Category/Task columns — this
                            table is shared with real stock rows, which
                            have neither. Kept as a small subtitle instead
                            so the Material Breakdown context isn't lost
                            entirely. */}
                        <p className="text-xs text-zinc-400">
                          {row.entry.categoryName} → {row.entry.taskName}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 text-zinc-600">
                        {row.entry.specification || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-600">
                        {String(row.entry.plannedQuantity).padStart(2, "0")}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-600">
                        {row.entry.unit || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-400">—</td>
                      <td className="px-4 py-2.5 text-zinc-400">—</td>
                      <td className="px-4 py-2.5 text-right text-zinc-400">—</td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={formModal !== null}
        onClose={() => setFormModal(null)}
        title={formModal?.mode === "edit" ? "Edit Material" : "Add Material"}
      >
        <MaterialForm
          // Modal always keeps its children mounted (it only toggles the
          // native <dialog>'s open state), so without a key tied to the
          // record being edited, MaterialForm would never remount and
          // its Unit dropdown — a controlled input via useState, unlike
          // the other fields' plain defaultValue — would stay stuck on
          // whatever material (or none) was selected when it first
          // mounted instead of updating per edit target.
          key={formModal?.mode === "edit" ? formModal.material.id : "add"}
          projectId={projectId}
          material={formModal?.mode === "edit" ? formModal.material : undefined}
          onSuccess={() => setFormModal(null)}
        />
      </Modal>
    </div>
  );
}
