import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { AccountRowActions } from "@/components/accounts/account-row-actions";
import { roleLabel } from "@/lib/auth/roles";
import type { AccountRow, AssignedProject } from "@/lib/accounts/data";

export type SortKey = "name" | "status" | "createdAt";
export type SortDir = "asc" | "desc";

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

function SortableHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = sortKey === activeKey;
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ChevronUp : ChevronDown;

  return (
    <th className="px-4 py-2.5 font-medium">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`flex cursor-pointer items-center gap-1 transition-colors hover:text-zinc-900 ${
          active ? "text-zinc-900" : ""
        }`}
      >
        {label}
        <Icon className="size-3.5" />
      </button>
    </th>
  );
}

function AssignedProjectsCell({ projects }: { projects: AssignedProject[] }) {
  if (projects.length === 0) {
    return <span className="text-zinc-400">No projects</span>;
  }

  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-zinc-700 transition-colors hover:text-zinc-900 [&::-webkit-details-marker]:hidden">
        {projects.length} project{projects.length === 1 ? "" : "s"}
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <ul className="mt-1 flex flex-col gap-0.5">
        {projects.map((project) => (
          <li
            key={project.id}
            className="max-w-50 truncate text-xs text-zinc-500"
            title={project.name}
          >
            {project.name}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function AccountsTable({
  accounts,
  showRoleColumn = false,
  sortKey,
  sortDir,
  onSort,
}: {
  accounts: AccountRow[];
  showRoleColumn?: boolean;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            <SortableHeader
              label="Full name"
              sortKey="name"
              activeKey={sortKey}
              dir={sortDir}
              onSort={onSort}
            />
            <th className="px-4 py-2.5 font-medium">Email</th>
            {showRoleColumn && (
              <th className="px-4 py-2.5 font-medium">Role</th>
            )}
            <SortableHeader
              label="Status"
              sortKey="status"
              activeKey={sortKey}
              dir={sortDir}
              onSort={onSort}
            />
            <th className="px-4 py-2.5 font-medium">Assigned Projects</th>
            <SortableHeader
              label="Date Created"
              sortKey="createdAt"
              activeKey={sortKey}
              dir={sortDir}
              onSort={onSort}
            />
            <th className="px-4 py-2.5 font-medium text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {accounts.map((account) => (
            <tr key={account.id} className="transition-colors hover:bg-zinc-50">
              <td className="px-4 py-2.5 text-zinc-900">
                {`${account.firstName} ${account.lastName}`.trim() || "—"}
              </td>
              <td className="px-4 py-2.5">
                <a
                  href={`mailto:${account.email}`}
                  className="text-sky-700 hover:underline"
                >
                  {account.email}
                </a>
              </td>
              {showRoleColumn && (
                <td className="px-4 py-2.5 text-zinc-600">
                  {roleLabel(account.role)}
                </td>
              )}
              <td className="px-4 py-2.5">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    account.status === "active"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {account.status === "active" ? "Active" : "Inactive"}
                </span>
              </td>
              <td className="px-4 py-2.5 text-zinc-600">
                <AssignedProjectsCell projects={account.assignedProjects} />
              </td>
              <td className="px-4 py-2.5 text-zinc-500">
                {formatDateTime(account.createdAt)}
              </td>
              <td className="px-4 py-2.5">
                <AccountRowActions account={account} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
