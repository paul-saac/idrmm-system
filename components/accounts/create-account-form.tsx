"use client";

import { RequiredMark } from "@/components/ui/required-mark";
import { ChevronDown } from "lucide-react";
import { useActionState, useEffect, useRef } from "react";
import { createAccount, type AccountActionState } from "@/lib/accounts/actions";
import { roleLabel, type UserRole } from "@/lib/auth/roles";

const initialState: AccountActionState = {};

export function CreateAccountForm({
  roleOptions,
  onSuccess,
}: {
  roleOptions: UserRole[];
  onSuccess?: () => void;
}) {
  const [state, formAction, pending] = useActionState(createAccount, initialState);
  const fixedRole = roleOptions.length === 1 ? roleOptions[0] : null;
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      onSuccess?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="grid gap-4 sm:grid-cols-2"
      noValidate
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="firstName" className="text-sm font-medium text-zinc-900">
          First name<RequiredMark /></label>
        <input
          id="firstName"
          name="firstName"
          required
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="lastName" className="text-sm font-medium text-zinc-900">
          Last name<RequiredMark /></label>
        <input
          id="lastName"
          name="lastName"
          required
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium text-zinc-900">
          Email<RequiredMark /></label>
        <input
          id="email"
          name="email"
          type="email"
          required
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      {fixedRole ? (
        <input type="hidden" name="role" value={fixedRole} />
      ) : (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="role" className="text-sm font-medium text-zinc-900">
            Role<RequiredMark /></label>
          <div className="relative">
            <select
              id="role"
              name="role"
              required
              defaultValue=""
              className="w-full appearance-none rounded-md border border-zinc-200 bg-white py-2 pr-9 pl-3 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
            >
              <option value="" disabled hidden>
                Select a role
              </option>
              {roleOptions.map((role) => (
                <option key={role} value={role}>
                  {roleLabel(role)}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-zinc-400" />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:col-span-2">
        <p className="text-xs text-zinc-500">
          An invitation email lets this person set their own password. Their role is assigned by you.
        </p>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Sending..." : "Send invitation"}
          </button>
          {state?.error && (
            <p role="alert" className="text-sm text-red-600">
              {state.error}
            </p>
          )}
          {state?.success && (
            <p className="text-sm text-emerald-600">{state.success}</p>
          )}
        </div>
      </div>
    </form>
  );
}
