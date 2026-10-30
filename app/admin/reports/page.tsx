import { ProjectAccessProvider } from "@/components/projects/project-access-context";
import { getProjectAccessLevel } from "@/lib/auth/project-access";
import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/page-header";
import { ReportsView } from "@/components/reports/reports-view";
import { listProjects } from "@/lib/projects/data";
import { getCloseoutReport } from "@/lib/reports/closeout-data";

export const metadata: Metadata = { title: "Reports" };

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const projects = await listProjects({ includeArchived: true });

  const requestedId = params.projectId ? Number(params.projectId) : null;
  const selectedProjectId =
    requestedId && projects.some((p) => p.id === requestedId)
      ? requestedId
      : (projects[0]?.id ?? null);

  const data = selectedProjectId
    ? await getCloseoutReport(selectedProjectId)
    : null;

  const canEditProject = selectedProjectId ? (await getProjectAccessLevel(selectedProjectId)) === "edit" : false;

  return (
    <>
      <AdminPageHeader
        title="Reports"
        description="Per-project cost, progress, and expense reporting."
      />
      <main className="flex flex-1 flex-col overflow-y-auto bg-white">
        <ProjectAccessProvider canEdit={canEditProject}>
        <ReportsView
          projects={projects.map((p) => ({ id: p.id, name: p.archivedAt ? `${p.name} (Archived)` : p.name }))}
          selectedProjectId={selectedProjectId}
          data={data}
        />
        </ProjectAccessProvider>
      </main>
    </>
  );
}
