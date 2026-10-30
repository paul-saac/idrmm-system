"use client";

import { EmptyState } from "@/components/ui/empty-state";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Trash2 } from "lucide-react";
import { FilterSelect } from "@/components/ui/filter-select";
import { Modal } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EquipmentForm } from "@/components/inventory/equipment-form";
import { AssignEquipmentForm } from "@/components/inventory/assign-equipment-form";
import { EquipmentTable } from "@/components/inventory/equipment-table";
import { usePortal } from "@/components/portal/portal-context";
import { deleteEquipmentItems } from "@/lib/equipment/actions";
import type { EquipmentRow, EquipmentStatus } from "@/lib/equipment/data";

const STATUS_FILTERS: { value: EquipmentStatus; label: string }[] = [
  { value: "available", label: "Available" },
  { value: "assigned", label: "Assigned" },
  { value: "maintenance", label: "Maintenance" },
  { value: "retired", label: "Retired" },
];

export function InventoryBrowser({
  equipment,
  projects,
}: {
  equipment: EquipmentRow[];
  projects: { id: number; name: string }[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<EquipmentStatus | "all">("all");
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: "single"; item: EquipmentRow }
    | { kind: "batch"; items: EquipmentRow[] }
    | null
  >(null);
  const [formModal, setFormModal] = useState<
    { mode: "add" } | { mode: "edit"; equipment: EquipmentRow } | null
  >(null);
  const [assignTarget, setAssignTarget] = useState<EquipmentRow | null>(null);
  const { basePath, isAdmin } = usePortal();

  // By name.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return equipment
      .filter((item) => {
        const matchesStatus = statusFilter === "all" || item.status === statusFilter;
        const matchesQuery =
          !q ||
          item.name.toLowerCase().includes(q) ||
          item.assetTag.toLowerCase().includes(q) ||
          (item.category ?? "").toLowerCase().includes(q) ||
          (item.serialNumber ?? "").toLowerCase().includes(q);
        return matchesStatus && matchesQuery;
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [equipment, query, statusFilter]);

  // Only what's on screen counts — a checked item the search or filter
  // hides isn't touched.
  const selectedItems = filtered.filter((item) => selected.has(item.id));

  function setChecked(ids: number[], checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function handleDeleteSelected() {
    setDeleteTarget({ kind: "batch", items: selectedItems });
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleteError(null);
    setDeleting(true);
    const ids =
      deleteTarget.kind === "single"
        ? [deleteTarget.item.id]
        : deleteTarget.items.map((item) => item.id);
    const result = await deleteEquipmentItems(ids);
    setDeleting(false);
    if (result.error) {
      setDeleteError(result.error);
      return;
    }
    if (deleteTarget.kind === "single") {
      if (formModal?.mode === "edit" && formModal.equipment.id === deleteTarget.item.id) {
        setFormModal(null);
      }
    } else {
      setSelected(new Set());
    }
    setDeleteTarget(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-55 max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, asset tag, category or serial"
            className="w-full rounded-md border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        </div>

        <FilterSelect
          label="Status"
          value={statusFilter}
          options={STATUS_FILTERS}
          onChange={setStatusFilter}
        />

        {isAdmin && (
          <div className="ml-auto flex items-center gap-3">
            {selectedItems.length > 0 && (
              <>
                <span className="text-sm font-medium text-zinc-900">
                  {selectedItems.length} selected
                </span>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="cursor-pointer text-sm font-medium text-zinc-500 transition hover:text-zinc-900"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={handleDeleteSelected}
                  disabled={deleting}
                  className="flex cursor-pointer items-center gap-1.5 rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-600 transition hover:border-red-600 hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 className="size-4" />
                  Delete
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setFormModal({ mode: "add" })}
              className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-zinc-800"
            >
              <Plus className="size-4" />
              Add Equipment
            </button>
          </div>
        )}
      </div>

      {deleteError && (
        <p role="alert" className="text-sm text-red-600">
          {deleteError}
        </p>
      )}

      {filtered.length === 0 ? (
        <EmptyState className="rounded-lg border border-zinc-200 bg-white py-12">
          {equipment.length === 0 ? "No equipment recorded yet." : "No equipment matches."}
        </EmptyState>
      ) : (
        <EquipmentTable
          equipment={filtered}
          selected={selected}
          onCheck={setChecked}
          onEdit={(item) => setFormModal({ mode: "edit", equipment: item })}
          onAssign={(item) => setAssignTarget(item)}
          onDelete={(item) => setDeleteTarget({ kind: "single", item })}
          basePath={basePath}
          readOnly={!isAdmin}
        />
      )}

      {isAdmin && (
        <>
          <Modal
            open={formModal !== null}
            onClose={() => setFormModal(null)}
            title={formModal?.mode === "edit" ? "Edit Equipment" : "Add Equipment"}
          >
            <EquipmentForm
              // See components/projects/materials/materials-monitoring-view.tsx
              // for why this needs a key — Modal keeps its children mounted
              // even while closed, so without one the form's Status field
              // would get stuck reflecting whichever item (or none) was
              // selected when it first mounted.
              key={formModal?.mode === "edit" ? formModal.equipment.id : "add"}
              equipment={formModal?.mode === "edit" ? formModal.equipment : undefined}
              onRequestDelete={
                formModal?.mode === "edit"
                  ? () => setDeleteTarget({ kind: "single", item: formModal.equipment })
                  : undefined
              }
              onSuccess={() => setFormModal(null)}
            />
          </Modal>

          <Modal
            open={assignTarget !== null}
            onClose={() => setAssignTarget(null)}
            title="Assign Equipment"
          >
            {assignTarget && (
              <AssignEquipmentForm
                key={assignTarget.id}
                equipment={assignTarget}
                projects={projects}
                onSuccess={() => setAssignTarget(null)}
              />
            )}
          </Modal>

          <ConfirmDialog
            open={deleteTarget !== null}
            title={
              deleteTarget?.kind === "single"
                ? `Delete "${deleteTarget.item.name}"?`
                : `Delete ${deleteTarget?.items.length ?? 0} item${(deleteTarget?.items.length ?? 0) === 1 ? "" : "s"}?`
            }
            message="This cannot be undone."
            pending={deleting}
            error={deleteError}
            onConfirm={handleConfirmDelete}
            onCancel={() => {
              if (deleting) return;
              setDeleteTarget(null);
              setDeleteError(null);
            }}
          />
        </>
      )}
    </div>
  );
}
