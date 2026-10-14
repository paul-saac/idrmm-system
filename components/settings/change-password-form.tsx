"use client";

import { useActionState, useId } from "react";
import { changePassword, type AuthActionState } from "@/lib/auth/actions";

const initialState: AuthActionState = {};

const LABEL = "text-sm font-medium text-zinc-900";
const FIELD =
  "rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200";

/** Settings' own Change Password — current password first (see
 * changePassword), then the new one twice. */
export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePassword, initialState);
  const formId = useId();

  return (
    // Keyed on success, so the fields clear once it's changed.
    <form key={state.success} action={formAction} className="grid gap-4 sm:grid-cols-2" noValidate>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <label htmlFor={`${formId}-current`} className={LABEL}>
          Current Password
        </label>
        <input
          id={`${formId}-current`}
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          className={FIELD}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-new`} className={LABEL}>
          New Password
        </label>
        <input
          id={`${formId}-new`}
          name="password"
          type="password"
          autoComplete="new-password"
          className={FIELD}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-confirm`} className={LABEL}>
          Confirm New Password
        </label>
        <input
          id={`${formId}-confirm`}
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          className={FIELD}
        />
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-red-600 sm:col-span-2">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="text-sm text-emerald-700 sm:col-span-2">
          {state.success}
        </p>
      )}

      <div className="flex justify-end sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving..." : "Change Password"}
        </button>
      </div>
    </form>
  );
}
