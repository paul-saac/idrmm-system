"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Plus, Search } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { EquipmentForm } from "@/components/inventory/equipment-form";
import { AssignEquipmentForm } from "@/components/inventory/assign-equipment-form";
import {
  EquipmentTable,
  type SortDir,
  type SortKey,
} from "@/components/inventory/equipment-table";
import type { EquipmentRow, EquipmentStatus } from "@/lib/equipment/data";

const STATUS_FILTERS: { value: EquipmentStatus | "all"; label: string }[] = [
  { value: "all", label: "Status" },
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
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<EquipmentStatus | "all">(
    "all"
  );
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [formModal, setFormModal] = useState<
    { mode: "add" } | { mode: "edit"; equipment: EquipmentRow } | null
  >(null);
  const [assignTarget, setAssignTarget] = useState<EquipmentRow | null>(null);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = equipment.filter((item) => {
      const matchesStatus = statusFilter === "all" || item.status === statusFilter;
      const matchesQuery =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.assetTag.toLowerCase().includes(q) ||
        (item.category ?? "").toLowerCase().includes(q) ||
        (item.serialNumber ?? "").toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });

    const sorted = [...rows].sort((a, b) => {
      let comparison = 0;
      if (sortKey === "name") {
        comparison = a.name.localeCompare(b.name);
      } else if (sortKey === "status") {
        comparison = a.status.localeCompare(b.status);
      } else {
        const aTime = a.lastAssignedAt ?? a.lastReturnedAt ?? a.createdAt;
        const bTime = b.lastAssignedAt ?? b.lastReturnedAt ?? b.createdAt;
        comparison = new Date(aTime).getTime() - new Date(bTime).getTime();
      }
      return sortDir === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [equipment, query, statusFilter, sortKey, sortDir]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-55 max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search User by item name, status..."
            className="w-full rounded-md border border-zinc-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        </div>

        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as EquipmentStatus | "all")
            }
            className="cursor-pointer appearance-none rounded-md border border-zinc-200 bg-white py-2 pl-3 pr-8 text-sm font-medium text-zinc-700 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          >
            {STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
        </div>

        <button
          type="button"
          onClick={() => setFormModal({ mode: "add" })}
          className="ml-auto flex cursor-pointer items-center gap-1.5 rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-zinc-900 hover:bg-zinc-900 hover:text-white hover:shadow-md active:translate-y-0"
        >
          <Plus className="size-4" />
          Add Equipment
        </button>
      </div>

      <p className="text-sm text-zinc-500">
        Showing {filtered.length} of {equipment.length} item
        {equipment.length === 1 ? "" : "s"}
      </p>

      <EquipmentTable
        equipment={filtered}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
        onEdit={(item) => setFormModal({ mode: "edit", equipment: item })}
        onAssign={(item) => setAssignTarget(item)}
      />

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
    </div>
  );
}
