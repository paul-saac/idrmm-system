import { Check, Minus } from "lucide-react";
import { initials } from "@/lib/initials";

/*
 * The app's list-table look — the Team page's, shared with Manage
 * Accounts: a gray header row, lines between every column and row, 13px
 * text, a checkbox column (a checked row goes gray with a black line down
 * its left edge) and icon-only row actions.
 */
export const TABLE_FRAME = "overflow-x-auto rounded-lg border border-zinc-200 bg-white";
export const TABLE = "w-full text-left text-[13px] text-zinc-600";
export const HEAD_ROW =
  "divide-x divide-zinc-200 border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500";
export const HEAD_CELL = "px-3 py-2.5 font-medium";
export const BODY = "divide-y divide-zinc-200";
export const CELL = "px-3 py-2";

/** A body row — gray while checked, a lighter gray on hover otherwise. */
export function rowClass(checked: boolean) {
  return `divide-x divide-zinc-200 transition-colors ${
    checked ? "bg-zinc-100" : "hover:bg-zinc-50"
  }`;
}

/** A row's own icon-only action, in the Gantt chart's edit button's
 * style (an icon at size-3.5, p-1); add its own hover colors. */
export const ICON_BUTTON =
  "shrink-0 cursor-pointer rounded p-1 text-zinc-400 transition disabled:cursor-not-allowed disabled:opacity-50";

/** An empty cell. */
export const BLANK = <span className="text-zinc-300">—</span>;

/** A light gray box, black with a white tick once checked (a dash when
 * only some of the rows are). */
export function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <span className="relative flex size-4 shrink-0">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={label}
        // `indeterminate` has no attribute, only the DOM property.
        ref={(node) => {
          if (node) node.indeterminate = indeterminate;
        }}
        className="peer size-4 cursor-pointer appearance-none rounded-sm border border-zinc-300 bg-zinc-100 transition checked:border-zinc-900 checked:bg-zinc-900 indeterminate:border-zinc-900 indeterminate:bg-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:outline-none"
      />
      <Check
        strokeWidth={3}
        className="pointer-events-none absolute inset-0 m-auto size-3 text-white opacity-0 peer-checked:opacity-100"
      />
      <Minus
        strokeWidth={3}
        className="pointer-events-none absolute inset-0 m-auto size-3 text-white opacity-0 peer-indeterminate:opacity-100"
      />
    </span>
  );
}

/** The header's checkbox, for every row in the table at once. */
export function SelectAllCell({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    // w-px: the column shrinks to the box and its even padding — a table
    // laid out by its content otherwise hands it spare width, leaving the
    // box off to the left.
    <th className="w-px p-0">
      <label className="flex h-9 cursor-pointer items-center justify-center px-3">
        <Checkbox
          checked={checked}
          indeterminate={indeterminate}
          onChange={onChange}
          label={label}
        />
      </label>
    </th>
  );
}

/** A row's own checkbox — the whole cell is its target, and a click there
 * stays out of the row's own (when it has one). Checked, the row gets
 * its black line down the left edge (a shadow — a border would widen
 * the column). */
export function SelectCell({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <td
      className={`w-px p-0 ${checked ? "shadow-[inset_2px_0_0_var(--color-zinc-900)]" : ""}`}
      onClick={(e) => e.stopPropagation()}
    >
      <label className="flex h-10 cursor-pointer items-center justify-center px-3">
        <Checkbox checked={checked} onChange={onChange} label={label} />
      </label>
    </td>
  );
}

/** A section's heading in a list of members (a group's window, the Gantt
 * chart's Assign picker) — its name in small capitals with a thin line
 * running on to the edge, pinned to the top while its section scrolls by. */
export function SectionLabel({ label }: { label: string }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 bg-white px-2 py-1.5">
      <span className="shrink-0 text-xs font-semibold tracking-wider text-zinc-600 uppercase">
        {label}
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-zinc-200" />
    </div>
  );
}

// A soft color per person for their initials (no photos), the same one
// every time for the same name.
const AVATAR_COLORS = [
  "bg-sky-100 text-sky-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-violet-100 text-violet-700",
  "bg-rose-100 text-rose-700",
  "bg-teal-100 text-teal-700",
];

function avatarColor(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** A person's initials in a small colored circle, beside their name —
 * `large` where each person gets more room (the Team's table). */
export function InitialsAvatar({ name, large = false }: { name: string; large?: boolean }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${
        large ? "size-8 text-xs" : "size-6 text-[10px]"
      } ${avatarColor(name)}`}
    >
      {initials(name)}
    </span>
  );
}
