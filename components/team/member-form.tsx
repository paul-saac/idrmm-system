"use client";

import { useActionState, useEffect, useId, useState } from "react";
import {
  createWorker,
  updateWorker,
  type WorkerActionState,
} from "@/lib/workers/actions";
import type { LinkableAccount, Worker } from "@/lib/workers/data";
import {
  MEMBER_CATEGORIES,
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

const ROLE_CATEGORY: Record<LinkableAccount["role"], MemberCategory> = {
  project_manager: "management",
  foreman: "management",
};

/**
 * Add or edit one Team member — name, title (typable, with suggestions;
 * a known one fills its category in), category, employee or
 * subcontractor (and whose), contact number, date hired, and their own
 * login account when they have one (a project manager's or foreman's —
 * picking it fills in an empty name and the matching category).
 */
export function MemberForm({
  member,
  defaults,
  accounts,
  linkedProfileIds,
  onSuccess,
  onCancel,
}: {
  member?: Worker;
  /** A new member's starting category and type. */
  defaults?: { category: MemberCategory; employmentType: EmploymentType };
  /** Project manager and foreman accounts. */
  accounts: LinkableAccount[];
  /** Accounts already linked to some other member. */
  linkedProfileIds: string[];
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const action = member ? updateWorker.bind(null, member.id) : createWorker;
  const [state, formAction, pending] = useActionState(action, initialState);
  const formId = useId();
  const initialName = splitFullName(member?.fullName ?? "");
  const [firstName, setFirstName] = useState(initialName.firstName);
  const [lastName, setLastName] = useState(initialName.lastName);
  const [category, setCategory] = useState<MemberCategory>(
    member?.category ?? defaults?.category ?? "skilled"
  );
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    member?.employmentType ?? defaults?.employmentType ?? "employee"
  );
  const [profileId, setProfileId] = useState(member?.profileId ?? "");

  useEffect(() => {
    if (state.success) onSuccess();
    // Only when the action produces a new result — onSuccess is inline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Active accounts nobody else is linked to — plus this member's own,
  // even if it's since been deactivated.
  const accountOptions = accounts.filter(
    (account) =>
      account.id === member?.profileId ||
      (account.active && !linkedProfileIds.includes(account.id))
  );

  function pickAccount(id: string) {
    setProfileId(id);
    const account = accounts.find((a) => a.id === id);
    if (!account) return;
    if (!firstName && !lastName) {
      const name = splitFullName(account.name);
      setFirstName(name.firstName);
      setLastName(name.lastName);
    }
    setCategory(ROLE_CATEGORY[account.role]);
  }

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-first`} className={LABEL}>
          First Name
        </label>
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

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-title`} className={LABEL}>
          Role
        </label>
        <input
          id={`${formId}-title`}
          name="title"
          list={`${formId}-titles`}
          defaultValue={member?.title ?? ""}
          onChange={(e) => {
            const known = categoryForTitle(e.target.value);
            if (known) setCategory(known);
          }}
          className={FIELD}
        />
        <datalist id={`${formId}-titles`}>
          {TITLE_SUGGESTIONS.map((title) => (
            <option key={title} value={title} />
          ))}
        </datalist>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-category`} className={LABEL}>
          Category
        </label>
        <select
          id={`${formId}-category`}
          name="category"
          value={category}
          onChange={(e) => setCategory(e.target.value as MemberCategory)}
          className={FIELD}
        >
          {MEMBER_CATEGORIES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <span className={LABEL}>Type</span>
        <input type="hidden" name="employmentType" value={employmentType} />
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded bg-zinc-100 p-1">
            {(["employee", "subcontractor"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setEmploymentType(value)}
                aria-pressed={employmentType === value}
                className={`cursor-pointer rounded-sm px-4 py-1 text-sm transition ${
                  employmentType === value
                    ? "bg-white font-medium text-zinc-900 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-900"
                }`}
              >
                {value === "employee" ? "Employee" : "Subcontractor"}
              </button>
            ))}
          </div>
          {employmentType === "subcontractor" && (
            <input
              name="subcontractorCompany"
              defaultValue={member?.subcontractorCompany ?? ""}
              placeholder="Company"
              aria-label="Subcontractor company"
              className={`${FIELD} min-w-0 flex-1`}
            />
          )}
        </div>
      </div>

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
        <input
          id={`${formId}-hired`}
          name="dateHired"
          type="date"
          defaultValue={member?.dateHired ?? ""}
          className={FIELD}
        />
      </div>

      {accountOptions.length > 0 && (
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor={`${formId}-account`} className={LABEL}>
            Login Account
          </label>
          <select
            id={`${formId}-account`}
            name="profileId"
            value={profileId}
            onChange={(e) => pickAccount(e.target.value)}
            className={FIELD}
          >
            <option value="">None</option>
            {accountOptions.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name || account.email} ·{" "}
                {account.role === "project_manager" ? "Project Manager" : "Foreman"}
              </option>
            ))}
          </select>
        </div>
      )}

      {state.error && (
        <p role="alert" className="text-sm text-red-600 sm:col-span-2">
          {state.error}
        </p>
      )}

      <div className="flex justify-end gap-3 sm:col-span-2">
        <button
          type="button"
          onClick={onCancel}
          className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  );
}
