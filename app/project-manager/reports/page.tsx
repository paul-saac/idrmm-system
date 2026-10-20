import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/page-header";
import { ReportsView } from "@/components/reports/reports-view";
import { listProjects } from "@/lib/projects/data";
import { getCloseoutReport } from "@/lib/reports/closeout-data";

export const metadata: Metadata = { title: "Reports" };

export default async function ProjectManagerReportsPage({
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

  const data = selectedProjectId
    ? await getCloseoutReport(selectedProjectId)
    : null;

  return (
    <>
      <AdminPageHeader
        title="Reports"
        description="Per-project cost, progress, and expense reporting for your assigned projects."
      />
      <main className="flex flex-1 flex-col overflow-y-auto bg-white">
        <ReportsView
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          selectedProjectId={selectedProjectId}
          data={data}
        />
      </main>
    </>
  );
}
