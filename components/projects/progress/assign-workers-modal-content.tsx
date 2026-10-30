"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { useState } from "react";
import Link from "next/link";
import { Plus, Search, X } from "lucide-react";
import { usePortal } from "@/components/portal/portal-context";
import { SectionLabel } from "@/components/ui/list-table";
import { ModalFooter } from "@/components/ui/modal";
import { memberSections } from "@/lib/workers/sections";
import type { MemberGroup, Worker, WorkerAssignment } from "@/lib/workers/data";
import type { WorkerActionState } from "@/lib/workers/actions";

function formatDateRange(start: Date, end: Date) {
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} - ${fmt(end)}`;
}

/**
 * Opened from a row's own "Assigned" cell in the Gantt task list (see
 * gantt-chart-view.tsx) — a checkbox picker over the whole company Team
 * (the admin's Team page; there's no per-project roster any more), each
 * member shown with their title. Management is assigned at project level;
 * other members may be selected on multiple tasks. Scoped to whichever
 * one row opened it — a task or, one level up, a category with no tasks
 * yet (see CategoryWorkerAssignments's own doc comment) — via `onSave`, so
 * this component itself doesn't need to know which kind of row it's
 * editing; the caller wires it to setTaskWorkers or setCategoryWorkers.
 *
 * startDate/endDate are the SAME Date objects already shown in that
 * row's own Start/End Gantt columns, reused as-is so this badge always
 * matches what's on screen for that row.
 */
export function AssignWorkersModalContent({
  rowName,
  startDate,
  endDate,
  workers,
  assignedWorkerIds,
  groups = [],
  defaultWorkerIds = [],
  onSave,
  onClose,
}: {
  /** The Team's groups (crews): one click adds everyone in one (or, when
   * they're all already picked, takes them off). */
  groups?: MemberGroup[];
  defaultWorkerIds?: number[];
  /** The task or category name shown in this modal's own intro line —
   * "Assign workers to <rowName>." */
  rowName: string;
  startDate: Date;
  endDate: Date;
  workers: Worker[];
  /** Every member's assignments (lib/workers/data.ts) — the open ones
   * decide availability. */
  assignments: WorkerAssignment[];
  /** The row being edited — left out of its own members' availability. */
  current: { kind: "task" | "category"; id: number };
  assignedWorkerIds: number[];
  onSave: (workerIds: number[]) => Promise<WorkerActionState>;
  onClose: () => void;
}) {
  const { isAdmin } = usePortal();
  const defaults = new Set(defaultWorkerIds);
  const assignableWorkers = workers.filter(worker => worker.category !== "management" && !defaults.has(worker.id));
  const workerIds = new Set(assignableWorkers.map(worker => worker.id));
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(assignedWorkerIds.filter(id => workerIds.has(id)))
  );
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const sections = memberSections(
    q
      ? assignableWorkers.filter(
          (worker) =>
            worker.fullName.toLowerCase().includes(q) ||
            (worker.title ?? "").toLowerCase().includes(q)
        )
      : assignableWorkers
  );

  function toggle(workerId: number) {
    if (!workerIds.has(workerId) || pending) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(workerId)) {
        next.delete(workerId);
      } else {
        next.add(workerId);
      }
      return next;
    });
  }

  // Group shortcuts use the same eligible list, so management cannot be
  // selected indirectly through a mixed group.
  const crews = groups
    .map((group) => ({
      id: group.id,
      name: group.name,
      ids: group.memberIds.filter((id) => workerIds.has(id)),
    }))
    .filter((group) => group.ids.length > 0);

  function toggleGroup(ids: number[]) {
    if (pending) return;
    setSelected((prev) => {
      const next = new Set(prev);
      const all = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (!workerIds.has(id)) continue;
        if (all) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  async function handleSave() {
    setError(null);
    setPending(true);
    try {
      const result = await onSave(Array.from(selected).filter(id => workerIds.has(id)));
      if (result.error) {
        setError(result.error);
        return;
      }
      onClose();
    } catch {
      setError("Could not save assignments. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex h-full min-h-full flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-500">
          Assign workers to{" "}
          <span className="font-medium text-zinc-700">{rowName}</span>.
        </p>
        <span className="shrink-0 px-2 py-1 text-xs font-medium text-zinc-500">
          {formatDateRange(startDate, endDate)}
        </span>
      </div>

      {assignableWorkers.length === 0 ? (
        <EmptyState compact className="py-4 text-center text-sm text-zinc-400">No workers available.</EmptyState>
      ) : (
        <>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search the team"
              className="w-full rounded-md border border-zinc-200 bg-white py-2 pl-9 pr-8 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                title="Clear search"
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {crews.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-zinc-500">Groups</span>
              <div className="flex flex-wrap gap-2">
                {crews.map((group) => {
                  const all = group.ids.every((id) => selected.has(id));
                  return (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => toggleGroup(group.ids)}
                      aria-pressed={all}
                      title={all ? "Take this group off" : "Add everyone in this group"}
                      className={`flex cursor-pointer items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium transition ${
                        all
                          ? "border-zinc-900 bg-zinc-900 text-white"
                          : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400"
                      }`}
                    >
                      {group.name}
                      <span className={all ? "text-zinc-300" : "text-zinc-400"}>
                        {group.ids.length}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Labeled by the Team's own sections. */}
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            {sections.length === 0 && (
              <EmptyState compact className="py-4 text-center text-sm text-zinc-400">No members match.</EmptyState>
            )}
            {sections.map((section) => (
              <div key={section.key} className="flex flex-col gap-0.5">
                <SectionLabel label={section.label} />
                {section.members.map((worker) => {
                  return (
                    <label
                      key={worker.id}
                      className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-sm text-zinc-700 transition hover:bg-zinc-50"
                    >
                      <span className="relative inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center">
                        <input type="checkbox" checked={selected.has(worker.id)}
                          disabled={pending}
                          onChange={() => toggle(worker.id)} aria-label={`Select ${worker.fullName}`}
                          className="peer m-0 block h-[14px] w-[14px] shrink-0 cursor-pointer appearance-none rounded-[2px] border border-zinc-300 bg-white p-0 transition-colors checked:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-200 focus-visible:outline-none disabled:cursor-default" />
                        <span className="pointer-events-none absolute left-[4px] top-[4px] block h-[6px] w-[6px] rounded-[1px] bg-zinc-900 opacity-0 peer-checked:opacity-100" />
                      </span>
                      <span className="truncate">{worker.fullName}</span>
                      {worker.title && (
                        <span className="shrink-0 text-xs text-zinc-400">{worker.title}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {/* The modal's own bottom bar, a border along its top. */}
      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Cancel
        </button>
        {/* The Team page is the admin's alone — members are added there. */}
        {isAdmin && (
          <Link
            href="/admin/team"
            className="flex cursor-pointer items-center gap-1.5 rounded border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
          >
            <Plus className="size-4" />
            Add Members
          </Link>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save"}
        </button>
      </ModalFooter>
    </div>
  );
}
