// The Material and Labor Breakdown tables' shared look — the Expenses
// tab's ledger tables (expense-table-shared.tsx): zinc-200 column and row
// lines; every row h-9 and every cell text-xs font-medium — the header's
// own height (py-2.5 + text-xs) and type — so the body lines up with it;
// main tasks a gray band, their subtasks hanging off a light tree line
// behind a dark left accent. `group` on every row is what a row's own
// hover-only buttons key off.

export const DIVIDER = "border-r border-zinc-200";
export const GROUP_ROW = "group border-y border-zinc-200 transition-colors";
export const MAIN_TASK_ROW = `${GROUP_ROW} bg-zinc-100`;
/** A subtask's own name cell, right after its tree cell. */
export const SUBTASK_NAME_CELL = `${DIVIDER} border-l-3 border-l-zinc-900 px-4`;

/** A fixed bar at the panel's bottom edge — sticky against the Modal's
 * own scrolling body, so the table scrolls under it and Save/Cancel never
 * need a scroll to reach. -bottom-5/-mb-5/-mx-6 undo that body's
 * py-5/px-6, so the bar sits flush with the panel's edges; mt-auto keeps
 * it at the bottom when the table is short (its content wrapper being
 * flex min-h-full flex-col). */
export const STICKY_FOOTER =
  "sticky -bottom-5 z-10 -mx-6 mt-auto -mb-5 flex flex-col gap-3 border-t border-zinc-200 bg-white px-6 py-4";

/** A group row's own label — just its name; every row always shows, so
 * there's nothing to fold. */
export function GroupLabel({ label }: { label: string }) {
  return (
    <span className="block min-w-0 truncate text-xs font-medium text-zinc-700">
      {label}
    </span>
  );
}

// White over its row's own fill, so a tinted row (a material's) starts at
// its accent line rather than under the tree.
export const TREE_CELL =
  "relative bg-white [border-top-style:hidden] [border-bottom-style:hidden]";

/** The light tree line a main task's subtasks hang from, in line with
 * the main task's own name (left-4): down through every subtask's row and
 * whatever sits under it, a branch up to each subtask's own line (right-0:
 * no further than its own cell, so never over that line), stopping
 * halfway down the last subtask's own row. Its cells (TREE_CELL) hide
 * their own row lines — a hidden border wins over every other one at
 * that edge in a collapsed table — so nothing crosses it, and
 * -top-px/-bottom-px close any hairline gap between rows. */
export function TreeLine({ branch = false, end = false }: { branch?: boolean; end?: boolean }) {
  return (
    <>
      <span
        aria-hidden
        className={`absolute -top-px left-4 w-px bg-zinc-300 ${end ? "bottom-1/2" : "-bottom-px"}`}
      />
      {branch && (
        <span aria-hidden className="absolute top-1/2 right-0 left-4 h-px bg-zinc-300" />
      )}
    </>
  );
}
