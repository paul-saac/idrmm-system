"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  requestPasswordReset,
  type AuthActionState,
} from "@/lib/auth/actions";

const initialState: AuthActionState = {};

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(
    requestPasswordReset,
    initialState
  );

  if (state?.success) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-zinc-700">{state.success}</p>
        <Link
          href="/"
          className="text-sm font-medium text-zinc-900 hover:underline"
        >
          Back to login
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium text-zinc-800">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          placeholder="Enter your mail address"
          required
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      {state?.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 w-full rounded bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Sending..." : "Send reset link"}
      </button>

      <Link
        href="/"
        className="text-center text-sm font-medium text-zinc-600 hover:text-zinc-900 hover:underline"
      >
        Back to login
      </Link>
    </form>
  );
}
