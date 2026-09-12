import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { LogoutButton } from "@/components/auth/logout-button";

export const metadata: Metadata = { title: "Project Manager Dashboard" };

export default async function ProjectManagerPage() {
  const profile = await getSessionProfile();

  if (!profile || profile.role !== "project_manager") {
    redirect("/");
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4">
        <div>
          <p className="text-sm font-medium text-zinc-900">
            {`${profile.firstName} ${profile.lastName}`.trim() || profile.email}
          </p>
          <p className="text-xs text-zinc-500">Project Manager</p>
        </div>
        <LogoutButton />
      </header>
      <main className="flex flex-1 items-center justify-center">
        <p className="text-zinc-700">This is project manager dashboard</p>
      </main>
    </div>
  );
}
