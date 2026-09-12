"use client";

import { useActionState } from "react";
import { setAccountStatus, type AccountActionState } from "@/lib/accounts/actions";
import type { AccountRow } from "@/lib/accounts/data";

const initialState: AccountActionState = {};

export function AccountRowActions({ account }: { account: AccountRow }) {
  const nextStatus = account.status === "active" ? "inactive" : "active";
  const toggleAction = setAccountStatus.bind(null, account.id, nextStatus);
  const [state, formAction, pending] = useActionState(
    toggleAction,
    initialState
  );

  const fullName = `${account.firstName} ${account.lastName}`.trim();

  return (
    <div className="flex flex-col items-end gap-1">
      <form
        action={formAction}
        onSubmit={(e) => {
          // Deactivating locks the person out immediately — confirm first.
          // Re-activating is low-risk, so it submits straight away.
          if (
            account.status === "active" &&
            !window.confirm(
              `Deactivate ${fullName || account.email}? They won't be able to sign in until reactivated.`
            )
          ) {
            e.preventDefault();
          }
        }}
      >
        <button
          type="submit"
          disabled={pending}
          className={`cursor-pointer rounded border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
            account.status === "active"
              ? "border-amber-200 text-amber-700 hover:bg-amber-50"
              : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
          }`}
        >
          {pending
            ? "..."
            : account.status === "active"
              ? "Deactivate"
              : "Activate"}
        </button>
      </form>
      {state?.error && (
        <p role="alert" className="text-xs text-red-600">
          {state.error}
        </p>
      )}
    </div>
  );
}
