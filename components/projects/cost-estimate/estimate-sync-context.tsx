"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { CostCategory, CostEstimate } from "@/lib/cost-estimate/data";
import { applyEstimateChanges, liveCostEstimate, unconfirmedEstimateChanges, type EstimateChange, type EstimateRowPatch, type SavedEstimateProgress } from "@/lib/cost-estimate/live-estimate";

type EstimateSync = {
  estimate: CostEstimate;
  changes: EstimateChange[];
  begin: (patches: EstimateRowPatch[]) => number;
  complete: (token: number) => void;
  rollback: (token: number) => void;
  publishGantt: (base: CostCategory[], next: CostCategory[]) => void;
};
const Context = createContext<EstimateSync | null>(null);
export const useEstimateSync = () => useContext(Context);

/** One project-scoped live estimate. Gantt publishes its local edits while it
 * reads only cost edits back, avoiding a self-referencing refresh loop. */
export function EstimateSyncProvider({ estimate: serverEstimate, progress, children }: { estimate: CostEstimate; progress: SavedEstimateProgress; children: ReactNode }) {
  const [changes, setChanges] = useState<EstimateChange[]>([]);
  const sequence = useRef(0);
  const [gantt, setGantt] = useState<{ base: CostCategory[]; next: CostCategory[] } | null>(null);
  const active = useMemo(() => unconfirmedEstimateChanges(serverEstimate.categories, changes), [serverEstimate.categories, changes]);
  if (active !== changes) setChanges(active);
  const begin = useCallback((patches: EstimateRowPatch[]) => {
    const token = ++sequence.current;
    setChanges(previous => [...previous, { token, patches, pending: true }]);
    return token;
  }, []);
  const complete = useCallback((token: number) => setChanges(previous => previous.map(change => change.token === token ? { ...change, pending: false } : change)), []);
  const rollback = useCallback((token: number) => setChanges(previous => previous.filter(change => change.token !== token)), []);
  const publishGantt = useCallback((base: CostCategory[], next: CostCategory[]) => {
    setGantt(previous => previous?.base === base && previous.next === next ? previous : { base, next });
  }, []);
  const estimate = useMemo(() => liveCostEstimate(serverEstimate, applyEstimateChanges(
    gantt?.base === serverEstimate.categories ? gantt.next : serverEstimate.categories, active
  ), progress), [serverEstimate, gantt, active, progress]);
  const value = useMemo(() => ({ estimate, changes: active, begin, complete, rollback, publishGantt }), [estimate, active, begin, complete, rollback, publishGantt]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
