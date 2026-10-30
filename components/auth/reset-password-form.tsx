"use client";

import { RequiredMark } from "@/components/ui/required-mark";
import { useActionState, useId, useState } from "react";
import { updatePassword, type AuthActionState } from "@/lib/auth/actions";
import { PasswordRequirements } from "./password-requirements";
import { getPasswordError, PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";

const initialState: AuthActionState = {};

export function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const requirementsId = useId();
  const [state, formAction, pending] = useActionState(
    updatePassword,
    initialState
  );

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium text-zinc-900">
          New password<RequiredMark /></label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="Enter a new password"
          minLength={PASSWORD_MIN_LENGTH}
          value={password}
          onChange={event => setPassword(event.target.value)}
          aria-describedby={requirementsId}
          required
          disabled={pending}
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <PasswordRequirements password={password} id={requirementsId} />

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="confirmPassword"
          className="text-sm font-medium text-zinc-900"
        >
          Confirm new password<RequiredMark /></label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          placeholder="Re-enter your new password"
          minLength={PASSWORD_MIN_LENGTH}
          value={confirmPassword}
          onChange={event => setConfirmPassword(event.target.value)}
          required
          disabled={pending}
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      {confirmPassword && password !== confirmPassword && <p role="alert" className="text-xs text-red-600">Passwords do not match.</p>}

      {state?.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || Boolean(getPasswordError(password)) || password !== confirmPassword}
        className="mt-1 w-full rounded bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Updating..." : "Update password"}
      </button>
    </form>
  );
}
