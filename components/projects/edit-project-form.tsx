"use client";

import { useActionState, useEffect, useId } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import { updateProject, type ProjectActionState } from "@/lib/projects/actions";
import type { ProjectRow } from "@/lib/projects/data";
import type { AccountRow } from "@/lib/accounts/data";

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
function handleDateEmptyChange(e: React.ChangeEvent<HTMLInputElement>) {
  e.currentTarget.dataset.empty = e.currentTarget.value ? "false" : "true";
}

export function EditProjectForm({
  project,
  projectManagers,
  foremen,
  onSuccess,
  onRequestDelete,
}: {
  project: ProjectRow;
  projectManagers: AccountRow[];
  foremen: AccountRow[];
  onSuccess?: () => void;
  /** Closes this modal and opens the (centered, non-stacking) Delete
   * Project confirmation modal instead — see project-detail-view.tsx's
   * own wiring. Never a window.confirm() here. */
  onRequestDelete: () => void;
}) {
  const boundAction = updateProject.bind(null, project.id);
  const [state, formAction, pending] = useActionState(
    boundAction,
    initialState
  );
  const formId = useId();

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
        className="grid gap-4 sm:grid-cols-2"
        noValidate
      >
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
          autoComplete="off"
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
          autoComplete="off"
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
          data-empty={project.startDate ? "false" : "true"}
          onChange={handleDateEmptyChange}
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
          data-empty={project.targetEndDate ? "false" : "true"}
          onChange={handleDateEmptyChange}
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
          data-empty={project.actualEndDate ? "false" : "true"}
          onChange={handleDateEmptyChange}
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
          autoComplete="off"
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
        <div className="relative">
          <select
            id="edit-projectManagerId"
            name="projectManagerId"
            required
            defaultValue={project.projectManagerId}
            className="w-full cursor-pointer appearance-none rounded-md border border-zinc-200 bg-white px-3 py-2 pr-8 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          >
            {projectManagers.map((pm) => (
              <option key={pm.id} value={pm.id}>
                {personLabel(pm)}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-zinc-400" />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="edit-foremanId"
          className="text-sm font-medium text-zinc-800"
        >
          Foreman
        </label>
        <div className="relative">
          <select
            id="edit-foremanId"
            name="foremanId"
            required
            defaultValue={project.foremanId}
            className="w-full cursor-pointer appearance-none rounded-md border border-zinc-200 bg-white px-3 py-2 pr-8 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          >
            {foremen.map((f) => (
              <option key={f.id} value={f.id}>
                {personLabel(f)}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-zinc-400" />
        </div>
      </div>

      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <span className="text-sm font-medium text-zinc-800">Working days</span>
        <div className="flex flex-wrap gap-3">
          {WEEKDAY_OPTIONS.map((day) => (
            <label
              key={day.value}
              className="flex cursor-pointer items-center gap-1.5 text-sm text-zinc-700"
            >
              <input
                type="checkbox"
                name="workingDays"
                value={day.value}
                defaultChecked={project.workingDays.includes(day.value)}
                // accent-color, not the text-* + forms-plugin trick this
                // app's other checkboxes assume — @tailwindcss/forms isn't
                // actually installed here, so text-* alone left every
                // checkbox in the app rendering with the browser's own
                // native (blue) checked color, confirmed directly. This
                // is the one that actually controls it, cross-browser.
                className="size-4 cursor-pointer rounded border-zinc-300 accent-zinc-900 focus:ring-2 focus:ring-zinc-200"
              />
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

      <div className="mt-auto flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onRequestDelete}
          className="flex cursor-pointer items-center gap-1.5 rounded border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="size-3.5" />
          Delete
        </button>
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
