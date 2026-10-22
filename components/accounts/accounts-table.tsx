import {
  BLANK,
  BODY,
  CELL,
  HEAD_CELL,
  InitialsAvatar,
  SelectAllCell,
  SelectCell,
  TABLE,
} from "@/components/ui/list-table";
import { roleLabel } from "@/lib/auth/roles";
import type { AccountRow } from "@/lib/accounts/data";

function formatDateTime(iso: string) {
  const date = new Date(iso);
  return <div className="space-y-1"><p className="text-zinc-700">{date.toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Manila",
  })}</p><p className="text-xs text-zinc-400">{date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Manila" })}</p></div>;
}

/** The accounts list, in the Team table's own style (see list-table). */
export function AccountsTable({
  accounts,
  showRoleColumn = false,
  selected,
  onCheck,
  onOpen,
}: {
  accounts: AccountRow[];
  showRoleColumn?: boolean;
  /** Checked account ids. */
  selected: ReadonlySet<string>;
  onCheck: (ids: string[], checked: boolean) => void;
  /** Opens one account's own window. */
  onOpen: (id: string) => void;
}) {
  const ids = accounts.map((account) => account.id);
  const checkedCount = ids.filter((id) => selected.has(id)).length;
  const allChecked = checkedCount === ids.length;

  return (
    <div className="overflow-x-auto">
      <table className={`${TABLE} [&_tbody_td]:py-5`}>
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
            <SelectAllCell
              checked={allChecked}
              indeterminate={checkedCount > 0 && !allChecked}
              onChange={() => onCheck(ids, !allChecked)}
              label="Select all users"
            />
            <th className={HEAD_CELL}>Name</th>
            <th className={HEAD_CELL}>Email</th>
            {showRoleColumn && <th className={HEAD_CELL}>Role</th>}
            <th className={HEAD_CELL}>Status</th>
            <th className={HEAD_CELL}>Last Sign-in</th>
            <th className={HEAD_CELL}>Date Created</th>
          </tr>
        </thead>
        <tbody className={BODY}>
          {accounts.map((account) => {
            const name = `${account.firstName} ${account.lastName}`.trim();
            const checked = selected.has(account.id);
            return (
              <tr
                key={account.id}
                onClick={() => onOpen(account.id)}
                className={`cursor-pointer transition-colors ${checked ? "bg-zinc-100" : "hover:bg-zinc-50"}`}
              >
                <SelectCell
                  checked={checked}
                  onChange={() => onCheck([account.id], !checked)}
                  label={`Select ${name || account.email}`}
                />
                <td className={CELL}>
                  <div className="flex items-center gap-2.5">
                    <InitialsAvatar name={name || account.email} neutral />
                    {/* Its click is the row's (bubbles up). */}
                    <button
                      type="button"
                      className="cursor-pointer text-left font-medium whitespace-nowrap text-zinc-900"
                    >
                      {name || "—"}
                    </button>
                  </div>
                </td>
                <td className={CELL}>{account.email}</td>
                {showRoleColumn && (
                  <td className={`${CELL} whitespace-nowrap`}>{roleLabel(account.role)}</td>
                )}
                <td className={CELL}>
                  <span
                    className={`rounded-sm px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
                      account.status === "active" && !account.invitationPending
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {account.status === "inactive" ? "Inactive" : account.invitationPending ? "Invited" : "Active"}
                  </span>
                </td>
                <td className={`${CELL} whitespace-nowrap`}>
                  {account.lastSignInAt ? formatDateTime(account.lastSignInAt) : BLANK}
                </td>
                <td className={`${CELL} whitespace-nowrap text-zinc-500`}>
                  {formatDateTime(account.createdAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
