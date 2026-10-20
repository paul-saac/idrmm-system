import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/page-header";
import { ReportsView } from "@/components/reports/reports-view";
import { listProjects } from "@/lib/projects/data";
import { getCloseoutReport } from "@/lib/reports/closeout-data";

export const metadata: Metadata = { title: "Reports" };

// Same as the admin Reports page — listProjects is already limited to the
// foreman's assigned projects by row-level security, so a projectId for
// any other project falls back to their first one below.
export default async function ForemanReportsPage({
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
