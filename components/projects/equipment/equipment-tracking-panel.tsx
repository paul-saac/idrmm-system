"use client";

import { useEffect, useState, type MutableRefObject } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Search, X } from "lucide-react";
import { loadEquipmentTracking, saveEquipmentOperation, saveEquipmentPlans } from "@/lib/equipment/tracking-actions";
import { ModalFooter } from "@/components/ui/modal";
import { equipmentToday, type EquipmentOperation, type EquipmentTracking } from "@/lib/equipment/tracking-types";

const field = "w-full rounded border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200";
const button = "cursor-pointer rounded border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50";

const EMPTY_EQUIPMENT_TRACKING: EquipmentTracking = {
  equipment: [],
  plans: [],
  events: [],
};

export function EquipmentTrackingPanel({ projectId, itemKey, mode = "progress", destinations = [], readOnly = false, entryDate: _entryDate, initialData, saveRef, onChange, onClose, onPendingChange }: {
  projectId: number;
  itemKey?: string;
  mode?: "plan" | "progress";
  destinations?: { key: string; name: string }[];
  readOnly?: boolean;
  entryDate?: string;
  initialData?: EquipmentTracking | null;
  saveRef?: MutableRefObject<(() => Promise<{ error?: string }>) | null>;
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
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [search, setSearch] = useState("");
  const [draftIds, setDraftIds] = useState<number[] | null>(null);
  const [equipmentId, setEquipmentId] = useState("");
  const [action, setAction] = useState<EquipmentOperation["action"]>("used");
  const [destination, setDestination] = useState("");
  const [notes, setNotes] = useState("");
  // Retain the request ID on an uncertain network failure, preventing retries
  // from applying a physical movement twice.
  const [retry, setRetry] = useState<{ fingerprint: string; id: string } | null>(null);
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

  async function save(equipment: number, operation: EquipmentOperation["action"]): Promise<{ error?: string }> {
    if (!itemKey || pending) return {};
    const payload = { itemKey, equipmentId: equipment, action: operation, entryDate: equipmentToday(), destination, notes };
    const fingerprint = JSON.stringify(payload);
    const id = retry?.fingerprint === fingerprint ? retry.id : crypto.randomUUID();
    setRetry({ fingerprint, id });
    setPending(true); setError(undefined);
    try {
      const result = await saveEquipmentOperation(projectId, { ...payload, id });
      if (result.error) { setError(result.error); return { error: result.error }; }
      setRetry(null);
      const fresh = await loadEquipmentTracking(projectId);
      if (fresh.data) { setData(fresh.data); onChange?.(fresh.data); }
      else setError(fresh.error);
      setEquipmentId(""); setDestination(""); setNotes("");
      router.refresh();
      return {};
    } catch {
      const msg = "Could not confirm the save. Retry the same action safely.";
      setError(msg);
      return { error: msg };
    }
    finally { setPending(false); }
  }

  useEffect(() => {
    if (!saveRef) return;
    saveRef.current = async () => {
      if (!equipmentId) return {};
      if ((action === "return" || action === "transfer") && !destination) {
        const msg = "Select a destination for the equipment movement.";
        setError(msg);
        return { error: msg };
      }
      return save(Number(equipmentId), action);
    };
    return () => {
      saveRef.current = null;
    };
  });

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
      if (result.error) { setError(result.error); return; }
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
  const relevant = data?.equipment.filter((e) => action === "deploy"
    ? !e.currentItemKey && (plans.some((p) => p.equipmentId === e.id) || e.currentProjectId === projectId)
    : e.currentItemKey === itemKey) ?? [];

  if (mode === "progress" && (readOnly || !itemKey)) {
    return null;
  }

  return <section className="flex flex-col gap-4">
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {mode === "plan" && <>
      <p className="text-sm text-zinc-500">Select from the tools and equipment currently assigned to this project. Each asset tag represents one unit.</p>
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
      <div className="max-h-80 overflow-auto border border-zinc-200">
        {data.equipment.filter((e) => `${e.name} ${e.assetTag}`.toLowerCase().includes(search.toLowerCase())).map((e) => {
          const checked = selectedIds.includes(e.id);
          return <label key={e.id} className="flex items-center gap-3 border-b border-zinc-200 px-3 py-3 last:border-b-0 hover:bg-zinc-50">
            <span className="relative flex h-[14px] w-[14px] shrink-0 items-center justify-center">
              <input type="checkbox" checked={checked} disabled={pending || readOnly} onChange={() => togglePlan(e.id)}
                className="m-0 h-[14px] w-[14px] appearance-none rounded-[2px] border border-zinc-400 bg-white p-0 checked:border-zinc-700" />
              {checked && <span className="pointer-events-none absolute h-[6px] w-[6px] rounded-[1px] bg-zinc-700" />}
            </span>
            <span className="flex-1 text-sm">{e.name}<span className="ml-2 text-xs text-zinc-500">{e.assetTag}</span></span>
            <span className="text-xs text-zinc-500">{e.location}</span>
          </label>;
        })}
        {!data.equipment.length && <p className="p-3 text-sm text-zinc-500">No tools or equipment are assigned to this project.</p>}
      </div>
      {plans.filter((p) => !data.equipment.some((e) => e.id === p.equipmentId)).map((p) => <div key={p.equipmentId} className="flex items-center justify-between text-sm">
        <span>{p.name} ({p.assetTag}) — {selectedIds.includes(p.equipmentId) ? "unavailable" : "removal pending"}</span><button type="button" className={button} disabled={pending || readOnly} onClick={() => togglePlan(p.equipmentId)}>{selectedIds.includes(p.equipmentId) ? "Remove plan" : "Keep plan"}</button>
      </div>)}
    </>}
    {mode === "plan" && !readOnly && <ModalFooter>
      <div className="flex justify-end gap-3">
        <button type="button" className={button} disabled={pending} onClick={onClose}>Cancel</button>
        <button type="button" className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={pending} onClick={savePlans}>{pending ? "Saving…" : "Save"}</button>
      </div>
    </ModalFooter>}
    {mode === "progress" && itemKey && !readOnly && <>
        <p className="text-sm text-zinc-600">
          <span className="font-medium text-zinc-800">Currently on task:</span>{" "}
          {data.equipment
            .filter((e) => e.currentItemKey === itemKey)
            .map((e) => `${e.name} (${e.assetTag})`)
            .join(", ") || "None"}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-zinc-700">
            Action
            <div className="relative mt-1">
              <select
                className={`${field} cursor-pointer appearance-none pr-9`}
                value={action}
                disabled={pending}
                onChange={(e) => {
                  setAction(e.target.value as EquipmentOperation["action"]);
                  setEquipmentId("");
                  setDestination("");
                }}
              >
                <option value="used">Used / remained on task</option>
                <option value="deploy">Deploy to this task</option>
                <option value="transfer">Transfer to another task</option>
                <option value="return">Return</option>
              </select>
              <ChevronDown
                aria-hidden
                className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
              />
            </div>
          </label>
          <label className="text-sm font-medium text-zinc-700">
            Equipment
            <div className="relative mt-1">
              <select
                className={`${field} cursor-pointer appearance-none pr-9`}
                value={equipmentId}
                disabled={pending}
                onChange={(e) => setEquipmentId(e.target.value)}
              >
                <option value="">Select equipment</option>
                {relevant.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} — {e.assetTag}
                  </option>
                ))}
              </select>
              <ChevronDown
                aria-hidden
                className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
              />
            </div>
          </label>
          {(action === "transfer" || action === "return") && (
            <label className="text-sm font-medium text-zinc-700 sm:col-span-2">
              Destination
              <div className="relative mt-1">
                <select
                  className={`${field} cursor-pointer appearance-none pr-9`}
                  value={destination}
                  disabled={pending}
                  onChange={(e) => setDestination(e.target.value)}
                >
                  <option value="">Select destination</option>
                  {action === "return" ? (
                    <>
                      <option value="storage">Inventory / company storage</option>
                      <option value="supplier">Rental supplier (retire inventory item)</option>
                    </>
                  ) : (
                    destinations
                      .filter((d) => d.key !== itemKey)
                      .map((d) => (
                        <option key={d.key} value={d.key}>
                          {d.name}
                        </option>
                      ))
                  )}
                </select>
                <ChevronDown
                  aria-hidden
                  className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
                />
              </div>
            </label>
          )}
          <label className="text-sm font-medium text-zinc-700 sm:col-span-2">
            Notes / correction reason
            <textarea
              maxLength={2000}
              className={`${field} mt-1`}
              value={notes}
              disabled={pending}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </label>
        </div>
    </>}
  </section>;
}
