import type { Metadata } from "next";
import { HardHat, ShieldCheck, UserCog, Users } from "lucide-react";
import { StatCard } from "@/components/admin/dashboard/stat-card";
import { listAccountsByRole } from "@/lib/accounts/data";
import { getSessionProfile } from "@/lib/auth/session";
import { MANAGED_ROLES } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/page-header";
import { AccountsBrowser } from "@/components/accounts/accounts-browser";

export const metadata: Metadata = { title: "Manage Accounts" };

export default async function AdminAccountsPage() {
  const profile = await getSessionProfile();
  // Whoever this viewer may manage — a super admin's Administrators too.
  const roles = profile ? MANAGED_ROLES[profile.role] : [];
  const accounts = await listAccountsByRole(roles);

  return (
    <>
      <AdminPageHeader title="Manage Accounts" />
      <main className="flex-1 overflow-y-auto px-8 py-6">
        {(profile?.role === "super_admin" || profile?.role === "admin") && (
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total Users" value={accounts.length} icon={Users} />
            <StatCard
              label="Project Managers"
              value={accounts.filter((account) => account.role === "project_manager").length}
              icon={UserCog}
            />
            <StatCard
              label="Foremen"
              value={accounts.filter((account) => account.role === "foreman").length}
              icon={HardHat}
            />
            <StatCard
              label={profile.role === "super_admin" ? "Administrators" : "Active Accounts"}
              value={accounts.filter((account) => profile.role === "super_admin" ? account.role === "admin" : account.status === "active" && !account.invitationPending).length}
              icon={ShieldCheck}
            />
          </div>
        )}
        <AccountsBrowser
          accounts={accounts}
          roleOptions={roles}
          isSuperAdmin={profile?.role === "super_admin"}
        />
      </main>
    </>
  );
}
