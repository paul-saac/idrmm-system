"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { createAccount, type AccountActionState } from "@/lib/accounts/actions";
import { roleLabel, type UserRole } from "@/lib/auth/roles";

const initialState: AccountActionState = {};

function generatePassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes))
    .replace(/[+/=]/g, "")
    .slice(0, 12);
}

export function CreateAccountForm({
  roleOptions,
  onSuccess,
}: {
  roleOptions: UserRole[];
  onSuccess?: () => void;
}) {
  const [state, formAction, pending] = useActionState(createAccount, initialState);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(true);
  const fixedRole = roleOptions.length === 1 ? roleOptions[0] : null;
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      // The password field is controlled (needed for the generate/show
      // buttons), so form.reset() alone won't clear its displayed value —
      // this syncs it back. One-shot reaction to the server action
      // completing, not a render loop.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPassword("");
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
        <label htmlFor="firstName" className="text-sm font-medium text-zinc-800">
          First name
        </label>
        <input
          id="firstName"
          name="firstName"
          required
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="lastName" className="text-sm font-medium text-zinc-800">
          Last name
        </label>
        <input
          id="lastName"
          name="lastName"
          required
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium text-zinc-800">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium text-zinc-800">
          Temporary password
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
            placeholder="At least 8 characters"
            className="w-full rounded-md border border-zinc-200 px-3 py-2 pr-16 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
          <div className="absolute inset-y-0 right-0 flex items-center gap-1 pr-2">
            <button
              type="button"
              onClick={() => setPassword(generatePassword())}
              aria-label="Generate password"
              title="Generate password"
              className="text-zinc-400 hover:text-zinc-600"
            >
              <RefreshCw className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="text-zinc-400 hover:text-zinc-600"
            >
              {showPassword ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      {fixedRole ? (
        <input type="hidden" name="role" value={fixedRole} />
      ) : (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="role" className="text-sm font-medium text-zinc-800">
            Role
          </label>
          <select
            id="role"
            name="role"
            required
            defaultValue=""
            className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          >
            <option value="" disabled>
              Select a role
            </option>
            {roleOptions.map((role) => (
              <option key={role} value={role}>
                {roleLabel(role)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:col-span-2">
        <p className="text-xs text-zinc-500">
          Share this password with the new user out of band — they can change
          it after logging in from the &quot;Forgot password?&quot; link.
        </p>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Creating..." : "Create account"}
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
