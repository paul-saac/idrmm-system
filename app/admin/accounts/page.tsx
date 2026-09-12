import type { Metadata } from "next";
import { listAccountsByRole } from "@/lib/accounts/data";
import { AdminPageHeader } from "@/components/admin/page-header";
import { AccountsBrowser } from "@/components/accounts/accounts-browser";

export const metadata: Metadata = { title: "Manage Accounts" };

export default async function AdminAccountsPage() {
  const accounts = await listAccountsByRole(["project_manager", "foreman"]);

  return (
    <>
      <AdminPageHeader title="Manage Accounts" />
      <main className="flex-1 overflow-y-auto px-8 py-6">
        <AccountsBrowser
          accounts={accounts}
          roleOptions={["project_manager", "foreman"]}
        />
      </main>
    </>
  );
}
