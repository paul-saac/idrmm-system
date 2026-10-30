import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { PortalSidebar } from "@/components/admin/sidebar";
import { PortalProvider } from "@/components/portal/portal-context";
import { MaintenanceNotice } from "@/components/settings/maintenance-notice";
import { roleLabel } from "@/lib/auth/roles";

// The project manager portal: so far the Team — every member to view, and
// groups (crews) to create and manage — plus their own Settings.
export default async function ProjectManagerLayout({
  children,
}: {
  children: ReactNode;
}) {
  const profile = await getSessionProfile();

  if (!profile || profile.role !== "project_manager") {
    redirect("/");
  }

  const name = `${profile.firstName} ${profile.lastName}`.trim();

  return (
    <PortalProvider
      portal={{
        basePath: "/project-manager",
        isAdmin: false,
        user: { name, email: profile.email, roleLabel: roleLabel(profile.role) },
      }}
    >
      <div className="flex h-screen overflow-hidden bg-zinc-50">
        <PortalSidebar basePath="/project-manager" />
        <div className="flex flex-1 flex-col overflow-hidden"><MaintenanceNotice />{children}</div>
      </div>
    </PortalProvider>
  );
}
