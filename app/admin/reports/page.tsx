import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/page-header";
import { ReportsView } from "@/components/reports/reports-view";
import { listProjects } from "@/lib/projects/data";
import { getReportData } from "@/lib/reports/data";

export const metadata: Metadata = { title: "Reports" };

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const projects = await listProjects();

  const requestedId = params.projectId ? Number(params.projectId) : null;
  const selectedProjectId =
    requestedId && projects.some((p) => p.id === requestedId)
      ? requestedId
      : (projects[0]?.id ?? null);

  const range = { from: params.from || null, to: params.to || null };

  const data = selectedProjectId
    ? await getReportData(selectedProjectId, range)
    : null;

  return (
    <>
      <AdminPageHeader
        title="Reports"
        description="Per-project cost, progress, and expense reporting."
      />
      <main className="flex-1 overflow-y-auto px-8 py-6">
        <ReportsView
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          selectedProjectId={selectedProjectId}
          data={data}
          range={range}
        />
      </main>
    </>
  );
}
