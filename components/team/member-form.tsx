"use client";

import { RequiredMark } from "@/components/ui/required-mark";
import { useActionState, useEffect, useId, useState } from "react";
import {
  createWorker,
  updateWorker,
  type WorkerActionState,
} from "@/lib/workers/actions";
import type { Worker } from "@/lib/workers/data";
import { ModalFooter } from "@/components/ui/modal";
import { SuggestionInput } from "@/components/ui/suggestion-input";
import { DatePicker } from "@/components/ui/date-picker";
import { DEFAULT_WORK_HOURS, WEEKDAY_LABELS } from "@/lib/workers/schedule";
import {
  TITLE_SUGGESTIONS,
  categoryForTitle,
  type EmploymentType,
  type MemberCategory,
} from "@/lib/workers/presets";

const initialState: WorkerActionState = {};

const LABEL = "text-sm font-medium text-zinc-900";
const FIELD =
  "rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200";

// Stored as one full_name — split on the first space only, so "Juan Dela
// Cruz" reads as Juan / Dela Cruz (a common shape for local surnames).
function splitFullName(fullName: string) {
  const trimmed = fullName.trim();
  const space = trimmed.indexOf(" ");
  if (space === -1) return { firstName: trimmed, lastName: "" };
  return {
    firstName: trimmed.slice(0, space),
    lastName: trimmed.slice(space + 1).trim(),
  };
}

/**
 * Add or edit one Team member — name, role (typable, with suggestions),
 * a subcontractor's company, contact number, date hired, and a skilled
 * worker's Default Rate and Working Days (what their hours on a task cost
 * — see the progress window's attendance). Their category and type aren't
 * asked: they're the Team tab they were added from (`defaults`), and stay
 * what they are on an edit. A login account isn't either — project
 * managers' and foremen's are linked on their own (ensure_team_member,
 * 0063).
 */
export function MemberForm({
  member,
  defaults,
  onSuccess,
  onCancel,
  children,
}: {
  member?: Worker;
  /** A new member's category and type — the Team tab they're added
   * from. */
  defaults?: { category: MemberCategory; employmentType: EmploymentType };
  onSuccess: () => void;
  onCancel: () => void;
  /** Shown after the fields — e.g. the member's current tasks
   * (TeamBrowser). Spans its own columns. */
  children?: React.ReactNode;
}) {
  const action = member ? updateWorker.bind(null, member.id) : createWorker;
  const [state, formAction, pending] = useActionState(action, initialState);
  const formId = useId();
  const initialName = splitFullName(member?.fullName ?? "");
  const [firstName, setFirstName] = useState(initialName.firstName);
  const [lastName, setLastName] = useState(initialName.lastName);
  const category: MemberCategory = member?.category ?? defaults?.category ?? "skilled";
  const employmentType: EmploymentType =
    member?.employmentType ?? defaults?.employmentType ?? "employee";
  const subcontractor = employmentType === "subcontractor";
  // Paid by the hour — management and engineers are salaried, and a
  // subcontractor's paid per contract.
  const hourly = !subcontractor && category === "skilled";

  useEffect(() => {
    if (state.success) onSuccess();
    // Only when the action produces a new result — onSuccess is inline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form id={`${formId}-form`} action={formAction} autoComplete="off" className="grid gap-4 sm:grid-cols-2" noValidate>
      <input type="hidden" name="category" value={category} />
      <input type="hidden" name="employmentType" value={employmentType} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-first`} className={LABEL}>
          First Name<RequiredMark /></label>
        <input
          id={`${formId}-first`}
          name="firstName"
          required
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          className={FIELD}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-last`} className={LABEL}>
          Last Name
        </label>
        <input
          id={`${formId}-last`}
          name="lastName"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          className={FIELD}
        />
      </div>

      <div className={`flex flex-col gap-1.5 ${subcontractor ? "" : "sm:col-span-2"}`}>
        <label htmlFor={`${formId}-title`} className={LABEL}>
          Role
        </label>
        <SuggestionInput
          suggestions={TITLE_SUGGESTIONS.filter(title => categoryForTitle(title) !== "management")}
          id={`${formId}-title`}
          name="title"
          defaultValue={member?.title ?? ""}
          className={FIELD}
        />

      </div>
      {subcontractor && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${formId}-company`} className={LABEL}>
            Company<RequiredMark /></label>
          <input
            id={`${formId}-company`}
            name="subcontractorCompany"
            defaultValue={member?.subcontractorCompany ?? ""}
            className={FIELD}
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-contact`} className={LABEL}>
          Contact Number
        </label>
        <input
          id={`${formId}-contact`}
          name="contactNumber"
          type="tel"
          defaultValue={member?.contactNumber ?? ""}
          className={FIELD}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-hired`} className={LABEL}>
          Date Hired
        </label>
        <DatePicker
          id={`${formId}-hired`}
          name="dateHired"
          ariaLabel="Date hired"
          defaultValue={member?.dateHired ?? ""}
          className={FIELD}
        />
      </div>

      {/* What an hour on a task costs, and the hours they work each day
          of the week — a day's attendance on a task starts from them. A
          subcontractor's paid per contract instead. */}
      {hourly && (
        // One row: the rate, then the week. The rate's column stretches to
        // the week's height (its day names above the boxes) and keeps its
        // input at the bottom, so both labels and all the boxes line up.
        <div className="flex flex-col gap-4 sm:col-span-2 sm:flex-row">
          <div className="flex min-w-0 flex-1 flex-col justify-between gap-1.5">
            <label htmlFor={`${formId}-rate`} className={LABEL}>
              Default Rate
            </label>
            <div className="flex items-center rounded-md border border-zinc-200 bg-white focus-within:border-zinc-400 focus-within:ring-2 focus-within:ring-zinc-200">
              <span className="pl-3 text-sm text-zinc-400">₱</span>
              <input
                id={`${formId}-rate`}
                name="hourlyRate"
                type="text"
                inputMode="decimal"
                defaultValue={member?.hourlyRate ?? ""}
                placeholder="0.00"
                className="w-full min-w-0 bg-transparent py-2 pr-1 pl-1.5 text-sm outline-none"
              />
              <span className="shrink-0 pr-3 text-sm text-zinc-400">/ hour</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col justify-end">
            {/* No label of its own — the day names say what it is. */}
            <div role="group" aria-label="Working days" className="flex gap-1.5">
              {WEEKDAY_LABELS.map((day, index) => (
                <label key={day} className="flex w-11 shrink-0 flex-col items-center gap-1">
                  <span className="text-xs font-medium text-zinc-500 uppercase">{day}</span>
                  <input
                    name="workHours"
                    type="text"
                    inputMode="decimal"
                    defaultValue={String((member?.workHours ?? DEFAULT_WORK_HOURS)[index] ?? 0)}
                    aria-label={`Hours on ${day}`}
                    // FIELD's own look, with less side padding — seven boxes
                    // share the row with the rate.
                    className="w-full min-w-0 rounded-md border border-zinc-200 bg-white px-1 py-2 text-center text-sm tabular-nums outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {children}

      {/* Along the modal's bottom edge, however long the form — that bar
          is outside this <form>, so Save names it (form=). */}
      <ModalFooter>
        {state.error && (
          <p role="alert" className="mr-auto text-sm text-red-600">
            {state.error}
          </p>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          form={`${formId}-form`}
          disabled={pending}
          className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save"}
        </button>
      </ModalFooter>
    </form>
  );
}
