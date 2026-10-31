/** One FIFO for a chart's edits and history commands, independent of network speed.
 * Enqueue at the gesture boundary; never merge separate gestures by elapsed time.
 */
export function createGanttOperationQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;
  return {
    get pending() { return pending; },
    run<T>(operation: () => Promise<T>): Promise<T> {
      pending++;
      const result = tail.then(operation).finally(() => { pending--; });
      // A failed command never poisons later unrelated edits/history commands.
      tail = result.catch(() => {});
      return result;
    },
  };
}
