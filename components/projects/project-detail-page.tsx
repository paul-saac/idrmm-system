import { Suspense } from "react";
import { notFound } from "next/navigation";
import { roleLabel } from "@/lib/auth/roles";
import { getSessionProfile } from "@/lib/auth/session";
import { getProjectAccessLevel } from "@/lib/auth/project-access";
import { ProjectAccessProvider } from "@/components/projects/project-access-context";
import { getProjectById } from "@/lib/projects/data";
import { listAccountsByRole } from "@/lib/accounts/data";
import { getCostEstimate } from "@/lib/cost-estimate/data";
import { getGanttUndoRedoState } from "@/lib/cost-estimate/undo-redo";
import {
  listWorkers,
  listAssignments,
  listMemberGroups,
  listTaskWorkerAssignments,
  listCategoryWorkerAssignments,
} from "@/lib/workers/data";
import { listTaskProgressToday } from "@/lib/task-progress/data";
import { listCategoryProgressToday } from "@/lib/category-progress/data";
import { listProjectOverrideHistory } from "@/lib/progress-logs/actions";
import { listProjectEvents } from "@/lib/project-events/data";
import { listSheets } from "@/lib/sheets/actions";
import {
  listMaterialBreakdownEntries,
  listProjectMaterials,
  listProgressMaterialUsage,
  summarizeMaterials,
  type MaterialsOverviewCounts,
} from "@/lib/materials/data";
import { listMaterialPurchases } from "@/lib/materials/purchases";
import {
  computeMaterialStocks,
  summarizeMaterialStocks,
} from "@/lib/materials/purchases-model";
import { buildMaterialRecords } from "@/lib/materials/records";
import { listMaterialRequests } from "@/lib/material-requests/data";
import { listEquipmentRequests } from "@/lib/equipment-requests/data";
import {
  listProgressExpenses,
  listProjectEquipmentAssignments,
  listProjectEquipmentTaskMovements,
} from "@/lib/equipment/data";
import { buildEquipmentCostRecords } from "@/lib/equipment/records";
import { loadEquipmentTracking } from "@/lib/equipment/tracking-actions";
import { syncProjectStatusFromProgress } from "@/lib/projects/sync";
import { ProjectDetailView } from "@/components/projects/project-detail-view";
import { ProjectWorkspaceLoading } from "@/components/projects/project-workspace-loading";

/**
 * The project detail page for both portals (app/admin/projects/[id] and
 * app/foreman/projects/[id]). Everything is read through the signed-in
 * user's own session, so for a foreman row-level security already limits
 * it to their assigned project — another project's id just resolves to
 * no project and a 404.
 */
export async function ProjectDetailPage({ projectId }: { projectId: number }) {
  if (!Number.isFinite(projectId)) {
    notFound();
  }

  // Resolve only the small project record first. This lets Next.js stream a
  // useful workspace header and tab frame while the larger project data set
  // below is still loading.
  const project = await getProjectById(projectId);
  if (!project) {
    notFound();
  }

  return (
    <Suspense fallback={<ProjectWorkspaceLoading project={project} />}>
      <ProjectDetailContent projectId={projectId} project={project} />
    </Suspense>
  );
}

async function ProjectDetailContent({
  projectId,
  project,
}: {
  projectId: number;
  project: NonNullable<Awaited<ReturnType<typeof getProjectById>>>;
}) {
  const projectAccess = await getProjectAccessLevel(projectId);
  if (projectAccess === "none") notFound();
  const [
    projectManagers,
    foremen,
    costEstimate,
    materials,
    materialBreakdownEntries,
    progressMaterialUsage,
    materialRequests,
    equipmentRequests,
    progressExpenses,
    projectEquipmentAssignments,
    equipmentTaskMovements,
    sessionProfile,
    ganttUndoRedoState,
    workers,
    workerAssignments,
    taskWorkerAssignments,
    categoryWorkerAssignments,
    taskProgressToday,
    categoryProgressToday,
    overrideHistory,
    events,
    memberGroups,
    sheetsResult,
    equipmentTrackingResult,
    materialPurchases,
  ] = await Promise.all([
    listAccountsByRole(["project_manager"]),
    listAccountsByRole(["foreman"]),
    getCostEstimate(projectId, true),
    listProjectMaterials(projectId),
    listMaterialBreakdownEntries(projectId),
    listProgressMaterialUsage(projectId),
    listMaterialRequests(projectId),
    listEquipmentRequests(projectId),
    listProgressExpenses(projectId),
    listProjectEquipmentAssignments(projectId),
    listProjectEquipmentTaskMovements(projectId),
    getSessionProfile(),
    getGanttUndoRedoState(projectId),
    listWorkers(),
    listAssignments(),
    listTaskWorkerAssignments(projectId),
    listCategoryWorkerAssignments(projectId),
    listTaskProgressToday(projectId),
    listCategoryProgressToday(projectId),
    listProjectOverrideHistory(projectId),
    listProjectEvents(projectId),
    listMemberGroups(),
    listSheets(projectId),
    loadEquipmentTracking(projectId),
    listMaterialPurchases(projectId),
  ]);

  // Every material the project has, each once: planned, used, in stock.
  const materialRecords = buildMaterialRecords(
    materials,
    materialBreakdownEntries,
    progressMaterialUsage
  );

  // Every task's equipment cost — the Equipment tab's: its budget, what's
  // been spent of it from its progress updates, and its cost log.
  // Any "not on the list" equipment entries are expanded as their own
  // standalone records alongside planned costs.
  const resolvedProgressExpenses = progressExpenses.flatMap((entry) => {
    let items = entry.equipmentItems;
    if (entry.costs.equipment > 0 && (!items || items.length === 0)) {
      const matchingLog = overrideHistory[entry.itemKey]?.find(
        (log) => log.entryDate === entry.entryDate
      );
      if (matchingLog && matchingLog.equipmentCosts && matchingLog.equipmentCosts.length > 0) {
        items = matchingLog.equipmentCosts.map((c) => ({
          name: c.name,
          amount: c.amount,
          unplanned: Boolean(c.unplanned),
        }));
      }
    }

    const unplannedItems = (items ?? []).filter((i) => i.unplanned);
    const plannedItems = (items ?? []).filter((i) => !i.unplanned);

    if (entry.costs.equipment <= 0) {
      return [{ ...entry, equipmentItems: items, isUnplanned: false }];
    }

    if (unplannedItems.length === 0 && plannedItems.length <= 1) {
      return [
        {
          ...entry,
          equipmentItems: items,
          isUnplanned: false,
          equipmentName: plannedItems[0]?.name,
        },
      ];
    }

    const expanded: typeof progressExpenses = [];
    // 1. Standalone "not on the list" records
    for (let idx = 0; idx < unplannedItems.length; idx++) {
      const item = unplannedItems[idx];
      expanded.push({
        ...entry,
        id: `${entry.id}-unplanned-${idx}`,
        costs: { material: 0, equipment: item.amount, labor: 0, other: 0 },
        isUnplanned: true,
        equipmentName: item.name,
        equipmentItems: [item],
      });
    }

    // 2. Planned task equipment records
    if (plannedItems.length > 1) {
      for (let idx = 0; idx < plannedItems.length; idx++) {
        const item = plannedItems[idx];
        expanded.push({
          ...entry,
          id: `${entry.id}-planned-${idx}`,
          costs: {
            material: idx === 0 ? entry.costs.material : 0,
            equipment: item.amount,
            labor: idx === 0 ? entry.costs.labor : 0,
            other: idx === 0 ? entry.costs.other : 0,
          },
          isUnplanned: false,
          equipmentName: item.name,
          equipmentItems: [item],
        });
      }
    } else {
      const unplannedTotal = unplannedItems.reduce((sum, item) => sum + item.amount, 0);
      const plannedTotal =
        plannedItems.length === 1
          ? plannedItems[0].amount
          : Math.max(0, entry.costs.equipment - unplannedTotal);

      if (
        plannedTotal > 0.005 ||
        entry.costs.labor > 0 ||
        entry.costs.other > 0 ||
        entry.costs.material > 0
      ) {
        expanded.push({
          ...entry,
          id: unplannedItems.length > 0 ? `${entry.id}-planned` : entry.id,
          costs: {
            ...entry.costs,
            equipment: plannedTotal,
          },
          isUnplanned: false,
          equipmentName: plannedItems[0]?.name,
          equipmentItems: plannedItems,
        });
      }
    }

    return expanded;
  });

  const equipmentCosts = resolvedProgressExpenses
    .filter((entry) => entry.costs.equipment > 0)
    .map(({ costs, ...entry }) => ({ ...entry, amount: costs.equipment }));
  const equipmentCostRecords = buildEquipmentCostRecords(costEstimate, equipmentCosts);

  const currentUserName = sessionProfile
    ? `${sessionProfile.firstName} ${sessionProfile.lastName}`.trim() ||
      sessionProfile.email ||
      roleLabel(sessionProfile.role)
    : "Admin";

  // Reconcile persisted status after changes to task scope or saved work.
  // The sync helper checks project access before its narrow status write.
  const syncedStatus = await syncProjectStatusFromProgress(
    projectId,
    costEstimate.lifecycle
  );
  const currentProject =
    syncedStatus && syncedStatus !== project.status
        ? { ...project, status: syncedStatus }
      : project;

  const materialStocks = computeMaterialStocks(materialPurchases, progressMaterialUsage);
  const stockSummary = summarizeMaterialStocks(materialStocks);
  const materialsCounts: MaterialsOverviewCounts =
    materialStocks.length > 0
      ? {
          totalMaterials: Math.max(materialRecords.length, stockSummary.totalMaterials),
          availableMaterials: stockSummary.availableMaterials,
          lowStockMaterials: stockSummary.lowStockMaterials,
          consumedMaterials: stockSummary.outOfStockMaterials,
        }
      : {
          ...summarizeMaterials(materials),
          totalMaterials: materialRecords.length,
        };

  return (
    <ProjectAccessProvider canEdit={projectAccess === "edit"}>
    <ProjectDetailView
      project={currentProject}
      projectManagers={projectManagers}
      foremen={foremen}
      costEstimate={costEstimate}
      materialsCounts={materialsCounts}
      materialPurchases={materialPurchases}
      materialRecords={materialRecords}
      recentMaterialUsage={progressMaterialUsage}
      materialRequests={materialRequests}
      equipmentRequests={equipmentRequests}
      progressExpenses={resolvedProgressExpenses}
      currentUserName={currentUserName}
      projectEquipmentAssignments={projectEquipmentAssignments}
      equipmentTaskMovements={equipmentTaskMovements}
      equipmentCostRecords={equipmentCostRecords}
      equipmentCostLogs={equipmentCosts}
      recentEquipmentCosts={equipmentCosts.slice(0, 10)}
      ganttCanUndo={ganttUndoRedoState.canUndo}
      ganttCanRedo={ganttUndoRedoState.canRedo}
      workers={workers}
      workerAssignments={workerAssignments}
      memberGroups={memberGroups}
      taskWorkerAssignments={taskWorkerAssignments}
      categoryWorkerAssignments={categoryWorkerAssignments}
      taskProgressToday={taskProgressToday}
      categoryProgressToday={categoryProgressToday}
      overrideHistory={overrideHistory}
      events={events}
      sheetsResult={sheetsResult}
      equipmentTracking={equipmentTrackingResult.data ?? null}
    />
    </ProjectAccessProvider>
  );
}
