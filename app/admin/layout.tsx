import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { AdminSidebar } from "@/components/admin/sidebar";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const profile = await getSessionProfile();

  if (!profile || profile.role !== "admin") {
    redirect("/");
  }

  const name = `${profile.firstName} ${profile.lastName}`.trim();

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-50">
      <AdminSidebar name={name} email={profile.email} />
      <div className="flex flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
