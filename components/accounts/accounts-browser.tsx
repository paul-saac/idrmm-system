"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Search, UserCheck, UserX } from "lucide-react";
import { FilterSelect } from "@/components/ui/filter-select";
import { Modal } from "@/components/ui/modal";
import { CreateAccountForm } from "@/components/accounts/create-account-form";
import { AccountsTable } from "@/components/accounts/accounts-table";
import { AccountDetail } from "@/components/accounts/account-detail";
import { setAccountsStatus } from "@/lib/accounts/actions";
import { roleLabel, type UserRole } from "@/lib/auth/roles";
import type { AccountRow } from "@/lib/accounts/data";

// The toolbar's own buttons — Invite User, and the checked rows' Activate /
// Deactivate beside it (the Team page's toolbar style).
const TOOLBAR_BUTTON =
  "flex cursor-pointer items-center gap-1.5 rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";

export function AccountsBrowser({
  accounts,
  roleOptions,
  isSuperAdmin = false,
}: {
  accounts: AccountRow[];
  roleOptions: UserRole[];
  /** Sees each account's change log, and may delete one for good. */
  isSuperAdmin?: boolean;
}) {
  const router = useRouter();
  // ?search= — from a Team member's own "Manage in Accounts" link.
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(() => searchParams.get("search") ?? "");
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");
  const [addOpen, setAddOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // Fresh from `accounts`, so the window follows every refresh — and
  // closes once the account's gone (deleted).
  const openAccount = openId ? accounts.find((account) => account.id === openId) : undefined;
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, setPending] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const showRoleColumn = roleOptions.length > 1;

  // By name.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts
      .filter((account) => {
        const matchesRole = roleFilter === "all" || account.role === roleFilter;
        const name = `${account.firstName} ${account.lastName}`.toLowerCase();
        const matchesQuery = !q || name.includes(q) || account.email.toLowerCase().includes(q);
        return matchesRole && matchesQuery;
      })
      .sort((a, b) =>
        `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, undefined, {
          sensitivity: "base",
        })
      );
  }, [accounts, query, roleFilter]);

  // Only what's on screen counts — a checked account the search or filter
  // hides isn't touched.
  const selectedAccounts = filtered.filter((account) => selected.has(account.id));
  const toActivate = selectedAccounts.filter((account) => account.status === "inactive");
  const toDeactivate = selectedAccounts.filter((account) => account.status === "active");

  function setChecked(ids: string[], checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function changeStatus(targets: AccountRow[], status: "active" | "inactive") {
    if (
      status === "inactive" &&
      !window.confirm(
        `Deactivate ${targets.length} account${targets.length === 1 ? "" : "s"}? They won't be able to sign in until reactivated.`
      )
    ) {
      return;
    }
    setBulkError(null);
    setPending(true);
    const result = await setAccountsStatus(
      targets.map((account) => account.id),
      status
    );
    setPending(false);
    if (result.error) {
      setBulkError(result.error);
      return;
    }
    setSelected(new Set());
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-baseline gap-2 text-base font-semibold text-zinc-900">
          {roleFilter === "all" ? "All users" : roleFilter === "foreman" ? "Foremen" : `${roleLabel(roleFilter)}s`}
          <span className="text-xs font-normal tabular-nums text-zinc-400">{filtered.length}</span>
        </h2>
        <div className="ml-auto flex flex-wrap items-center gap-3">
        <div className="relative w-72 max-w-full">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or email"
            aria-label="Search name or email"
            className="w-full rounded-md border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        </div>

        {showRoleColumn && (
          <FilterSelect
            label="Role"
            value={roleFilter}
            options={roleOptions.map((role) => ({ value: role, label: roleLabel(role) }))}
            onChange={setRoleFilter}
          />
        )}

        <button type="button" onClick={() => setAddOpen(true)} className="flex items-center gap-1.5 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"><Plus className="size-4" />Invite User</button>
        </div>
        <div className="flex flex-wrap items-center gap-3 empty:hidden">
          {selectedAccounts.length > 0 && (
            <>
              <span className="text-sm font-medium text-zinc-900">
                {selectedAccounts.length} selected
              </span>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="cursor-pointer text-sm font-medium text-zinc-500 transition hover:text-zinc-900"
              >
                Clear
              </button>
              {toActivate.length > 0 && (
                <button
                  type="button"
                  onClick={() => changeStatus(toActivate, "active")}
                  disabled={pending}
                  className={`${TOOLBAR_BUTTON} text-emerald-700 hover:border-emerald-600 hover:bg-emerald-600 hover:text-white`}
                >
                  <UserCheck className="size-4" />
                  Activate
                </button>
              )}
              {toDeactivate.length > 0 && (
                <button
                  type="button"
                  onClick={() => changeStatus(toDeactivate, "inactive")}
                  disabled={pending}
                  className={`${TOOLBAR_BUTTON} text-red-600 hover:border-red-600 hover:bg-red-600 hover:text-white`}
                >
                  <UserX className="size-4" />
                  Deactivate
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {bulkError && (
        <p role="alert" className="px-5 py-3 text-sm text-red-600">
          {bulkError}
        </p>
      )}

      <div className="overflow-hidden rounded border border-zinc-200 bg-white">
      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-400">
          {accounts.length === 0 ? "No users yet." : "No users match."}
        </p>
      ) : (
        <AccountsTable
          accounts={filtered}
          showRoleColumn={showRoleColumn}
          selected={selected}
          onCheck={setChecked}
          onOpen={setOpenId}
        />
      )}

      <div className="border-t border-zinc-200 px-5 py-4 text-xs text-zinc-500">Showing {filtered.length} of {accounts.length} users</div>
      </div>
      <Modal
        open={openAccount !== undefined}
        onClose={() => setOpenId(null)}
        title="Manage account"
        size="wide"
      >
        {openAccount && (
          <AccountDetail
            key={openAccount.id}
            account={openAccount}
            accounts={accounts}
            roleOptions={roleOptions}
            isSuperAdmin={isSuperAdmin}
            onClose={() => setOpenId(null)}
          />
        )}
      </Modal>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Invite User">
        <CreateAccountForm roleOptions={roleOptions} onSuccess={() => setAddOpen(false)} />
      </Modal>
    </div>
  );
}
