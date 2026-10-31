import type { ScheduleDateChange } from "@/lib/cost-estimate/schedule-dates";

type SavedPosition = Pick<ScheduleDateChange, "kind" | "id"> & { start: string | null; end: string | null };
type Callbacks = {
  onBusy: (busy: boolean) => void;
  onRollback: (positions: SavedPosition[], message: string) => void;
  onIdle: () => void;
};

/** Keep rapid drags responsive while preserving database write order and rollback. */
export function createScheduleMoveQueue(
  save: (changes: ScheduleDateChange[]) => Promise<{ error?: string }>,
  schedule?: <T>(operation: () => Promise<T>) => Promise<T>,
) {
  let tail = Promise.resolve();
  let pending = 0;
  let generation = 0;
  let callbacks: Callbacks;
  const confirmed = new Map<string, SavedPosition>();
  return {
    enqueue(changes: ScheduleDateChange[], nextCallbacks: Callbacks) {
      if (changes.length === 0) return Promise.resolve();
      callbacks = nextCallbacks;
      const batch = generation;
      if (pending === 0) { confirmed.clear(); callbacks.onBusy(true); }
      for (const change of changes) {
        const key = `${change.kind}:${change.id}`;
        if (!confirmed.has(key)) confirmed.set(key, { kind: change.kind, id: change.id, start: change.previousStart, end: change.previousEnd });
      }
      pending++;
      const run = async () => {
        if (batch !== generation) return;
        try {
          const result = await save(changes);
          if (result.error) throw new Error(result.error);
          for (const change of changes) confirmed.set(`${change.kind}:${change.id}`, { kind: change.kind, id: change.id, start: change.start, end: change.end });
        } catch (error) {
          generation++;
          callbacks.onRollback([...confirmed.values()], error instanceof Error ? error.message : "Could not move the selected schedules.");
        }
      };
      const operation = (schedule ? schedule(run) : tail.then(run)).finally(() => {
        pending--;
        if (pending === 0) { confirmed.clear(); callbacks.onBusy(false); callbacks.onIdle(); }
      });
      // A failed callback must not leave future drag saves stuck behind a rejection.
      tail = operation.catch(() => {});
      return operation;
    },
  };
}
