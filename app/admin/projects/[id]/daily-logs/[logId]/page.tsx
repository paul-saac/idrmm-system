import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getDailyLogDetail,
  listSurveyQuestions,
  type EntryType,
} from "@/lib/daily-logs/data";
import { getCostEstimate } from "@/lib/cost-estimate/data";
import { listProjectMaterials } from "@/lib/materials/data";
import { listFulfillableMaterialRequests } from "@/lib/material-requests/data";
import { listFulfillableEquipmentRequests } from "@/lib/equipment-requests/data";
import { DailyLogDetailView } from "@/components/projects/daily-logs/daily-log-detail-view";

export const metadata: Metadata = { title: "Daily Log" };

const ENTRY_TYPES: EntryType[] = [
  "work_item",
  "labor_item",
  "expense_item",
  "material_usage_item",
  "material_procurement",
  "equipment_acquisition",
];

export default async function DailyLogDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; logId: string }>;
  /** Set by a ledger table (Material Usage History, the four Expenses
   * tables) linking to the specific entry a record came from — see
   * dailyLogEntryHref. The detail view scrolls to and briefly
   * highlights that entry once the page loads. */
  searchParams: Promise<{ entryType?: string; entryId?: string }>;
}) {
  const { id, logId } = await params;
  const projectId = Number(id);
  const dailyLogId = Number(logId);

  const { entryType, entryId } = await searchParams;
  const highlightEntryType = ENTRY_TYPES.find((t) => t === entryType);
  const highlightEntryId =
    highlightEntryType && entryId ? Number(entryId) : null;

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
    surveyQuestions,
  ] = await Promise.all([
    getCostEstimate(projectId),
    listProjectMaterials(projectId),
    listFulfillableMaterialRequests(projectId),
    listFulfillableEquipmentRequests(projectId),
    listSurveyQuestions(projectId),
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
      surveyQuestions={surveyQuestions}
      highlightEntryType={highlightEntryType}
      highlightEntryId={highlightEntryId}
    />
  );
}
