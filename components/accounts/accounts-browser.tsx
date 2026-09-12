"use client";

import { useMemo, useState } from "react";
import { Search, Plus, ChevronDown } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { CreateAccountForm } from "@/components/accounts/create-account-form";
import {
  AccountsTable,
  type SortDir,
  type SortKey,
} from "@/components/accounts/accounts-table";
import { roleLabel, type UserRole } from "@/lib/auth/roles";
import type { AccountRow } from "@/lib/accounts/data";

export function AccountsBrowser({
  accounts,
  roleOptions,
}: {
  accounts: AccountRow[];
  roleOptions: UserRole[];
}) {
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");
  const [addOpen, setAddOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const showRoleColumn = roleOptions.length > 1;

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = accounts.filter((account) => {
      const matchesRole = roleFilter === "all" || account.role === roleFilter;
      const name = `${account.firstName} ${account.lastName}`.toLowerCase();
      const matchesQuery =
        !q || name.includes(q) || account.email.toLowerCase().includes(q);
      return matchesRole && matchesQuery;
    });

    const sorted = [...rows].sort((a, b) => {
      let comparison = 0;
      if (sortKey === "name") {
        const nameA = `${a.firstName} ${a.lastName}`.toLowerCase();
        const nameB = `${b.firstName} ${b.lastName}`.toLowerCase();
        comparison = nameA.localeCompare(nameB);
      } else if (sortKey === "status") {
        comparison = a.status.localeCompare(b.status);
      } else {
        comparison =
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      return sortDir === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [accounts, query, roleFilter, sortKey, sortDir]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-55 max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search User by name, username..."
            className="w-full rounded-md border border-zinc-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        </div>

        {showRoleColumn && (
          <div className="relative">
            <select
              value={roleFilter}
              onChange={(e) =>
                setRoleFilter(e.target.value as UserRole | "all")
              }
              className="cursor-pointer appearance-none rounded-md border border-zinc-200 bg-white py-2 pl-3 pr-8 text-sm font-medium text-zinc-700 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
            >
              <option value="all">Role</option>
              {roleOptions.map((role) => (
                <option key={role} value={role}>
                  {roleLabel(role)}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          </div>
        )}

        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="ml-auto flex cursor-pointer items-center gap-1.5 rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-zinc-900 hover:bg-zinc-900 hover:text-white hover:shadow-md active:translate-y-0"
        >
          <Plus className="size-4" />
          Add User
        </button>
      </div>

      <p className="text-sm text-zinc-500">
        Showing {filtered.length} of {accounts.length} user
        {accounts.length === 1 ? "" : "s"}
      </p>

      <AccountsTable
        accounts={filtered}
        showRoleColumn={showRoleColumn}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
      />

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add User">
        <CreateAccountForm
          roleOptions={roleOptions}
          onSuccess={() => setAddOpen(false)}
        />
      </Modal>
    </div>
  );
}
