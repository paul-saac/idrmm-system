import { notFound } from "next/navigation";
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
import { listProjectEvents } from "@/lib/project-events/data";
import { getProjectProgress } from "@/lib/progress/data";
import { listDailyLogs, listSurveyQuestions } from "@/lib/daily-logs/data";
import {
  listMaterialBreakdownEntries,
  listProjectMaterials,
  listProgressMaterialUsage,
  summarizeMaterials,
} from "@/lib/materials/data";
import { buildMaterialRecords } from "@/lib/materials/records";
import { listMaterialRequests } from "@/lib/material-requests/data";
import { listEquipmentRequests } from "@/lib/equipment-requests/data";
import {
  listProgressEquipmentCosts,
  listProjectEquipmentAssignments,
} from "@/lib/equipment/data";
import { buildEquipmentCostRecords } from "@/lib/equipment/records";
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
    equipmentCosts,
    projectEquipmentAssignments,
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
    events,
    memberGroups,
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
    listProgressEquipmentCosts(projectId),
    listProjectEquipmentAssignments(projectId),
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
    listProjectEvents(projectId),
    listMemberGroups(),
  ]);

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
      (sessionProfile.role === "foreman" ? "Foreman" : "Admin")
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
      materialsCounts={{
        ...summarizeMaterials(materials),
        // Every material the project has, not just its stock records.
        totalMaterials: materialRecords.length,
      }}
      materialRecords={materialRecords}
      recentMaterialUsage={progressMaterialUsage.slice(0, 10)}
      materialRequests={materialRequests}
      fulfillableMaterialRequests={fulfillableMaterialRequests}
      equipmentRequests={equipmentRequests}
      fulfillableEquipmentRequests={fulfillableEquipmentRequests}
      expenseOverview={expenseOverview}
      laborExpenses={laborExpenses}
      materialExpenses={materialExpenses}
      equipmentExpenses={equipmentExpenses}
      otherExpenses={otherExpenses}
      currentUserName={currentUserName}
      projectEquipmentAssignments={projectEquipmentAssignments}
      equipmentCostRecords={equipmentCostRecords}
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
      events={events}
    />
  );
}
