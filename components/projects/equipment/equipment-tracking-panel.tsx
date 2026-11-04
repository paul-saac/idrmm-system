"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { loadEquipmentTracking, saveEquipmentPlans } from "@/lib/equipment/tracking-actions";
import { ModalFooter } from "@/components/ui/modal";
import { EquipmentConflictDialog } from "@/components/inventory/equipment-conflict-dialog";
import type { EquipmentConflict, EquipmentTracking } from "@/lib/equipment/tracking-types";

const button = "cursor-pointer rounded border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50";

const EMPTY_EQUIPMENT_TRACKING: EquipmentTracking = {
  equipment: [],
  plans: [],
};

export function EquipmentTrackingPanel({ projectId, itemKey, readOnly = false, initialData, onChange, onClose, onPendingChange }: {
  projectId: number;
  itemKey: string;
  readOnly?: boolean;
  initialData?: EquipmentTracking | null;
  onChange?: (data: EquipmentTracking) => void;
  onClose?: () => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<EquipmentTracking>(() => initialData ?? EMPTY_EQUIPMENT_TRACKING);
  const [prevInitialData, setPrevInitialData] = useState(initialData);
  if (initialData !== prevInitialData) {
    setPrevInitialData(initialData);
    if (initialData) setData(initialData);
  }
  const [conflict, setConflict] = useState<EquipmentConflict | null>(null);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [search, setSearch] = useState("");
  const [draftIds, setDraftIds] = useState<number[] | null>(null);
  useEffect(() => {
    if (initialData) return;
    let active = true;
    loadEquipmentTracking(projectId).then((result) => {
      if (active) {
        if (result.data) setData(result.data);
        setError(result.error);
      }
    }).catch(() => { if (active) setError("Could not load equipment. Reopen this panel to retry."); });
    return () => { active = false; };
  }, [projectId, initialData]);

  const plans = data?.plans.filter((p) => p.itemKey === itemKey) ?? [];
  const selectedIds = draftIds ?? plans.map((p) => p.equipmentId);
  function togglePlan(id: number) {
    setDraftIds(selectedIds.includes(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id]);
  }
  async function savePlans() {
    if (!data || !itemKey || pending) return;
    setPending(true); onPendingChange?.(true); setError(undefined);
    try {
      const result = await saveEquipmentPlans(projectId, itemKey, selectedIds, plans.map((p) => p.equipmentId));
      if (result.error) { setError(result.conflict ? undefined : result.error); setConflict(result.conflict ?? null); return; }
      const next: EquipmentTracking = { ...data, plans: [
        ...data.plans.filter((p) => p.itemKey !== itemKey),
        ...selectedIds.map((id) => {
          const asset = data.equipment.find((e) => e.id === id) ?? plans.find((p) => p.equipmentId === id)!;
          return { itemKey, equipmentId: id, name: asset.name, assetTag: asset.assetTag };
        }),
      ] };
      setData(next); setDraftIds(null); onChange?.(next);
      router.refresh(); onClose?.();
    } catch { setError("Could not confirm the save. Your selections are still here; retry safely."); }
    finally { setPending(false); onPendingChange?.(false); }
  }
  return <section className="flex flex-col gap-4">
    <EquipmentConflictDialog conflict={conflict} onClose={() => setConflict(null)} />
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <p className="text-sm text-zinc-500">Assign company tools and equipment to this task. Overlapping assignments cannot be saved.</p>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
        />
        <input
          type="text"
          aria-label="Search equipment"
          placeholder="Search name or asset tag"
          className="w-full rounded-md border border-zinc-200 bg-white py-2 pl-9 pr-8 text-sm text-zinc-700 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            title="Clear search"
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <div className="border border-zinc-200">
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <colgroup><col className="w-[52%]" /><col /></colgroup>
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
            <tr><th scope="col" className="px-3 py-2 font-medium">Equipment name</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Status</th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {data.equipment.filter((e) => `${e.name} ${e.assetTag}`.toLowerCase().includes(search.toLowerCase())).map((e) => {
              const checked = selectedIds.includes(e.id);
              const unavailable = !["available", "assigned"].includes(e.status);
              const inputId = `equipment-plan-${projectId}-${itemKey}-${e.id}`;
              return <tr key={e.id} className={e.status === "maintenance" ? "bg-red-50" : "hover:bg-zinc-50"}>
                <td className="align-middle">
                  <label htmlFor={e.status === "maintenance" ? undefined : inputId} className={`flex items-center gap-3 px-3 py-3 ${e.status === "maintenance" ? "cursor-default" : "cursor-pointer"}`}>
                    <span className="relative flex h-[14px] w-[14px] shrink-0 items-center justify-center">
                      <input id={inputId} type="checkbox" aria-label={`Plan ${e.name} (${e.assetTag})`} checked={e.status !== "maintenance" && checked} disabled={e.status === "maintenance" || pending || readOnly || (unavailable && !plans.some(plan => plan.equipmentId === e.id))} onChange={() => togglePlan(e.id)}
                        className="m-0 h-[14px] w-[14px] appearance-none rounded-[2px] border border-zinc-400 bg-white p-0 checked:border-zinc-700" />
                      {e.status !== "maintenance" && checked && <span className="pointer-events-none absolute h-[6px] w-[6px] rounded-[1px] bg-zinc-700" />}
                    </span>
                    <span className={`min-w-0 break-words ${e.status === "maintenance" ? "text-zinc-400" : ""}`}>{e.name}<span className="ml-2 text-xs text-zinc-500">{e.assetTag}</span></span>
                  </label>
                </td>
                <td className={`align-middle text-right text-xs ${e.status === "maintenance" ? "text-red-700" : "text-zinc-500"}`}>
                  <label htmlFor={e.status === "maintenance" ? undefined : inputId} className={`block px-3 py-3 ${e.status === "maintenance" ? "cursor-default" : "cursor-pointer"}`}>
                    {{ available: "Available", assigned: "Assigned", maintenance: "Under Maintenance", retired: "Retired" }[e.status]}
                  </label>
                </td>
              </tr>;
            })}
            {!data.equipment.length && <tr><td colSpan={2}><EmptyState compact className="p-3 text-sm text-zinc-500">No tools or equipment are available for planning.</EmptyState></td></tr>}
          </tbody>
        </table>
      </div>
      {plans.filter((p) => !data.equipment.some((e) => e.id === p.equipmentId)).map((p) => <div key={p.equipmentId} className="flex items-center justify-between text-sm">
        <span>{p.name} ({p.assetTag}) — {selectedIds.includes(p.equipmentId) ? "unavailable" : "removal pending"}</span><button type="button" className={button} disabled={pending || readOnly} onClick={() => togglePlan(p.equipmentId)}>{selectedIds.includes(p.equipmentId) ? "Remove plan" : "Keep plan"}</button>
      </div>)}
    {!readOnly && <ModalFooter>
      <div className="flex justify-end gap-3">
        <button type="button" className={button} disabled={pending} onClick={onClose}>Cancel</button>
        <button type="button" className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={pending} onClick={savePlans}>{pending ? "Saving…" : "Save"}</button>
      </div>
    </ModalFooter>}
  </section>;
}
