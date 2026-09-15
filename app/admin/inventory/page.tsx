import type { Metadata } from "next";
import { listEquipment } from "@/lib/equipment/data";
import { listProjects } from "@/lib/projects/data";
import { AdminPageHeader } from "@/components/admin/page-header";
import { InventoryBrowser } from "@/components/inventory/inventory-browser";

export const metadata: Metadata = { title: "Inventory" };

export default async function AdminInventoryPage() {
  const [equipment, projects] = await Promise.all([
    listEquipment(),
    listProjects(),
  ]);

  return (
    <>
      <AdminPageHeader title="Tools and Equipment" />
      <main className="flex-1 overflow-y-auto px-8 py-6">
        <InventoryBrowser
          equipment={equipment}
          projects={projects.map((project) => ({
            id: project.id,
            name: project.name,
          }))}
        />
      </main>
    </>
  );
}
