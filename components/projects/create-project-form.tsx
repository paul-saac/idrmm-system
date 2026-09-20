"use client";

import { useActionState, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { createProject, type ProjectActionState } from "@/lib/projects/actions";
import type { AccountRow } from "@/lib/accounts/data";

const initialState: ProjectActionState = {};

function personLabel(account: AccountRow) {
  return `${account.firstName} ${account.lastName}`.trim() || account.email;
}

// Toggles data-empty so globals.css can gray out an empty date input's
// own "mm/dd/yyyy" hint like a real placeholder — see that rule's own
// comment for why this couldn't just be a CSS pseudo-class instead.
function handleDateEmptyChange(e: React.ChangeEvent<HTMLInputElement>) {
  e.currentTarget.dataset.empty = e.currentTarget.value ? "false" : "true";
}

export function CreateProjectForm({
  projectManagers,
  foremen,
  onSuccess,
}: {
  projectManagers: AccountRow[];
  foremen: AccountRow[];
  onSuccess?: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    createProject,
    initialState
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      onSuccess?.();
    }
    // Only re-run when the action produces a new result — `onSuccess` is
    // passed inline by the parent and would otherwise re-run this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="grid gap-4 sm:grid-cols-2"
      noValidate
    >
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <label
          htmlFor="projectName"
          className="text-sm font-medium text-zinc-800"
        >
          Project name
        </label>
        <input
          id="projectName"
          name="projectName"
          required
          autoComplete="off"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <label htmlFor="location" className="text-sm font-medium text-zinc-800">
          Location
        </label>
        <input
          id="location"
          name="location"
          autoComplete="off"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="startDate" className="text-sm font-medium text-zinc-800">
          Start date
        </label>
        <input
          id="startDate"
          name="startDate"
          type="date"
          data-empty="true"
          onChange={handleDateEmptyChange}
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="targetEndDate"
          className="text-sm font-medium text-zinc-800"
        >
          Target end date
        </label>
        <input
          id="targetEndDate"
          name="targetEndDate"
          type="date"
          data-empty="true"
          onChange={handleDateEmptyChange}
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <label
          htmlFor="allocatedBudget"
          className="text-sm font-medium text-zinc-800"
        >
          Allocated budget
        </label>
        <input
          id="allocatedBudget"
          name="allocatedBudget"
          type="number"
          min="0"
          step="0.01"
          autoComplete="off"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <label
          htmlFor="defaultLaborCostPercent"
          className="text-sm font-medium text-zinc-800"
        >
          Default labor cost %
        </label>
        <input
          id="defaultLaborCostPercent"
          name="defaultLaborCostPercent"
          type="number"
          min="0"
          max="100"
          step="0.01"
          autoComplete="off"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="projectManagerId"
          className="text-sm font-medium text-zinc-800"
        >
          Project Manager
        </label>
        <div className="relative">
          <select
            id="projectManagerId"
            name="projectManagerId"
            required
            defaultValue=""
            className="w-full cursor-pointer appearance-none rounded-md border border-zinc-200 bg-white px-3 py-2 pr-8 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          >
            <option value="" disabled>
              Select a Project Manager
            </option>
            {projectManagers.map((pm) => (
              <option key={pm.id} value={pm.id}>
                {personLabel(pm)}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-zinc-400" />
        </div>
        {projectManagers.length === 0 && (
          <p className="text-xs text-amber-600">
            No Project Manager accounts yet — create one in Accounts first.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="foremanId" className="text-sm font-medium text-zinc-800">
          Foreman
        </label>
        <div className="relative">
          <select
            id="foremanId"
            name="foremanId"
            required
            defaultValue=""
            className="w-full cursor-pointer appearance-none rounded-md border border-zinc-200 bg-white px-3 py-2 pr-8 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          >
            <option value="" disabled>
              Select a Foreman
            </option>
            {foremen.map((f) => (
              <option key={f.id} value={f.id}>
                {personLabel(f)}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-zinc-400" />
        </div>
        {foremen.length === 0 && (
          <p className="text-xs text-amber-600">
            No Foreman accounts yet — create one in Accounts first.
          </p>
        )}
      </div>

      <div className="flex items-center gap-3 sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Creating..." : "Create project"}
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
