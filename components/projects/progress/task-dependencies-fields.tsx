"use client";

import { ChevronDown, Search } from "lucide-react";
import { useState } from "react";
import { ganttBarColors } from "./gantt-bar-colors";
import type { CostCategory } from "@/lib/cost-estimate/data";
import { applyDependencySelection, dependencyKey, dependencyRows, dependencySelection, hasDependencyCycle, type DependencyRef } from "@/lib/cost-estimate/dependency-model";

export function TaskDependenciesFields({ id, source, categories }: { id: string; source: DependencyRef; categories: CostCategory[] }) {
  const [initial] = useState(() => dependencySelection(categories, source));
  const [predecessors, setPredecessors] = useState(initial.predecessors);
  const [successors, setSuccessors] = useState(initial.successors);
  const [mode, setMode] = useState<"predecessor" | "successor">("predecessor");
  const [search, setSearch] = useState("");
  const selected = mode === "predecessor" ? predecessors : successors;
  const rows = dependencyRows(categories).filter(row => row.id > 0 && dependencyKey(row) !== dependencyKey(source) && (mode === "predecessor" || row.kind === "task"));
  const visible = rows.filter(row => `${row.label} ${row.phase}`.toLowerCase().includes(search.trim().toLowerCase())).filter(row => {
    const key = dependencyKey(row);
    if (selected.includes(key)) return true;
    return !hasDependencyCycle(applyDependencySelection(categories, source,
      mode === "predecessor" ? [...predecessors, key] : predecessors,
      mode === "successor" ? [...successors, key] : successors));
  });
  return <section className="-mx-6 border-t border-zinc-200" aria-labelledby={`${id}-dependencies`}>
    <input type="hidden" name="dependenciesField" value="1" />
    <input type="hidden" name="predecessorRowKeys" value={JSON.stringify(predecessors)} />
    <input type="hidden" name="successorRowKeys" value={JSON.stringify(successors)} />
    <input type="hidden" name="previousPredecessorRowKeys" value={JSON.stringify(initial.predecessors)} />
    <input type="hidden" name="previousSuccessorRowKeys" value={JSON.stringify(initial.successors)} />
    <div className="border-b border-zinc-200 px-6 py-4">
      <h3 id={`${id}-dependencies`} className="text-sm font-medium text-zinc-900">Dependencies</h3>
    </div>
    <div className="grid grid-cols-2 items-center gap-3 px-6 py-3">
      <div className="relative min-w-0">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-zinc-400" />
        <input aria-label="Search dependency tasks" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search tasks"
          className="h-8 w-full rounded border border-zinc-200 bg-white py-1.5 pr-3 pl-9 text-xs outline-none placeholder:text-zinc-400 focus:border-zinc-400" />
      </div>
      <div className="relative min-w-0">
        <select aria-label="Dependency direction" value={mode} onChange={event => { setMode(event.target.value as typeof mode); setSearch(""); }}
          className="flex h-8 w-full cursor-pointer appearance-none items-center rounded border border-zinc-200 bg-white px-3 py-1.5 pr-8 text-left text-xs leading-4 text-zinc-800 outline-none focus:border-zinc-400">
          <option value="predecessor">Predecessor</option><option value="successor">Successor</option>
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-zinc-400" />
      </div>
    </div>
    <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4 border-y border-zinc-200 bg-zinc-50 px-6 py-2 text-xs font-medium text-zinc-500"><span>Task name</span><span>Phase</span></div>
    <div className="h-[260px] overflow-y-auto overscroll-contain" role="group" aria-label={`${mode} tasks`}>
      {visible.map(row => {
        const key = dependencyKey(row), checked = selected.includes(key);
        const next = checked ? selected.filter(value => value !== key) : [...selected, key];
        return <label key={key} title={row.label}
          className="relative grid min-h-10 cursor-pointer grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-center gap-4 border-b border-zinc-100 px-6 py-2 text-sm text-zinc-800 hover:bg-zinc-50">
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-px left-0 w-1"
            style={{ backgroundColor: ganttBarColors(row.colorId, row.kind === "task" ? "subtask" : row.isMilestone ? "milestone" : row.grouped ? "summary" : "standalone").backgroundColor }} />
          <span className="flex min-w-0 items-center gap-3">
          <span className="relative inline-flex size-[14px] shrink-0">
            <input type="checkbox" checked={checked} onChange={() => (mode === "predecessor" ? setPredecessors : setSuccessors)(next)}
              className="peer m-0 block size-[14px] shrink-0 cursor-pointer appearance-none rounded-[2px] border border-zinc-300 bg-white p-0 transition-colors checked:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-200 focus-visible:outline-none" />
            <span className="pointer-events-none absolute top-[4px] left-[4px] block size-[6px] rounded-[1px] bg-zinc-900 opacity-0 peer-checked:opacity-100" />
          </span>
          <span className={`truncate ${row.grouped ? "font-medium" : ""}`}>{row.label}</span>
          </span>
          <span className="truncate text-sm text-zinc-500" title={row.phase}>{row.phase}</span>
        </label>;
      })}
      {visible.length === 0 && <p className="px-6 py-8 text-center text-xs text-zinc-400">No matching tasks.</p>}
    </div>
  </section>;
}
