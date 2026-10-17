"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** One way to view a section — an entry in its view menu, with an icon
 * before its name, or just the name. */
export type ViewOption<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
};

/**
 * A section toolbar's view menu, at its left edge — a button naming the
 * open view (its icon, its name, a chevron) that opens a menu of every
 * view to switch to: the Gantt chart's Gantt / Calendar, the Material
 * record's Materials / Material requests. A click anywhere outside the
 * open menu, or Escape, closes it.
 */
export function ViewMenu<T extends string>({
  views,
  value,
  onChange,
}: {
  views: readonly ViewOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = views.find((view) => view.value === value) ?? views[0];

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((isOpen) => !isOpen)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch view"
        className="flex cursor-pointer items-center gap-1.5 rounded border border-zinc-200 bg-white px-2.5 py-1.5 text-sm font-medium whitespace-nowrap text-zinc-700 transition hover:bg-zinc-100"
      >
        {current.icon && <span className="text-zinc-400">{current.icon}</span>}
        {current.label}
        <ChevronDown
          className={`size-4 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {/* z-10 clears what's below it (a Gantt chart isolates its own
          stacking) but stays under the page's sticky tabs bar (z-20). */}
      {open && (
        <div
          role="menu"
          className="absolute top-full left-0 z-10 mt-1 min-w-44 rounded border border-zinc-200 bg-white py-1 shadow-lg"
        >
          {views.map((view) => {
            const selected = view.value === value;
            return (
              <button
                key={view.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  setOpen(false);
                  onChange(view.value);
                }}
                className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm whitespace-nowrap transition hover:bg-zinc-50 ${
                  selected ? "font-medium text-zinc-900" : "text-zinc-600"
                }`}
              >
                {view.icon && <span className="text-zinc-400">{view.icon}</span>}
                {view.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
