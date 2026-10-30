"use client";

import { RequiredMark } from "@/components/ui/required-mark";
import { useActionState } from "react";
import { acceptInvitation } from "@/lib/auth/invitation-actions";
import type { AuthActionState } from "@/lib/auth/actions";

export function AcceptInviteForm() {
  const [state, action, pending] = useActionState(acceptInvitation, {} as AuthActionState);
  return <form action={action} className="space-y-5">
    <label className="flex flex-col gap-2 text-sm font-medium"><span>Password<RequiredMark /></span><input name="password" type="password" autoComplete="new-password" required minLength={8} disabled={pending} className="rounded border border-zinc-200 px-3 py-2.5 outline-none focus:border-zinc-500" /></label>
    <label className="flex flex-col gap-2 text-sm font-medium"><span>Confirm password<RequiredMark /></span><input name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} disabled={pending} className="rounded border border-zinc-200 px-3 py-2.5 outline-none focus:border-zinc-500" /></label>
    <p className="text-xs text-zinc-500">Use at least 8 characters. Only you need to know your password.</p>
    {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
    <button disabled={pending} className="w-full rounded bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50">{pending ? "Setting up..." : "Complete account setup"}</button>
  </form>;
}
