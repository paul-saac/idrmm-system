import type { Metadata } from "next";
import { listEquipment } from "@/lib/equipment/data";
import { AdminPageHeader } from "@/components/admin/page-header";
import { InventoryBrowser } from "@/components/inventory/inventory-browser";

export const metadata: Metadata = { title: "Inventory" };

// View-only (see InventoryBrowser) — foremen can see the whole company
// tool/equipment list, but checking equipment out, editing, and deleting
// stay with admins. An item assigned to a project that isn't theirs shows
// no project name, since row-level security only lets them read their own
// projects. No project list is passed — it only feeds the admin-only
// Assign form.
export default async function ForemanInventoryPage() {
  const equipment = await listEquipment();

  return (
    <>
      <AdminPageHeader title="Tools and Equipment" />
      <main className="flex-1 overflow-y-auto px-8 py-6">
        <InventoryBrowser equipment={equipment} projects={[]} />
      </main>
    </>
  );
}
