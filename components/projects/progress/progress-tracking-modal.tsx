"use client";

import { useProgressLogSync } from "./progress-log-sync";
import type { OverrideLog } from "@/lib/progress-logs/types";
import { useMemo, useState } from "react";
import { laborEntryCost } from "@/lib/task-progress/labor";
import { logEditor } from "@/lib/progress-logs/edit-model";
import { editProgressLog } from "@/lib/progress-logs/edit-actions";
import { Modal } from "@/components/ui/modal";
import { usePortal } from "@/components/portal/portal-context";
import { ProgressTrackingModalContent } from "./progress-tracking-modal-content";
import type { MaterialStockItem } from "@/lib/materials/purchases-model";
import type { CostCategory, CostTask } from "@/lib/cost-estimate/data";
import type { ProjectOverrideHistory } from "@/lib/progress-logs/types";
import type { TaskProgressToday } from "@/lib/task-progress/data";
import { deleteTaskProgressEntry, recordTaskProgress } from "@/lib/task-progress/actions";
import { deleteCategoryProgressEntry, recordCategoryProgress } from "@/lib/category-progress/actions";
import {
  EMPTY_PROGRESS_ANCHOR,
  groupPlannedMaterials,
  groupPlannedOtherCosts,
  materialKey,
  otherCostKey,
} from "@/lib/task-progress/calculate";
import type {
  CategoryWorkerAssignments,
  TaskWorkerAssignments,
  Worker,
} from "@/lib/workers/data";

export type ProgressModalTarget = (
  | { kind: "task"; task: CostTask }
  | { kind: "category"; category: CostCategory }
) & { readOnly?: boolean; highlightLatest?: boolean; highlightEntryDate?: string };

const EMPTY_PROGRESS_TODAY: TaskProgressToday = {
  ...EMPTY_PROGRESS_ANCHOR,
  today: null,
  latest: null,
  todayAttendance: [],
};

/** Shared by Gantt and equipment records; opens from already-loaded data. */
export function ProgressTrackingModal({
  target,
  readOnly = false,
  projectId,
  projectName,
  categories,
  workingDays,
  holidays,
  taskProgressToday,
  categoryProgressToday,
  overrideHistory,
  workers = [],
  taskWorkerAssignments = {},
  categoryWorkerAssignments = {},
  materialStocks,
  onClose,
}: {
  target: ProgressModalTarget | null;
  readOnly?: boolean;
  projectId: number;
  projectName: string;
  materialStocks?: MaterialStockItem[];
  categories: CostCategory[];
  workingDays: number[];
  holidays: string[];
  taskProgressToday: Record<number, TaskProgressToday>;
  categoryProgressToday: Record<number, TaskProgressToday>;
  overrideHistory: ProjectOverrideHistory;
  /** The company Team — today's labor is logged as hours per person,
   * priced at each one's Default Rate. */
  workers?: Worker[];
  /** Who's assigned to each task / phase — today's log lists them. */
  taskWorkerAssignments?: TaskWorkerAssignments;
  categoryWorkerAssignments?: CategoryWorkerAssignments;
  onClose: () => void;
}) {
  const { isAdmin, user } = usePortal();
  const logSync = useProgressLogSync();
  const [selection,setSelection] = useState<{key:string;log:OverrideLog}|null>(null);
  const [summaryState, setSummaryState] = useState<{key:string;collapsed:boolean}|null>(null);
  const materialPrices = useMemo(() => {
    const byKey = new Map<string, { name: string; unit: string | null; unitCost: number }>();
    for (const category of categories) {
      const lines = [
        ...category.materialAssignments,
        ...category.tasks.flatMap((task) => task.materialAssignments),
      ];
      for (const line of lines) {
        const name = line.materialName.trim();
        if (!name || line.unitCost <= 0) continue;
        const key = materialKey(name, line.unit);
        if (!byKey.has(key)) byKey.set(key, { name, unit: line.unit, unitCost: line.unitCost });
      }
    }
    return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [categories]);

  const equipmentCostSuggestions = useMemo(() => {
    const byKey = new Map<string, { name: string; amount: number }>();
    for (const category of categories) {
      const lines = [
        ...(category.equipmentCostItems ?? []),
        ...category.tasks.flatMap((task) => task.equipmentCostItems ?? []),
      ];
      for (const line of lines) {
        const name = line.costName.trim();
        if (!name || line.amount <= 0) continue;
        const key = otherCostKey(name);
        if (!byKey.has(key)) byKey.set(key, { name, amount: line.amount });
      }
    }
    return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [categories]);

  const otherCostSuggestions = useMemo(() => {
    const byKey = new Map<string, { name: string; amount: number }>();
    for (const category of categories) {
      const lines = [
        ...(category.otherCostItems ?? []),
        ...category.tasks.flatMap((task) => task.otherCostItems ?? []),
      ];
      for (const line of lines) {
        const name = line.costName.trim();
        if (!name || line.amount <= 0) continue;
        const key = otherCostKey(name);
        if (!byKey.has(key)) byKey.set(key, { name, amount: line.amount });
      }
    }
    return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [categories]);

  const item = target?.kind === "task" ? target.task : target?.category;
  const itemKey = target && item ? `${target.kind}-${item.id}` : "";
  // A notification can open before the navigation's refreshed data arrives.
  // Refresh read-only snapshots when history changes, preserving editor drafts.
  const historyVersion = readOnly ? (overrideHistory[itemKey] ?? []).map(log => log.id).join(",") : "";
  const progressToday = target?.kind === "task"
    ? taskProgressToday[target.task.id]
    : target ? categoryProgressToday[target.category.id] : undefined;
  const assignedIds = target?.kind === "task"
    ? (taskWorkerAssignments[target.task.id] ?? [])
    : target ? (categoryWorkerAssignments[target.category.id] ?? []) : [];
  const workerById = new Map(workers.map((worker) => [worker.id, worker]));
  const crew = assignedIds.flatMap((id) => {
    const worker = workerById.get(id);
    return worker ? [worker] : [];
  });
  const editor = selection?.key === itemKey ? logEditor(selection.log,workers,crew) : null;
  const editingLog = editor?.log ?? null;
  const editorTeam = editor ? [...workers.filter(worker=>!editor.workers.some(saved=>saved.id===worker.id)),...editor.workers] : workers;
  function close() { setSelection(null); setSummaryState(null); onClose(); }

  return (
    <Modal open={target !== null} onClose={close} size="large" bare hideCloseButton={!readOnly} title={item?.name ?? "Progress Tracking"}>
      {target && item && (
        <ProgressTrackingModalContent
          key={`${itemKey}:${target.highlightEntryDate ?? ""}:${historyVersion}:${editingLog?.id ?? "today"}`}
          editingLog={editingLog}
          initialSummaryCollapsed={summaryState?.key === itemKey ? summaryState.collapsed : !editingLog}
          onSummaryCollapsedChange={collapsed=>setSummaryState({key:itemKey,collapsed})}
          onEditHistory={!readOnly ? log=>{
            setSummaryState({key:itemKey,collapsed:false});
            setSelection(log ? {key:itemKey,log}:null);
          } : undefined}
          projectId={projectId}
          projectName={projectName}
          incidentContext={{ kind: target.kind, id: item.id, name: item.name }}
          materialStocks={materialStocks}
          readOnly={readOnly}
          estimatedQuantity={item.estimatedQuantity}
          unit={item.unit}
          plannedStartDate={item.plannedStartDate}
          plannedEndDate={item.plannedEndDate}
          plannedMaterials={groupPlannedMaterials(item.materialAssignments)}
          plannedEquipmentCosts={groupPlannedOtherCosts(item.equipmentCostItems ?? [])}
          plannedOtherCosts={groupPlannedOtherCosts(item.otherCostItems ?? [])}
          plannedCosts={target.kind === "task" ? {
            labor: target.task.laborEstimate,
            material: target.task.materialEstimate,
            equipment: target.task.equipmentEstimate,
            other: target.task.otherCostEstimate,
          } : {
            labor: target.category.categoryLaborEstimate,
            material: target.category.categoryMaterialEstimate,
            equipment: target.category.categoryEquipmentEstimate,
            other: target.category.categoryOtherEstimate,
          }}
          workingDays={workingDays}
          holidays={holidays}
          progressToday={progressToday ?? EMPTY_PROGRESS_TODAY}
          materialPrices={materialPrices}
          equipmentCostSuggestions={equipmentCostSuggestions}
          otherCostSuggestions={otherCostSuggestions}
          crew={editor?.crew ?? crew}
          team={editorTeam}
          highlightLatest={target.highlightLatest ?? false}
          highlightEntryDate={target.highlightEntryDate}
          overrideHistory={overrideHistory[itemKey] ?? []}
          backgroundSync={!!logSync}
          saving={logSync?.pendingKeys.includes(itemKey) ?? false}
          onSave={async (input) => {
            const action = () => editingLog ? editProgressLog(projectId,target.kind,item.id,editingLog.id,{...input,
              retainedMaterials:editingLog.materialsUsed.filter(row=>row.unitCost==null&&!groupPlannedMaterials(item.materialAssignments).some(planned=>planned.key===materialKey(row.name,row.unit))).map(({name,unit})=>({name,unit}))})
              : target.kind === "task" ? recordTaskProgress(target.task.id, projectId, input) : recordCategoryProgress(target.category.id, projectId, input);
            if (!logSync) return action();
            const date = editingLog?.entryDate ?? new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
            const attendance = input.attendance.map(mark => {
              const worker = editorTeam.find(worker=>worker.id===mark.workerId) ?? workerById.get(mark.workerId);
              return { workerId: mark.workerId, name: worker?.fullName ?? "Team member", hours: mark.hours, ...(mark.amount != null ? { amount: mark.amount } : {}), rate: worker?.hourlyRate ?? 0 };
            });
            const sum = (rows: { amount: number }[] = []) => rows.reduce((total, row) => total + row.amount, 0);
            const round = (amount: number) => Math.round(amount * 100) / 100;
            const log: OverrideLog = {
              id: -Date.now(), action: "saved", entryDate: date, createdAt: new Date().toISOString(),
              savedByName: user.name, savedByRole: user.roleLabel, quantityCompleted: input.quantityCompletedToday,
              costs: { material: editingLog?.costs.material ?? 0, labor: attendance.length ? round(attendance.reduce((total, mark) => total + laborEntryCost(mark), 0)) : input.costs.labor,
                equipment: round(input.costs.equipment + sum(input.equipmentCostsUsed) + sum(input.unplannedEquipmentCosts)),
                other: round(input.costs.other + sum(input.otherCostsUsed) + sum(input.unplannedOtherCosts)) },
              materialsUsed: [...input.materialsUsed, ...input.unplannedMaterials,...(editingLog?.materialsUsed.filter(row=>row.unitCost==null&&!groupPlannedMaterials(item.materialAssignments).some(planned=>planned.key===materialKey(row.name,row.unit))) ?? [])], attendance,
              equipmentCosts: [...(input.equipmentCostsUsed ?? []), ...(input.unplannedEquipmentCosts ?? []).map(row => ({ ...row, unplanned: true }))],
              otherCosts: [...(input.otherCostsUsed ?? []), ...(input.unplannedOtherCosts ?? []).map(row => ({ ...row, unplanned: true }))],
            };
            const operation = logSync.run({ kind: target.kind, id: item.id }, date, log, action);
            return operation ? operation.completion : { error: "This task is still saving. Please wait and try again." };
          }}
          onDeleteOverride={isAdmin && !readOnly ? async (entryDate) => {
            const action = () => target.kind === "task" ? deleteTaskProgressEntry(target.task.id, projectId, entryDate) : deleteCategoryProgressEntry(target.category.id, projectId, entryDate);
            if (!logSync) return action();
            return logSync.run({ kind: target.kind, id: item.id }, entryDate, null, action) ? { success: true } : { error: "This task is still saving. Please wait and try again." };
          } : undefined}
          onClose={close}
        />
      )}
    </Modal>
  );
}
