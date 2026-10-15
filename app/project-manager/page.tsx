import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/page-header";

export const metadata: Metadata = { title: "Project Manager Dashboard" };

// The layout already checks this is a project manager.
export default function ProjectManagerPage() {
  return (
    <>
      <AdminPageHeader title="Dashboard" />
      <main className="flex flex-1 items-center justify-center px-8 py-6">
        <p className="text-sm text-zinc-500">This is the project manager dashboard.</p>
      </main>
    </>
  );
}
