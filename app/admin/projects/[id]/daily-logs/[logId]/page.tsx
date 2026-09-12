import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDailyLogDetail } from "@/lib/daily-logs/data";
import { getCostEstimate } from "@/lib/cost-estimate/data";
import { listProjectMaterials } from "@/lib/materials/data";
import { listFulfillableMaterialRequests } from "@/lib/material-requests/data";
import { listFulfillableEquipmentRequests } from "@/lib/equipment-requests/data";
import { DailyLogDetailView } from "@/components/projects/daily-logs/daily-log-detail-view";

export const metadata: Metadata = { title: "Daily Log" };

export default async function DailyLogDetailPage({
  params,
}: {
  params: Promise<{ id: string; logId: string }>;
}) {
  const { id, logId } = await params;
  const projectId = Number(id);
  const dailyLogId = Number(logId);

  if (!Number.isFinite(dailyLogId)) {
    notFound();
  }

  const log = await getDailyLogDetail(dailyLogId);

  if (!log) {
    notFound();
  }

  // Only needed for the Edit modal (pending/rejected logs) — cheap
  // enough to always load rather than conditionally.
  const [
    costEstimate,
    materials,
    fulfillableMaterialRequests,
    fulfillableEquipmentRequests,
  ] = await Promise.all([
    getCostEstimate(projectId),
    listProjectMaterials(projectId),
    listFulfillableMaterialRequests(projectId),
    listFulfillableEquipmentRequests(projectId),
  ]);

  const categoryOptions = costEstimate.categories.map((category) => ({
    id: category.id,
    name: category.name,
    tasks: category.tasks.map((task) => ({
      id: task.id,
      name: task.name,
      unit: task.unit,
      estimatedQuantity: task.estimatedQuantity,
    })),
  }));

  return (
    <DailyLogDetailView
      log={log}
      categories={categoryOptions}
      materials={materials}
      materialRequests={fulfillableMaterialRequests}
      equipmentRequests={fulfillableEquipmentRequests}
    />
  );
}
