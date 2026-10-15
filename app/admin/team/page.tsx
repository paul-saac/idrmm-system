import type { Metadata } from "next";
import { listAccountsByRole } from "@/lib/accounts/data";
import {
  listAssignments,
  listHoursWorked,
  listMemberGroups,
  listWorkers,
} from "@/lib/workers/data";
import { AdminPageHeader } from "@/components/admin/page-header";
import { TeamBrowser } from "@/components/team/team-browser";

export const metadata: Metadata = { title: "Team" };

export default async function AdminTeamPage() {
  const [members, assignments, accountRows, groups, hoursWorked] = await Promise.all([
    listWorkers(),
    listAssignments(),
    listAccountsByRole(["project_manager", "foreman"]),
    listMemberGroups(),
    listHoursWorked(),
  ]);
  // Only what the Team page needs of each account — a member can be
  // linked to one (see LinkableAccount).
  const accounts = accountRows.map((account) => ({
    id: account.id,
    name: `${account.firstName} ${account.lastName}`.trim(),
    email: account.email,
    role: account.role === "foreman" ? ("foreman" as const) : ("project_manager" as const),
    active: account.status === "active",
  }));

  return (
    <>
      <AdminPageHeader title="Team" />
      <main className="flex-1 overflow-y-auto px-8 py-6">
        <TeamBrowser
          members={members}
          assignments={assignments}
          accounts={accounts}
          memberGroups={groups}
          hoursWorked={hoursWorked}
        />
      </main>
    </>
  );
}
