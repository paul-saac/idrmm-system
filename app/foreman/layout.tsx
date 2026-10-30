import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { PortalSidebar } from "@/components/admin/sidebar";
import { PortalProvider } from "@/components/portal/portal-context";
import { MaintenanceNotice } from "@/components/settings/maintenance-notice";
import { roleLabel } from "@/lib/auth/roles";

// The foreman portal: the same pages as the admin portal, scoped to the
// projects assigned to this foreman (projects.foreman_id) by row-level
// security (0051_foreman_project_access.sql), without Accounts, and with
// the project itself and the equipment inventory read-only.
export default async function ForemanLayout({
  children,
}: {
  children: ReactNode;
}) {
  const profile = await getSessionProfile();

  if (!profile || profile.role !== "foreman") {
    redirect("/");
  }

  const name = `${profile.firstName} ${profile.lastName}`.trim();

  return (
    <PortalProvider
      portal={{
        basePath: "/foreman",
        isAdmin: false,
        user: { name, email: profile.email, roleLabel: roleLabel(profile.role) },
      }}
    >
      <div className="flex h-screen overflow-hidden bg-zinc-50">
        <PortalSidebar basePath="/foreman" />
        <div className="flex flex-1 flex-col overflow-hidden"><MaintenanceNotice />{children}</div>
      </div>
    </PortalProvider>
  );
}
