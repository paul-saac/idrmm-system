import { FolderKanban, CheckCircle2, PackageSearch, Wrench } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { StatCard } from "@/components/admin/dashboard/stat-card";
import { ActiveProjectsCard } from "@/components/admin/dashboard/active-projects-card";
import { NotificationsCard } from "@/components/admin/dashboard/notifications-card";
import { PendingApprovalsCard } from "@/components/admin/dashboard/pending-approvals-card";
import { RecentActivityCard } from "@/components/admin/dashboard/recent-activity-card";
import { ResourcesCard } from "@/components/admin/dashboard/resources-card";
import type { PortalBasePath } from "@/components/portal/portal-context";
import { getDashboardData } from "@/lib/dashboard/data";

// Shared by both portals' dashboards — RLS scopes the data (an admin
// sees every project, a foreman their own).
export async function DashboardView({ basePath }: { basePath: PortalBasePath }) {
  const data = await getDashboardData();
  const isAdmin = basePath === "/admin";

  return (
    <>
      <AdminPageHeader title="Dashboard" />

      <main className="flex-1 overflow-y-auto px-8 py-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Ongoing Projects"
            value={data.stats.ongoingProjects}
            icon={FolderKanban}
          />
          <StatCard
            label="Completed Projects"
            value={data.stats.completedProjects}
            icon={CheckCircle2}
          />
          <StatCard
            label="Pending Material Requests"
            value={data.stats.pendingMaterialRequests}
            icon={PackageSearch}
          />
          <StatCard
            label="Pending Equipment Requests"
            value={data.stats.pendingEquipmentRequests}
            icon={Wrench}
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="flex flex-col gap-4 lg:col-span-2">
            <ActiveProjectsCard basePath={basePath} projects={data.activeProjects} />
            <RecentActivityCard basePath={basePath} items={data.recentActivity} />
          </div>
          <div className="flex flex-col gap-4">
            <NotificationsCard />
            <PendingApprovalsCard
              basePath={basePath}
              items={data.pendingRequests}
              total={data.stats.pendingMaterialRequests + data.stats.pendingEquipmentRequests}
            />
            <ResourcesCard
              basePath={basePath}
              isAdmin={isAdmin}
              team={data.team}
              equipment={data.equipment}
            />
          </div>
        </div>
      </main>
    </>
  );
}
