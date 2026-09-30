import type { Metadata } from "next";
import { listProjects } from "@/lib/projects/data";
import { AdminPageHeader } from "@/components/admin/page-header";
import { ProjectsBrowser } from "@/components/projects/projects-browser";

export const metadata: Metadata = { title: "Projects" };

// listProjects reads through the foreman's own session, so row-level
// security (0051_foreman_project_access.sql) already limits it to the
// projects assigned to them. No project manager/foreman lists — those only
// feed the Add Project form, which foremen don't get.
export default async function ForemanProjectsPage() {
  const projects = await listProjects();

  return (
    <>
      <AdminPageHeader title="Projects" />
      <main className="flex-1 overflow-y-auto px-8 py-6">
        <ProjectsBrowser projects={projects} projectManagers={[]} foremen={[]} />
      </main>
    </>
  );
}
