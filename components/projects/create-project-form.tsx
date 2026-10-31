"use client";

import { RequiredMark } from "@/components/ui/required-mark";
import { useActionState, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { createProject, type ProjectActionState } from "@/lib/projects/actions";
import type { AccountRow } from "@/lib/accounts/data";
import { projectElsewhere } from "@/lib/accounts/availability";
import { DatePicker } from "@/components/ui/date-picker";

const initialState: ProjectActionState = {};

function personLabel(account: AccountRow) {
  return `${account.firstName} ${account.lastName}`.trim() || account.email;
}

// Toggles data-empty so globals.css can gray out an empty date input's
// own "mm/dd/yyyy" hint like a real placeholder — see that rule's own
// comment for why this couldn't just be a CSS pseudo-class instead.
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
  const eligibleProjectManagers = projectManagers.filter(
    (account) => account.status === "active" && !account.invitationPending
  );
  const eligibleForemen = foremen.filter(
    (account) => account.status === "active" && !account.invitationPending
  );

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
      autoComplete="off"
      className="grid gap-4 sm:grid-cols-2"
      noValidate
    >
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <label
          htmlFor="projectName"
          className="text-sm font-medium text-zinc-900"
        >
          Project name<RequiredMark /></label>
        <input
          id="projectName"
          name="projectName"
          required
          autoComplete="off"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <label htmlFor="location" className="text-sm font-medium text-zinc-900">
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
        <label htmlFor="startDate" className="text-sm font-medium text-zinc-900">
          Start date
        </label>
        <DatePicker
          id="startDate"
          name="startDate"
          ariaLabel="Start date"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="targetEndDate"
          className="text-sm font-medium text-zinc-900"
        >
          Target end date
        </label>
        <DatePicker
          id="targetEndDate"
          name="targetEndDate"
          ariaLabel="Target end date"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <label
          htmlFor="allocatedBudget"
          className="text-sm font-medium text-zinc-900"
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

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="projectManagerId"
          className="text-sm font-medium text-zinc-900"
        >
          Project Manager<RequiredMark /></label>
        <div className="relative">
          <select
            id="projectManagerId"
            name="projectManagerId"
            required
            defaultValue=""
            className="flex h-[38px] w-full min-w-0 cursor-pointer appearance-none items-center rounded-md border border-zinc-200 bg-white px-3 py-2 pr-8 text-left text-sm leading-5 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          >
            <option value="" disabled hidden>
              Select Project Manager
            </option>
            {/* Someone already on an unfinished project can't be picked
                (see projectElsewhere). */}
            {eligibleProjectManagers.map((pm) => {
              const elsewhere = projectElsewhere(pm);
              return (
                <option key={pm.id} value={pm.id} disabled={elsewhere !== null}>
                  {personLabel(pm)}
                </option>
              );
            })}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-zinc-400" />
        </div>
        {eligibleProjectManagers.length === 0 ? (
          <p className="text-xs text-amber-600">
            No active Project Manager has accepted an invitation yet.
          </p>
        ) : (
          eligibleProjectManagers.every((pm) => projectElsewhere(pm)) && (
            <p className="text-xs text-amber-600">
              Every Project Manager is already on a project — they&apos;re free again once
              it&apos;s completed.
            </p>
          )
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="foremanId" className="text-sm font-medium text-zinc-900">
          Foreman<RequiredMark /></label>
        <div className="relative">
          <select
            id="foremanId"
            name="foremanId"
            required
            defaultValue=""
            className="flex h-[38px] w-full min-w-0 cursor-pointer appearance-none items-center rounded-md border border-zinc-200 bg-white px-3 py-2 pr-8 text-left text-sm leading-5 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          >
            <option value="" disabled hidden>
              Select Foreman
            </option>
            {eligibleForemen.map((f) => {
              const elsewhere = projectElsewhere(f);
              return (
                <option key={f.id} value={f.id} disabled={elsewhere !== null}>
                  {personLabel(f)}
                </option>
              );
            })}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-zinc-400" />
        </div>
        {eligibleForemen.length === 0 ? (
          <p className="text-xs text-amber-600">
            No active Foreman has accepted an invitation yet.
          </p>
        ) : (
          eligibleForemen.every((f) => projectElsewhere(f)) && (
            <p className="text-xs text-amber-600">
              Every Foreman is already on a project — they&apos;re free again once it&apos;s
              completed.
            </p>
          )
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
