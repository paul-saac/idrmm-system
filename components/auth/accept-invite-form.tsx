"use client";

import { RequiredMark } from "@/components/ui/required-mark";
import { useActionState, useId, useState } from "react";
import { acceptInvitation } from "@/lib/auth/invitation-actions";
import type { AuthActionState } from "@/lib/auth/actions";
import { PasswordRequirements } from "./password-requirements";
import { getPasswordError, PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";

export function AcceptInviteForm() {
  const [state, action, pending] = useActionState(acceptInvitation, {} as AuthActionState);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const requirementsId = useId();
  return <form action={action} className="space-y-5">
    <label className="flex flex-col gap-2 text-sm font-medium"><span>Password<RequiredMark /></span><input name="password" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN_LENGTH} value={password} onChange={event => setPassword(event.target.value)} aria-describedby={requirementsId} disabled={pending} className="rounded border border-zinc-200 px-3 py-2.5 outline-none focus:border-zinc-500" /></label>
    <PasswordRequirements password={password} id={requirementsId} />
    <label className="flex flex-col gap-2 text-sm font-medium"><span>Confirm password<RequiredMark /></span><input name="confirmPassword" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN_LENGTH} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} disabled={pending} className="rounded border border-zinc-200 px-3 py-2.5 outline-none focus:border-zinc-500" /></label>
    {confirmPassword && password !== confirmPassword && <p role="alert" className="text-xs text-red-600">Passwords do not match.</p>}
    {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
    <button disabled={pending || Boolean(getPasswordError(password)) || password !== confirmPassword} className="w-full rounded bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50">{pending ? "Setting up..." : "Complete account setup"}</button>
  </form>;
}
