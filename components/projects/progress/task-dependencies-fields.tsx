"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { SuccessorOption } from "@/lib/cost-estimate/successor-options";
import { scheduleRowKey } from "@/lib/cost-estimate/successor-options";

export function TaskDependenciesFields({ id, predecessor, successor, predecessorOptions, successorOptions, onPredecessor, onSuccessor }: {
  id: string; predecessor: string; successor: string; predecessorOptions: SuccessorOption[]; successorOptions: SuccessorOption[];
  onPredecessor: (value: string) => void; onSuccessor: (value: string) => void;
}) {
  const [previousSuccessor] = useState(successor);
  return <div className="grid gap-4 sm:grid-cols-2">
    <input type="hidden" name="previousSuccessorRowKey" value={previousSuccessor} />
    {([{ label: "Predecessor", name: "predecessorRowKey", value: predecessor, options: predecessorOptions, onChange: onPredecessor },
      { label: "Successor", name: "successorRowKey", value: successor, options: successorOptions, onChange: onSuccessor }]).map(field =>
      <div key={field.name} className="min-w-0 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={`${id}-${field.name}`} className="text-sm font-medium text-zinc-900">{field.label}</label>
          {field.value && <button type="button" onClick={() => field.onChange("")} className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-900">Clear</button>}
        </div>
        <div className="relative">
          <select id={`${id}-${field.name}`} name={field.name} value={field.value} onChange={event => field.onChange(event.target.value)}
            className="h-[38px] w-full min-w-0 cursor-pointer appearance-none rounded border border-zinc-200 bg-white px-3 py-2 pr-8 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200">
            <option value="" hidden />
            {field.options.map(option => <option key={scheduleRowKey(option)} value={scheduleRowKey(option)}>{option.name}</option>)}
          </select>
          <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-zinc-400" />
        </div>
      </div>)}
  </div>;
}
