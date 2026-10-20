"use client";

import { useActionState } from "react";
import { UserCheck, UserX } from "lucide-react";
import { ICON_BUTTON } from "@/components/ui/list-table";
import { setAccountStatus, type AccountActionState } from "@/lib/accounts/actions";
import type { AccountRow } from "@/lib/accounts/data";

const initialState: AccountActionState = {};

/** A row's own Activate/Deactivate — an icon, like the Team table's
 * row actions. */
export function AccountRowActions({ account }: { account: AccountRow }) {
  const active = account.status === "active";
  const toggleAction = setAccountStatus.bind(null, account.id, active ? "inactive" : "active");
  const [state, formAction, pending] = useActionState(toggleAction, initialState);

  const fullName = `${account.firstName} ${account.lastName}`.trim();
  const label = active ? "Deactivate" : "Activate";

  return (
    <div className="flex flex-col items-start gap-1">
      <form
        action={formAction}
        onSubmit={(e) => {
          // Deactivating locks the person out immediately — confirm first.
          // Re-activating is low-risk, so it submits straight away.
          if (
            active &&
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
          title={label}
          aria-label={`${label} ${fullName || account.email}`}
          className={`${ICON_BUTTON} border border-zinc-200 ${
            active
              ? "hover:bg-red-50 hover:text-red-600"
              : "hover:bg-emerald-50 hover:text-emerald-600"
          }`}
        >
          {active ? <UserX className="size-3.5" /> : <UserCheck className="size-3.5" />}
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
