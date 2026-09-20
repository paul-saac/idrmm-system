import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { getProjectById } from "@/lib/projects/data";
import { listAccountsByRole } from "@/lib/accounts/data";
import { getCostEstimate } from "@/lib/cost-estimate/data";
import { getGanttUndoRedoState } from "@/lib/cost-estimate/undo-redo";
import { listWorkers, listTaskWorkerAssignments } from "@/lib/workers/data";
import { getProjectProgress } from "@/lib/progress/data";
import { listDailyLogs, listSurveyQuestions } from "@/lib/daily-logs/data";
import {
  getTodayMaterialProcurement,
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

export const metadata: Metadata = { title: "Project Details" };

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const projectId = Number(id);

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
  ] = await Promise.all([
    getProjectById(projectId),
    listAccountsByRole(["project_manager"]),
    listAccountsByRole(["foreman"]),
    getCostEstimate(projectId),
    listDailyLogs(projectId),
    listSurveyQuestions(projectId),
    listProjectMaterials(projectId),
    listMaterialUsageHistory(projectId),
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
      "Admin"
    : "Admin";

  if (!project) {
    notFound();
  }

  // Depends on costEstimate's categories/tasks, so it can't join the
  // Promise.all above.
  const progress = await getProjectProgress(projectId, costEstimate.categories);

  // Self-healing status sync, not just a write-time side effect of the
  // two daily-log actions that call this same function: progress can
  // also shift from a Cost Estimate edit alone (no daily-log event at
  // all), and this is also what corrects a project whose status went
  // stale before deriveProjectStatusFromProgress existed — there's no
  // migration that can "replay" old approvals, so the next time anyone
  // opens the project is the fix. Patched onto the in-memory `project`
  // rather than re-fetching, so this same request already reflects it.
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
    />
  );
}
