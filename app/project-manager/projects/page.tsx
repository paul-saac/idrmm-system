import type { Metadata } from "next";
import { listProjects } from "@/lib/projects/data";
import { AdminPageHeader } from "@/components/admin/page-header";
import { ProjectsBrowser } from "@/components/projects/projects-browser";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectManagerProjectsPage() {
  const projects = await listProjects();

  return (
    <>
      <AdminPageHeader title="Projects" description="An overview of your projects." />
      <main className="flex-1 overflow-y-auto px-8 py-6">
        <ProjectsBrowser projects={projects} projectManagers={[]} foremen={[]} />
      </main>
    </>
  );
}
