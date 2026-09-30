import { notFound } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { getProjectById } from "@/lib/projects/data";
import { listAccountsByRole } from "@/lib/accounts/data";
import { getCostEstimate } from "@/lib/cost-estimate/data";
import { getGanttUndoRedoState } from "@/lib/cost-estimate/undo-redo";
import {
  listWorkers,
  listTaskWorkerAssignments,
  listCategoryWorkerAssignments,
} from "@/lib/workers/data";
import { listTaskProgressToday } from "@/lib/task-progress/data";
import { listCategoryProgressToday } from "@/lib/category-progress/data";
import { getProjectProgress } from "@/lib/progress/data";
import { listDailyLogs, listSurveyQuestions } from "@/lib/daily-logs/data";
import {
  getTodayMaterialProcurement,
  listMaterialBreakdownEntries,
  listMaterialUsageHistory,
  listProjectMaterials,
  summarizeMaterials,
} from "@/lib/materials/data";
import {
  listFulfillableMaterialRequests,
  listMaterialRequests,
} from "@/lib/material-requests/data";
import {
  listEquipmentRequests,
  listFulfillableEquipmentRequests,
} from "@/lib/equipment-requests/data";
import { listProjectEquipmentAssignments } from "@/lib/equipment/data";
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
    materialUsageHistory,
    materialBreakdownEntries,
    todayProcurement,
    materialRequests,
    fulfillableMaterialRequests,
    equipmentRequests,
    fulfillableEquipmentRequests,
    projectEquipmentAssignments,
    laborExpenses,
    materialExpenses,
    equipmentExpenses,
    otherExpenses,
    sessionProfile,
    ganttUndoRedoState,
    workers,
    taskWorkerAssignments,
    categoryWorkerAssignments,
    taskProgressToday,
    categoryProgressToday,
  ] = await Promise.all([
    getProjectById(projectId),
    listAccountsByRole(["project_manager"]),
    listAccountsByRole(["foreman"]),
    getCostEstimate(projectId),
    listDailyLogs(projectId),
    listSurveyQuestions(projectId),
    listProjectMaterials(projectId),
    listMaterialUsageHistory(projectId),
    listMaterialBreakdownEntries(projectId),
    getTodayMaterialProcurement(projectId),
    listMaterialRequests(projectId),
    listFulfillableMaterialRequests(projectId),
    listEquipmentRequests(projectId),
    listFulfillableEquipmentRequests(projectId),
    listProjectEquipmentAssignments(projectId),
    listLaborExpenses(projectId),
    listMaterialExpenses(projectId),
    listEquipmentExpenses(projectId),
    listOtherExpenses(projectId),
    getSessionProfile(),
    getGanttUndoRedoState(projectId),
    listWorkers(projectId),
    listTaskWorkerAssignments(projectId),
    listCategoryWorkerAssignments(projectId),
    listTaskProgressToday(projectId),
    listCategoryProgressToday(projectId),
  ]);

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
      materialsCounts={summarizeMaterials(materials)}
      materialUsageHistory={materialUsageHistory}
      materialBreakdownEntries={materialBreakdownEntries}
      todayProcurement={todayProcurement}
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
      ganttCanUndo={ganttUndoRedoState.canUndo}
      ganttCanRedo={ganttUndoRedoState.canRedo}
      workers={workers}
      taskWorkerAssignments={taskWorkerAssignments}
      categoryWorkerAssignments={categoryWorkerAssignments}
      taskProgressToday={taskProgressToday}
      categoryProgressToday={categoryProgressToday}
    />
  );
}
