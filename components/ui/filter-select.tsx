"use client";

import { ChevronDown, X } from "lucide-react";

/**
 * A toolbar filter: closed, it reads as its own name (`label`) until one
 * of `options` is picked — the list holds only the real choices, never a
 * "show everything" one — and the × that then sits beside the pick clears
 * it again ("all").
 */
export function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | "all";
  options: { value: T; label: string }[];
  onChange: (value: T | "all") => void;
}) {
  const active = value !== "all";
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        aria-label={label}
        className={`cursor-pointer appearance-none rounded-md border bg-white py-2 pr-8 pl-3 text-sm font-medium outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 ${
          active ? "border-zinc-400 text-zinc-900" : "border-zinc-200 text-zinc-700"
        }`}
      >
        {/* The resting label — hidden from the list, never a choice. */}
        <option value="all" disabled hidden>
          {label}
        </option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {active ? (
        <button
          type="button"
          onClick={() => onChange("all")}
          title={`Clear the ${label.toLowerCase()} filter`}
          aria-label={`Clear the ${label.toLowerCase()} filter`}
          className="absolute top-1/2 right-1.5 -translate-y-1/2 cursor-pointer rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
        >
          <X className="size-3.5" />
        </button>
      ) : (
        <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-zinc-400" />
      )}
    </div>
  );
}
