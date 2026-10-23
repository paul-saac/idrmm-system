import { notFound } from "next/navigation";
import { roleLabel } from "@/lib/auth/roles";
import { getSessionProfile } from "@/lib/auth/session";
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
import { getProjectProgress } from "@/lib/progress/data";
import { listDailyLogs, listSurveyQuestions } from "@/lib/daily-logs/data";
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
import {
  listLaborExpenses,
  listMaterialExpenses,
  listEquipmentExpenses,
  listOtherExpenses,
  summarizeExpenses,
} from "@/lib/expenses/data";
import { syncProjectStatusFromProgress } from "@/lib/projects/sync";
import { getDelayRiskAssessment } from "@/lib/forecasting/data";
import { ProjectDetailView } from "@/components/projects/project-detail-view";

/**
 * The project detail page for both portals (app/admin/projects/[id] and
 * app/foreman/projects/[id]). Everything is read through the signed-in
 * user's own session, so for a foreman row-level security already limits
 * it to their assigned project — another project's id just resolves to
 * no project and a 404.
 *
 * DAILY LOGS — ON HOLD for foremen: no daily_log_* table has a foreman
 * policy yet, so for a foreman the daily-log reads below (daily logs,
 * survey questions, today's procurement, and the expense/material-usage
 * lists built from daily log entries) come back empty rather than failing.
 */
export async function ProjectDetailPage({ projectId }: { projectId: number }) {
  if (!Number.isFinite(projectId)) {
    notFound();
  }

  const [
    project,
    projectManagers,
    foremen,
    costEstimate,
    dailyLogs,
    surveyQuestions,
    materials,
    materialBreakdownEntries,
    progressMaterialUsage,
    materialRequests,
    equipmentRequests,
    progressExpenses,
    projectEquipmentAssignments,
    equipmentTaskMovements,
    laborExpenses,
    materialExpenses,
    equipmentExpenses,
    otherExpenses,
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
    getProjectById(projectId),
    listAccountsByRole(["project_manager"]),
    listAccountsByRole(["foreman"]),
    getCostEstimate(projectId),
    listDailyLogs(projectId),
    listSurveyQuestions(projectId),
    listProjectMaterials(projectId),
    listMaterialBreakdownEntries(projectId),
    listProgressMaterialUsage(projectId),
    listMaterialRequests(projectId),
    listEquipmentRequests(projectId),
    listProgressExpenses(projectId),
    listProjectEquipmentAssignments(projectId),
    listProjectEquipmentTaskMovements(projectId),
    listLaborExpenses(projectId),
    listMaterialExpenses(projectId),
    listEquipmentExpenses(projectId),
    listOtherExpenses(projectId),
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

  if (!project) {
    notFound();
  }

  // Every material the project has, each once: planned, used, in stock.
  const materialRecords = buildMaterialRecords(
    materials,
    materialBreakdownEntries,
    progressMaterialUsage
  );

  // What the Add Daily Log's Material Procurement can still deliver
  // against — see listFulfillableMaterialRequests.
  const fulfillableMaterialRequests = materialRequests.filter(
    (request) => request.status === "approved" || request.status === "partially_fulfilled"
  );
  // The same, for the Add Daily Log's Equipment Acquisition.
  const fulfillableEquipmentRequests = equipmentRequests.filter(
    (request) => request.status === "approved" || request.status === "partially_fulfilled"
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

  const expenseOverview = summarizeExpenses(
    laborExpenses,
    materialExpenses,
    equipmentExpenses,
    otherExpenses,
    costEstimate.summary.totalsByColumn
  );

  const currentUserName = sessionProfile
    ? `${sessionProfile.firstName} ${sessionProfile.lastName}`.trim() ||
      sessionProfile.email ||
      roleLabel(sessionProfile.role)
    : "Admin";

  if (!project) {
    notFound();
  }

  // Depends on costEstimate's categories/tasks, so it can't join the
  // Promise.all above.
  const progress = await getProjectProgress(projectId, costEstimate.categories);

  // Self-healing status sync on every view — see
  // syncProjectStatusFromProgress's own doc comment. A foreman can't write
  // to projects, so for them this only patches the in-memory status below
  // (the database catches up on the next admin view).
  const syncedStatus = await syncProjectStatusFromProgress(
    projectId,
    progress.overallPercent
  );
  if (syncedStatus && syncedStatus !== project.status) {
    project.status = syncedStatus;
  }

  // Same reasoning as costEstimate/progress above: depends on data
  // fetched earlier, so it can't join the first Promise.all.
  const risk = await getDelayRiskAssessment(
    projectId,
    project,
    costEstimate,
    progress,
    expenseOverview
  );

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
    <ProjectDetailView
      project={project}
      projectManagers={projectManagers}
      foremen={foremen}
      costEstimate={costEstimate}
      progress={progress}
      risk={risk}
      dailyLogs={dailyLogs}
      surveyQuestions={surveyQuestions}
      materials={materials}
      materialsCounts={materialsCounts}
      materialPurchases={materialPurchases}
      materialRecords={materialRecords}
      recentMaterialUsage={progressMaterialUsage}
      materialRequests={materialRequests}
      fulfillableMaterialRequests={fulfillableMaterialRequests}
      equipmentRequests={equipmentRequests}
      fulfillableEquipmentRequests={fulfillableEquipmentRequests}
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
  );
}
