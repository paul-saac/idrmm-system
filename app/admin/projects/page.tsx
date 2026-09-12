import type { Metadata } from "next";
import { listProjects } from "@/lib/projects/data";
import { listAccountsByRole } from "@/lib/accounts/data";
import { AdminPageHeader } from "@/components/admin/page-header";
import { ProjectsBrowser } from "@/components/projects/projects-browser";

export const metadata: Metadata = { title: "Projects" };

export default async function AdminProjectsPage() {
  const [projects, projectManagers, foremen] = await Promise.all([
    listProjects(),
    listAccountsByRole(["project_manager"]),
    listAccountsByRole(["foreman"]),
  ]);

  return (
    <>
      <AdminPageHeader title="Projects" />
      <main className="flex-1 overflow-y-auto px-8 py-6">
        <ProjectsBrowser
          projects={projects}
          projectManagers={projectManagers}
          foremen={foremen}
        />
      </main>
    </>
  );
}
