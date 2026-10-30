import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { listProjectAccessAccounts } from "@/lib/accounts/project-access";
import { ProjectAccessBrowser } from "@/components/accounts/project-access-browser";
import { AdminPageHeader } from "@/components/admin/page-header";

export const metadata: Metadata = { title: "Project access" };

export default async function ProjectManagerAccountsPage() {
  const profile = await getSessionProfile();
  if (profile?.role !== "project_manager") notFound();
  const accounts = await listProjectAccessAccounts();
  return <><AdminPageHeader title="Project access" /><main className="flex-1 overflow-y-auto px-8 py-6"><ProjectAccessBrowser accounts={accounts} /></main></>;
}
