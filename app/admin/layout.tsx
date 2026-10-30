import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { PortalSidebar } from "@/components/admin/sidebar";
import { PortalProvider } from "@/components/portal/portal-context";
import { roleLabel, isAdminRole } from "@/lib/auth/roles";
import { MaintenanceNotice } from "@/components/settings/maintenance-notice";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const profile = await getSessionProfile();

  if (!profile || !isAdminRole(profile.role)) {
    redirect("/");
  }

  const name = `${profile.firstName} ${profile.lastName}`.trim();

  return (
    <PortalProvider
      portal={{
        basePath: "/admin",
        isAdmin: true,
        user: { name, email: profile.email, roleLabel: roleLabel(profile.role) },
      }}
    >
      <div className="flex h-screen overflow-hidden bg-zinc-50">
        <PortalSidebar basePath="/admin" />
        <div className="flex flex-1 flex-col overflow-hidden"><MaintenanceNotice />{children}</div>
      </div>
    </PortalProvider>
  );
}
