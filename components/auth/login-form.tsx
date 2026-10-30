"use client";

import { RequiredMark } from "@/components/ui/required-mark";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Eye, EyeOff, LockKeyhole, UserRound } from "lucide-react";
import { login, type AuthActionState } from "@/lib/auth/actions";

const initialState: AuthActionState = {};

export function LoginForm({ initialError }: { initialError?: string }) {
  const [state, formAction, pending] = useActionState(login, initialState);
  const [showPassword, setShowPassword] = useState(false);

  const error = state?.error ?? initialError;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="email"
          className="text-[0.6875rem] font-medium text-zinc-900"
        >
          Username<RequiredMark /></label>
        <div className="relative">
        <UserRound aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-zinc-400" />
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          placeholder="Enter your username"
          required
          className="h-9 w-full rounded border border-zinc-200 bg-white pr-3 pl-7 text-xs text-zinc-900 placeholder:text-zinc-400 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
        />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label
            htmlFor="password"
            className="text-[0.6875rem] font-medium text-zinc-900"
          >
            Password<RequiredMark /></label>
          <Link
            href="/forgot-password"
            className="text-[0.6875rem] text-zinc-900 underline underline-offset-2 hover:text-zinc-600"
          >
            Forgot password?
          </Link>
        </div>
        <div className="relative">
          <LockKeyhole aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Enter your password"
            required
            className="h-9 w-full rounded border border-zinc-200 bg-white pr-8 pl-7 text-xs text-zinc-900 placeholder:text-zinc-400 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 flex cursor-pointer items-center px-2.5 text-zinc-400 hover:text-zinc-600"
          >
            {showPassword ? (
              <EyeOff className="size-3.5" />
            ) : (
              <Eye className="size-3.5" />
            )}
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-xs leading-relaxed text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 flex h-9 w-full cursor-pointer items-center justify-center rounded bg-zinc-900 px-3 text-xs font-semibold text-white transition hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Signing in..." : "Sign In to Dashboard"}
      </button>
    </form>
  );
}
