import { AccountRowActions } from "@/components/accounts/account-row-actions";
import {
  BLANK,
  BODY,
  CELL,
  HEAD_CELL,
  HEAD_ROW,
  InitialsAvatar,
  SelectAllCell,
  SelectCell,
  TABLE,
  TABLE_FRAME,
  rowClass,
} from "@/components/ui/list-table";
import { roleLabel } from "@/lib/auth/roles";
import type { AccountRow, AssignedProject } from "@/lib/accounts/data";

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Every project they're on, one per line. */
function AssignedProjectsCell({ projects }: { projects: AssignedProject[] }) {
  if (projects.length === 0) return BLANK;
  return (
    <ul className="flex flex-col gap-0.5">
      {projects.map((project) => (
        <li key={project.id} className="whitespace-nowrap">
          {project.name}
        </li>
      ))}
    </ul>
  );
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
    <div className={TABLE_FRAME}>
      <table className={TABLE}>
        <thead>
          <tr className={HEAD_ROW}>
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
            <th className={HEAD_CELL}>Assigned Projects</th>
            <th className={HEAD_CELL}>Last Sign-in</th>
            <th className={HEAD_CELL}>Date Created</th>
            <th className={HEAD_CELL}>Actions</th>
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
                className={`cursor-pointer ${rowClass(checked)}`}
              >
                <SelectCell
                  checked={checked}
                  onChange={() => onCheck([account.id], !checked)}
                  label={`Select ${name || account.email}`}
                />
                <td className={CELL}>
                  <div className="flex items-center gap-2.5">
                    <InitialsAvatar name={name || account.email} />
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
                      account.status === "active"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {account.status === "active" ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className={CELL}>
                  <AssignedProjectsCell projects={account.assignedProjects} />
                </td>
                <td className={`${CELL} whitespace-nowrap`}>
                  {account.lastSignInAt ? formatDateTime(account.lastSignInAt) : BLANK}
                </td>
                <td className={`${CELL} whitespace-nowrap text-zinc-500`}>
                  {formatDateTime(account.createdAt)}
                </td>
                <td className={CELL} onClick={(e) => e.stopPropagation()}>
                  <AccountRowActions account={account} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
