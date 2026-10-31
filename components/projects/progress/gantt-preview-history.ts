/** Local previews follow gesture order; the existing server FIFO remains the
 * authority. Snapshots share immutable estimate objects instead of deep copying
 * the schedule on every keystroke. A failed save invalidates unconfirmed history.
 */
export function createGanttPreviewHistory<T>(initial: T) {
  let current = initial;
  let undo: T[] = [];
  let redo: T[] = [];
  let complete = true;
  return {
    get current() { return current; },
    get canUndo() { return undo.length > 0; },
    get canRedo() { return redo.length > 0; },
    get complete() { return complete; },
    observe(value: T) { current = value; },
    edit(after?: T) {
      undo.push(current);
      // The database retains 101 checkpoints: one baseline plus 100 gestures.
      if (undo.length > 100) undo.shift();
      redo = [];
      if (after !== undefined) current = after;
    },
    move(direction: "undo" | "redo"): T | undefined {
      const from = direction === "undo" ? undo : redo;
      const to = direction === "undo" ? redo : undo;
      if (!from.length) return undefined;
      to.push(current);
      current = from.pop()!;
      return current;
    },
    reconcile(transform: (value: T) => T) {
      current = transform(current);
      undo = undo.map(transform);
      redo = redo.map(transform);
    },
    invalidate() { undo = []; redo = []; complete = false; },
  };
}
