"use client";

import { RequiredMark } from "@/components/ui/required-mark";
import { useActionState, useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { changePassword, type AuthActionState } from "@/lib/auth/actions";

const initialState: AuthActionState = {};

const FIELDS = [
  { name: "currentPassword", label: "Current password", placeholder: "Enter current password", autoComplete: "current-password" },
  { name: "password", label: "New password", placeholder: "Enter new password", autoComplete: "new-password" },
  { name: "confirmPassword", label: "Confirm new password", placeholder: "Re-enter new password", autoComplete: "new-password" },
] as const;

/** Settings' own Change Password — current password first (see
 * changePassword), then the new one twice. */
export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePassword, initialState);
  const formId = useId();
  const [visible, setVisible] = useState<Record<string, boolean>>({});

  return (
    // Keyed on success, so the fields clear once it's changed.
    <form key={state.success} action={formAction} className="flex flex-1 flex-col" noValidate>
      <div className="space-y-5 px-5 pb-6 pt-5">
        {FIELDS.map(field => <div key={field.name} className="flex flex-col gap-1.5">
          <label htmlFor={`${formId}-${field.name}`} className="text-xs font-medium text-zinc-900">{field.label}<RequiredMark /></label>
          <div className="relative">
            <input id={`${formId}-${field.name}`} name={field.name} type={visible[field.name] ? "text" : "password"} autoComplete={field.autoComplete} placeholder={field.placeholder} required disabled={pending} className="h-10 w-full rounded border border-zinc-200 bg-white py-2 pl-3 pr-10 text-sm text-zinc-900 outline-none placeholder:text-xs placeholder:text-zinc-400 focus:border-zinc-400 disabled:bg-zinc-50" />
            <button type="button" aria-label={`${visible[field.name] ? "Hide" : "Show"} ${field.label.toLowerCase()}`} aria-pressed={!!visible[field.name]} onClick={() => setVisible(current => ({ ...current, [field.name]: !current[field.name] }))} className="absolute inset-y-0 right-0 flex w-10 cursor-pointer items-center justify-center text-zinc-400 transition-colors hover:text-zinc-700 focus-visible:outline-2 focus-visible:outline-zinc-500" disabled={pending}>
              {visible[field.name] ? <Eye aria-hidden="true" className="size-4" /> : <EyeOff aria-hidden="true" className="size-4" />}
            </button>
          </div>
        </div>)}
        <p className="text-xs leading-5 text-zinc-500">Use at least 8 characters for your new password.</p>
        {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
        {state.success && <p role="status" className="text-sm text-emerald-700">{state.success}</p>}
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 px-5 py-4">
        <span className="text-xs text-zinc-500"><span className="text-red-500">*</span> Required fields</span>
        <button
          type="submit"
          disabled={pending}
          className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving..." : "Change password"}
        </button>
      </div>
    </form>
  );
}
