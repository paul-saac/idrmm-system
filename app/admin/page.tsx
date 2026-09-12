import type { Metadata } from "next";
import { FolderKanban, CheckCircle2, PackageSearch, Wrench } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { StatCard } from "@/components/admin/dashboard/stat-card";
import { RecentActivityCard } from "@/components/admin/dashboard/recent-activity-card";
import { PendingApprovalsCard } from "@/components/admin/dashboard/pending-approvals-card";
import { ActiveProjectCard } from "@/components/admin/dashboard/active-project-card";
import {
  MOCK_STATS,
  MOCK_RECENT_ACTIVITY,
  MOCK_PENDING_APPROVALS,
  MOCK_ACTIVE_PROJECT,
} from "@/lib/admin/dashboard-mock-data";

export const metadata: Metadata = { title: "Dashboard" };

export default function AdminDashboardPage() {
  return (
    <>
      <AdminPageHeader title="Dashboard" />

      <main className="flex-1 overflow-y-auto px-8 py-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Ongoing Projects"
            value={MOCK_STATS.ongoingProjects}
            icon={FolderKanban}
          />
          <StatCard
            label="Completed Projects"
            value={MOCK_STATS.completedProjects}
            icon={CheckCircle2}
          />
          <StatCard
            label="Material Requests"
            value={MOCK_STATS.materialRequests}
            icon={PackageSearch}
          />
          <StatCard
            label="Equipment Requests"
            value={MOCK_STATS.equipmentRequests}
            icon={Wrench}
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <RecentActivityCard items={MOCK_RECENT_ACTIVITY} />
          <div className="flex flex-col gap-4">
            <PendingApprovalsCard items={MOCK_PENDING_APPROVALS} />
            <ActiveProjectCard project={MOCK_ACTIVE_PROJECT} />
          </div>
        </div>
      </main>
    </>
  );
}
