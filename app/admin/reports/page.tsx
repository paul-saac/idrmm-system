import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/page-header";

export const metadata: Metadata = { title: "Reports" };

export default function AdminReportsPage() {
  return (
    <>
      <AdminPageHeader title="Reports" />
      <main className="flex flex-1 items-center justify-center px-8 py-6">
        <p className="text-sm text-zinc-500">Reports module coming soon.</p>
      </main>
    </>
  );
}
