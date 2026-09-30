import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/page-header";
import { ReportsView } from "@/components/reports/reports-view";
import { listProjects } from "@/lib/projects/data";
import { getReportData } from "@/lib/reports/data";

export const metadata: Metadata = { title: "Reports" };

// Same as the admin Reports page — listProjects is already limited to the
// foreman's assigned projects by row-level security, so a projectId for
// any other project falls back to their first one below.
//
// DAILY LOGS — ON HOLD: the expense figures in reports are built from
// daily log entries, which foremen can't read yet, so those read as empty.
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

  const range = { from: params.from || null, to: params.to || null };

  const data = selectedProjectId
    ? await getReportData(selectedProjectId, range)
    : null;

  return (
    <>
      <AdminPageHeader
        title="Reports"
        description="Per-project cost, progress, and expense reporting for your assigned projects."
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
