"use client";

import { useActionState, useEffect } from "react";
import { updateProject, type ProjectActionState } from "@/lib/projects/actions";
import type { ProjectRow } from "@/lib/projects/data";
import type { AccountRow } from "@/lib/accounts/data";

const initialState: ProjectActionState = {};

function personLabel(account: AccountRow) {
  return `${account.firstName} ${account.lastName}`.trim() || account.email;
}

export function EditProjectForm({
  project,
  projectManagers,
  foremen,
  onSuccess,
}: {
  project: ProjectRow;
  projectManagers: AccountRow[];
  foremen: AccountRow[];
  onSuccess?: () => void;
}) {
  const boundAction = updateProject.bind(null, project.id);
  const [state, formAction, pending] = useActionState(
    boundAction,
    initialState
  );

  useEffect(() => {
    if (state.success) {
      onSuccess?.();
    }
    // Only re-run when the action produces a new result — `onSuccess` is
    // passed inline by the parent and would otherwise re-run this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2" noValidate>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <label
          htmlFor="edit-projectName"
          className="text-sm font-medium text-zinc-800"
        >
          Project name
        </label>
        <input
          id="edit-projectName"
          name="projectName"
          required
          defaultValue={project.name}
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <label
          htmlFor="edit-location"
          className="text-sm font-medium text-zinc-800"
        >
          Location
        </label>
        <input
          id="edit-location"
          name="location"
          defaultValue={project.location ?? ""}
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="edit-startDate"
          className="text-sm font-medium text-zinc-800"
        >
          Start date
        </label>
        <input
          id="edit-startDate"
          name="startDate"
          type="date"
          defaultValue={project.startDate ?? ""}
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="edit-targetEndDate"
          className="text-sm font-medium text-zinc-800"
        >
          Target end date
        </label>
        <input
          id="edit-targetEndDate"
          name="targetEndDate"
          type="date"
          defaultValue={project.targetEndDate ?? ""}
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="edit-actualEndDate"
          className="text-sm font-medium text-zinc-800"
        >
          Actual end date
        </label>
        <input
          id="edit-actualEndDate"
          name="actualEndDate"
          type="date"
          defaultValue={project.actualEndDate ?? ""}
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="edit-allocatedBudget"
          className="text-sm font-medium text-zinc-800"
        >
          Allocated budget
        </label>
        <input
          id="edit-allocatedBudget"
          name="allocatedBudget"
          type="number"
          min="0"
          step="0.01"
          defaultValue={project.allocatedBudget ?? ""}
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="edit-projectManagerId"
          className="text-sm font-medium text-zinc-800"
        >
          Project Manager
        </label>
        <select
          id="edit-projectManagerId"
          name="projectManagerId"
          required
          defaultValue={project.projectManagerId}
          className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        >
          {projectManagers.map((pm) => (
            <option key={pm.id} value={pm.id}>
              {personLabel(pm)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="edit-foremanId"
          className="text-sm font-medium text-zinc-800"
        >
          Foreman
        </label>
        <select
          id="edit-foremanId"
          name="foremanId"
          required
          defaultValue={project.foremanId}
          className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        >
          {foremen.map((f) => (
            <option key={f.id} value={f.id}>
              {personLabel(f)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-3 sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save changes"}
        </button>
        {state?.error && (
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}
