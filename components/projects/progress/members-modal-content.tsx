"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import {
  createWorker,
  updateWorker,
  deleteWorker,
} from "@/lib/workers/actions";
import type { Worker } from "@/lib/workers/data";

let keySeq = 0;
function nextKey() {
  keySeq += 1;
  return `row-${keySeq}`;
}

type DraftRow = {
  key: string;
  /** Null means this row was never a real worker — it only ever
   * produces a createWorker call on Save. A real id means it started
   * from an existing roster entry, and only produces an updateWorker
   * call if its own fields actually changed from that entry. */
  workerId: number | null;
  firstName: string;
  lastName: string;
  role: string;
};

// Storage is still one plain full_name column (no First/Last split in
// the schema) — split on the first space only, so "Juan Dela Cruz"
// reads as firstName "Juan", lastName "Dela Cruz" (a common shape for
// local surnames), rather than splitting every word into its own field.
function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) return { firstName: trimmed, lastName: "" };
  return {
    firstName: trimmed.slice(0, spaceIndex),
    lastName: trimmed.slice(spaceIndex + 1).trim(),
  };
}

function joinFullName(firstName: string, lastName: string): string {
  return [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
}

function workerToDraftRow(worker: Worker): DraftRow {
  const { firstName, lastName } = splitFullName(worker.fullName);
  return {
    key: `worker-${worker.id}`,
    workerId: worker.id,
    firstName,
    lastName,
    role: worker.trade ?? "",
  };
}

function emptyDraftRow(): DraftRow {
  return { key: nextKey(), workerId: null, firstName: "", lastName: "", role: "" };
}

const BLANK_ROWS_TO_SEED = 1;

/**
 * The Gantt Chart Schedule's own "Members" toolbar button opens this —
 * a project-scoped roster of real people (name + optional trade/role)
 * for task-level accountability, separate from estimate_task_labor_
 * assignments' own role+headcount cost-estimation rows (see
 * 0038_task_worker_assignments.sql's own comment). Assigning a roster
 * entry to a specific task happens from the task list's own "Assigned"
 * column, not here — this modal only maintains the roster itself.
 *
 * One unified spreadsheet-style table — First Name / Last Name / Role /
 * remove, per an explicit request to match a bulk "Invite People"
 * pattern — rather than a separate read-only list of existing members
 * above a distinct add-form: every row, whether it started from a real
 * worker or is a still-blank new one, is the SAME kind of row, always
 * directly editable, with a handful of blank rows always seeded at the
 * bottom so there's usually no separate "add a row" click needed first.
 *
 * Everything here is draft state until Save — editing an existing row,
 * filling in a blank one, or removing a row (via its own remove button)
 * only ever touches local state; Save reconciles all of it in one
 * round trip: a create per still-blank-but-now-filled row, an update
 * per existing row whose fields actually changed, and a delete per
 * existing row that got removed (removedWorkerIds) — same "everything
 * batches through Promise.all, nothing round-trips per keystroke"
 * convention Material Breakdown's own Save Changes uses.
 */
export function MembersModalContent({
  projectId,
  workers,
  onClose,
}: {
  projectId: number;
  workers: Worker[];
  onClose: () => void;
}) {
  const router = useRouter();
  const workerById = new Map(workers.map((w) => [w.id, w]));

  const [rows, setRows] = useState<DraftRow[]>(() => [
    ...workers.map(workerToDraftRow),
    ...Array.from({ length: BLANK_ROWS_TO_SEED }, emptyDraftRow),
  ]);
  const [removedWorkerIds, setRemovedWorkerIds] = useState<Set<number>>(
    new Set()
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateRow(key: string, patch: Partial<DraftRow>) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeRow(row: DraftRow) {
    if (row.workerId != null) {
      const worker = workerById.get(row.workerId);
      const label = worker ? worker.fullName : "this person";
      if (!window.confirm(`Remove ${label} from the roster?`)) return;
      setRemovedWorkerIds((prev) => new Set(prev).add(row.workerId!));
    }
    setRows((prev) => prev.filter((r) => r.key !== row.key));
  }

  async function handleSave() {
    setError(null);
    setPending(true);

    const creates = rows.filter((r) => r.workerId == null && r.firstName.trim());
    const updates = rows.filter((r) => {
      if (r.workerId == null) return false;
      const original = workerById.get(r.workerId);
      if (!original) return false;
      const currentName = joinFullName(r.firstName, r.lastName);
      const currentRole = r.role.trim() || null;
      return (
        currentName !== original.fullName || currentRole !== (original.trade ?? null)
      );
    });

    const results = await Promise.all([
      ...creates.map((r) => {
        const formData = new FormData();
        formData.set("fullName", joinFullName(r.firstName, r.lastName));
        formData.set("trade", r.role.trim());
        return createWorker(projectId, {}, formData);
      }),
      ...updates.map((r) => {
        const formData = new FormData();
        formData.set("fullName", joinFullName(r.firstName, r.lastName));
        formData.set("trade", r.role.trim());
        return updateWorker(r.workerId!, projectId, {}, formData);
      }),
      ...Array.from(removedWorkerIds).map((workerId) =>
        deleteWorker(workerId, projectId, {}, new FormData())
      ),
    ]);

    setPending(false);
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      setError(failed.error);
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    <div className="flex h-full min-h-full flex-col gap-4">
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        <div className="flex gap-2 px-0.5 text-xs font-medium text-zinc-500">
          <span className="min-w-0 flex-1">First Name</span>
          <span className="min-w-0 flex-1">Last Name</span>
          <span className="w-28 shrink-0">Role</span>
          <span className="w-7 shrink-0" />
        </div>
        {rows.map((row) => {
          // Already-saved rows (a real worker, not a still-blank new
          // one) get a shaded background so the two read as visually
          // distinct at a glance, rather than every row looking like an
          // identical empty field to fill in.
          const savedBg = row.workerId != null ? "bg-zinc-50" : "bg-white";
          return (
          <div key={row.key} className="flex items-center gap-2">
            <input
              value={row.firstName}
              onChange={(e) => updateRow(row.key, { firstName: e.target.value })}
              placeholder="Juan"
              aria-label="First name"
              className={`min-w-0 flex-1 rounded-xs border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 ${savedBg}`}
            />
            <input
              value={row.lastName}
              onChange={(e) => updateRow(row.key, { lastName: e.target.value })}
              placeholder="Dela Cruz"
              aria-label="Last name"
              className={`min-w-0 flex-1 rounded-xs border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 ${savedBg}`}
            />
            <input
              value={row.role}
              onChange={(e) => updateRow(row.key, { role: e.target.value })}
              placeholder="Electrician"
              aria-label="Role"
              className={`w-28 shrink-0 rounded-xs border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 ${savedBg}`}
            />
            <button
              type="button"
              onClick={() => removeRow(row)}
              aria-label="Remove row"
              className="w-7 shrink-0 cursor-pointer rounded p-1.5 text-zinc-400 transition hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
          );
        })}
        <button
          type="button"
          onClick={() => setRows((prev) => [...prev, emptyDraftRow()])}
          className="flex cursor-pointer items-center gap-1 self-start text-xs font-medium text-zinc-500 transition hover:text-zinc-800"
        >
          <Plus className="size-3.5" />
          Add Another Person
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="mt-auto flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
