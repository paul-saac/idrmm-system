"use client";

import { RequiredMark } from "@/components/ui/required-mark";
import { useActionState, useEffect, useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { updateProject, type ProjectActionState } from "@/lib/projects/actions";
import type { ProjectRow } from "@/lib/projects/data";
import type { AccountRow } from "@/lib/accounts/data";
import { projectElsewhere } from "@/lib/accounts/availability";
import { DatePicker } from "@/components/ui/date-picker";

const initialState: ProjectActionState = {};

// ISO weekday numbers (1=Monday..7=Sunday), matching working_days'
// own storage convention — see 0040_task_progress_tracking.sql.
const WEEKDAY_OPTIONS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
] as const;

function personLabel(account: AccountRow) {
  return `${account.firstName} ${account.lastName}`.trim() || account.email;
}

// Toggles data-empty so globals.css can gray out an empty date input's
// own "mm/dd/yyyy" hint like a real placeholder — see that rule's own
// comment for why this couldn't just be a CSS pseudo-class instead.
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
  const formId = useId();
  // Holidays aren't set here — they're Holiday events on the Gantt
  // chart's Calendar view (0055_project_events.sql).
  const [workingDays, setWorkingDays] = useState<number[]>(project.workingDays);

  useEffect(() => {
    if (state.success) {
      onSuccess?.();
    }
    // Only re-run when the action produces a new result — `onSuccess` is
    // passed inline by the parent and would otherwise re-run this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <div className="flex h-full min-h-full flex-col gap-4">
      <form
        id={formId}
        action={formAction}
        autoComplete="off"
        className="grid gap-4 sm:grid-cols-2"
        noValidate
      >
        <div className="flex flex-col gap-1.5 sm:col-span-2">
        <label
          htmlFor="edit-projectName"
          className="text-sm font-medium text-zinc-900"
        >
          Project name<RequiredMark /></label>
        <input
          id="edit-projectName"
          name="projectName"
          required
          defaultValue={project.name}
          autoComplete="off"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <label
          htmlFor="edit-location"
          className="text-sm font-medium text-zinc-900"
        >
          Location
        </label>
        <input
          id="edit-location"
          name="location"
          defaultValue={project.location ?? ""}
          autoComplete="off"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="edit-startDate"
          className="text-sm font-medium text-zinc-900"
        >
          Start date
        </label>
        <DatePicker
          id="edit-startDate"
          name="startDate"
          ariaLabel="Start date"
          defaultValue={project.startDate ?? ""}
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="edit-targetEndDate"
          className="text-sm font-medium text-zinc-900"
        >
          Target end date
        </label>
        <DatePicker
          id="edit-targetEndDate"
          name="targetEndDate"
          ariaLabel="Target end date"
          defaultValue={project.targetEndDate ?? ""}
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="edit-actualEndDate"
          className="text-sm font-medium text-zinc-900"
        >
          Actual end date
        </label>
        <DatePicker
          id="edit-actualEndDate"
          name="actualEndDate"
          ariaLabel="Actual end date"
          defaultValue={project.actualEndDate ?? ""}
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="edit-allocatedBudget"
          className="text-sm font-medium text-zinc-900"
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
          autoComplete="off"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="edit-projectManagerId"
          className="text-sm font-medium text-zinc-900"
        >
          Project Manager<RequiredMark /></label>
        <div className="relative">
          <select
            id="edit-projectManagerId"
            name="projectManagerId"
            required
            defaultValue={project.projectManagerId}
            className="flex h-[38px] w-full min-w-0 cursor-pointer appearance-none items-center rounded-md border border-zinc-200 bg-white px-3 py-2 pr-8 text-left text-sm leading-5 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          >
            {/* Someone already on another unfinished project can't be
                picked (see projectElsewhere) — this project's own PM
                always can. */}
            {projectManagers.map((pm) => {
              const elsewhere =
                pm.id === project.projectManagerId ? null : projectElsewhere(pm, project.id);
              return (
                <option key={pm.id} value={pm.id} disabled={elsewhere !== null}>
                  {`${personLabel(pm)}${elsewhere ? ` — on ${elsewhere.name}` : ""}`}
                </option>
              );
            })}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-zinc-400" />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="edit-foremanId"
          className="text-sm font-medium text-zinc-900"
        >
          Foreman<RequiredMark /></label>
        <div className="relative">
          <select
            id="edit-foremanId"
            name="foremanId"
            required
            defaultValue={project.foremanId}
            className="flex h-[38px] w-full min-w-0 cursor-pointer appearance-none items-center rounded-md border border-zinc-200 bg-white px-3 py-2 pr-8 text-left text-sm leading-5 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          >
            {foremen.map((f) => {
              const elsewhere = f.id === project.foremanId ? null : projectElsewhere(f, project.id);
              return (
                <option key={f.id} value={f.id} disabled={elsewhere !== null}>
                  {`${personLabel(f)}${elsewhere ? ` — on ${elsewhere.name}` : ""}`}
                </option>
              );
            })}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-zinc-400" />
        </div>
      </div>

      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <span className="text-sm font-medium text-zinc-900">Working days</span>
        <div className="flex flex-wrap gap-3">
          {WEEKDAY_OPTIONS.map((day) => (
            <label
              key={day.value}
              className="flex cursor-pointer items-center gap-1.5 text-sm text-zinc-700"
            >
              {/* Drawn by hand (appearance-none + an inner square, no
                  check mark): checked shows a filled square inset from
                  the box's border. A native checkbox's own mark can't be
                  changed, only recolored via accent-color —
                  @tailwindcss/forms isn't installed here. */}
              <span className="relative inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center">
                <input
                  type="checkbox"
                  name="workingDays"
                  value={day.value}
                  checked={workingDays.includes(day.value)}
                  onChange={() =>
                    setWorkingDays((prev) =>
                      prev.includes(day.value)
                        ? prev.filter((value) => value !== day.value)
                        : [...prev, day.value]
                    )
                  }
                  className="peer m-0 block h-[14px] w-[14px] shrink-0 cursor-pointer appearance-none rounded-[2px] border border-zinc-300 bg-white p-0 transition-colors checked:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-200 focus-visible:outline-none"
                />
                <span className="pointer-events-none absolute left-[4px] top-[4px] block h-[6px] w-[6px] rounded-[1px] bg-zinc-900 opacity-0 peer-checked:opacity-100" />
              </span>
              {day.label}
            </label>
          ))}
        </div>
      </div>
      </form>

      {state?.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}

      <div className="mt-auto flex items-center justify-end gap-3">
        <button
          type="submit"
          form={formId}
          disabled={pending}
          className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save changes"}
        </button>
      </div>
    </div>
  );
}
