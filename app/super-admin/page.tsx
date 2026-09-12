import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { listAccountsByRole } from "@/lib/accounts/data";
import { LogoutButton } from "@/components/auth/logout-button";
import { AccountsBrowser } from "@/components/accounts/accounts-browser";

export const metadata: Metadata = { title: "Manage Administrators" };

export default async function SuperAdminPage() {
  const profile = await getSessionProfile();

  if (!profile || profile.role !== "super_admin") {
    redirect("/");
  }

  const accounts = await listAccountsByRole(["admin"]);

  return (
    <div className="flex flex-1 flex-col bg-zinc-50">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4">
        <div>
          <p className="text-sm font-medium text-zinc-900">
            {`${profile.firstName} ${profile.lastName}`.trim() || profile.email}
          </p>
          <p className="text-xs text-zinc-500">Super Administrator</p>
        </div>
        <LogoutButton />
      </header>

      <main className="flex-1 px-6 py-8">
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900">
              Administrator accounts
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Create and manage Administrator accounts for IDR M&amp;M.
            </p>
          </div>

          <AccountsBrowser accounts={accounts} roleOptions={["admin"]} />
        </div>
      </main>
    </div>
  );
}
