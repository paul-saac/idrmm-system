"use client";
import { createContext, useContext, useRef, useState, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { TaskProgressToday } from "@/lib/task-progress/data";
import type { OverrideLog, OverrideLogItem, ProjectOverrideHistory, SavedLogIdentity } from "@/lib/progress-logs/types";
import { projectProgressLog } from "@/lib/progress-logs/optimistic";

type State = { task: Record<number, TaskProgressToday>; category: Record<number, TaskProgressToday>; history: ProjectOverrideHistory };
type Change = { operationId: number; key: string; item: OverrideLogItem; source: OverrideLog[] | undefined; sourceHistory: ProjectOverrideHistory; sourceProgress: TaskProgressToday | undefined; date: string; deleting: boolean; progress: TaskProgressToday; history: OverrideLog[]; pending: boolean };
type SaveResult = { error?: string; success?: boolean; savedLog?: SavedLogIdentity };
type Sync = State & { pendingKeys: string[]; pendingDates: Record<string, string>; run: (item: OverrideLogItem, date: string, log: OverrideLog | null, action: () => Promise<SaveResult>) => false | {completion: Promise<SaveResult>} };
const Context = createContext<Sync | null>(null);
export const useProgressLogSync = () => useContext(Context);

export function ProgressLogSyncProvider({ task, category, history, children }: State & { children: ReactNode }) {
  const router = useRouter();
  const [changes, setChanges] = useState<Change[]>([]);
  const locks = useRef(new Set<string>());
  const sequence = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const active = useMemo(() => changes.filter(change => {
    if (change.pending) return true;
    const serverLogs = history[change.key] ?? [];
    if (change.deleting) return history === change.sourceHistory || serverLogs.some(log => log.entryDate === change.date);
    const savedLog = change.history.find(log => log.entryDate === change.date);
    const evidenceMatches = (log: OverrideLog) => (log.remarks ?? "") === (savedLog?.remarks ?? "") &&
      JSON.stringify((log.photos ?? []).map(photo => photo.path)) === JSON.stringify((savedLog?.photos ?? []).map(photo => photo.path));
    const serverProgress = (change.item.kind === "task" ? task : category)[change.item.id];
    if (serverLogs.some(log => log.entryDate === change.date && evidenceMatches(log)) && serverProgress && serverProgress !== change.sourceProgress &&
        serverProgress.cumulativeQuantityCompleted === change.progress.cumulativeQuantityCompleted &&
        JSON.stringify(serverProgress.cumulativeCosts) === JSON.stringify(change.progress.cumulativeCosts) &&
        serverProgress.loggedDates.join() === change.progress.loggedDates.join()) return false;
    const sourceIds = new Set((change.source ?? []).map(log => log.id));
    return !serverLogs.some(log => log.entryDate === change.date && !sourceIds.has(log.id) &&
      log.quantityCompleted === savedLog?.quantityCompleted && evidenceMatches(log));
  }), [changes, history, task, category]);
  if (active.length !== changes.length) {
    setChanges(active);
  }
  const visible = useMemo(() => {
    const value = { task: { ...task }, category: { ...category }, history: { ...history } };
    for (const change of active) { value[change.item.kind][change.item.id] = change.progress; value.history[change.key] = change.history; }
    return value;
  }, [task, category, history, active]);
  // Keep confirmed optimistic records visible during the route refresh, but
  // only the database request itself should keep the Save button busy.
  const value: Sync = { ...visible, pendingKeys:active.filter(change=>change.pending).map(change=>change.key), pendingDates:Object.fromEntries(active.filter(change=>change.pending).map(change=>[change.key,change.date])), run };
  function run(item: OverrideLogItem, date: string, log: OverrideLog | null, action: () => Promise<SaveResult>) {
    const key = `${item.kind}-${item.id}`;
    if (locks.current.has(key)) { setError("This task is still saving. Please wait before changing its log again."); return false; }
    locks.current.add(key);
    const operationId = ++sequence.current;
    setError(null);
    const next = projectProgressLog(value[item.kind][item.id], value.history[key] ?? [], date, log, new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }));
    setChanges(previous => [...previous, { operationId, key, item, date, deleting: log === null, source: history[key], sourceHistory: history, sourceProgress: (item.kind === "task" ? task : category)[item.id], ...next, pending: true }]);
    const completion = (async (): Promise<SaveResult> => {
      try {
        const result = await action();
        if (!result.success) throw new Error(result.error || "Could not save the progress change.");
        // The new projection includes earlier confirmed edits for this task.
        // Replace those overlays only after this operation succeeds.
        setChanges(previous => previous
          .filter(change => change.key !== key || change.operationId === operationId)
          .map(change => change.operationId === operationId ? { ...change, pending: false,
            history: result.savedLog ? change.history.map(row => row.id === log?.id ? { ...row, ...result.savedLog } : row) : change.history } : change));
        return result;
      } catch (failure) {
        setChanges(previous => previous.filter(change => change.operationId !== operationId));
        setError(`${failure instanceof Error ? failure.message : "Could not save the progress change."} The previous view has been restored. Reopen the task to review and retry.`);
        return {error:failure instanceof Error ? failure.message : "Could not save the progress change."};
      } finally {
        // Match the spinner and write guard to the same database request;
        // a background route refresh must not keep a saved log locked.
        locks.current.delete(key);
        router.refresh();
      }
    })();
    return {completion};
  }
  return <Context.Provider value={value}>
    {error && <p role="alert" className="border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-700">{error}</p>}
    {children}
  </Context.Provider>;
}
