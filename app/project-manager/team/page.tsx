import type { Metadata } from "next";
import {
  listAssignments,
  listHoursWorked,
  listMemberGroups,
  listWorkers,
} from "@/lib/workers/data";
import { AdminPageHeader } from "@/components/admin/page-header";
import { TeamBrowser } from "@/components/team/team-browser";

export const metadata: Metadata = { title: "Team" };

// A project manager's Team: every member to view (adding, editing and
// removing them is the admin's), and groups to create and manage.
export default async function ProjectManagerTeamPage() {
  const [members, assignments, groups, hoursWorked] = await Promise.all([
    listWorkers(),
    listAssignments(),
    listMemberGroups(),
    listHoursWorked(),
  ]);

  return (
    <>
      <AdminPageHeader title="Team" />
      <main className="flex flex-1 flex-col overflow-y-auto">
        <TeamBrowser
          members={members}
          assignments={assignments}
          accounts={[]}
          memberGroups={groups}
          hoursWorked={hoursWorked}
          canManageMembers={false}
        />
      </main>
    </>
  );
}
