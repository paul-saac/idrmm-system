"use client";

import { useMemo } from "react";
import { Modal } from "@/components/ui/modal";
import { usePortal } from "@/components/portal/portal-context";
import { ProgressTrackingModalContent } from "./progress-tracking-modal-content";
import type { CostCategory, CostTask } from "@/lib/cost-estimate/data";
import type { ProjectOverrideHistory } from "@/lib/progress-logs/types";
import type { TaskProgressToday } from "@/lib/task-progress/data";
import { deleteTaskProgressEntry, recordTaskProgress } from "@/lib/task-progress/actions";
import { deleteCategoryProgressEntry, recordCategoryProgress } from "@/lib/category-progress/actions";
import { EMPTY_PROGRESS_ANCHOR, groupPlannedMaterials, materialKey } from "@/lib/task-progress/calculate";

export type ProgressModalTarget = (
  | { kind: "task"; task: CostTask }
  | { kind: "category"; category: CostCategory }
) & { highlightLatest?: boolean; highlightEntryDate?: string };

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
  categories,
  workingDays,
  holidays,
  taskProgressToday,
  categoryProgressToday,
  overrideHistory,
  onClose,
}: {
  target: ProgressModalTarget | null;
  readOnly?: boolean;
  projectId: number;
  categories: CostCategory[];
  workingDays: number[];
  holidays: string[];
  taskProgressToday: Record<number, TaskProgressToday>;
  categoryProgressToday: Record<number, TaskProgressToday>;
  overrideHistory: ProjectOverrideHistory;
  onClose: () => void;
}) {
  const { isAdmin } = usePortal();
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

  const item = target?.kind === "task" ? target.task : target?.category;
  const itemKey = target && item ? `${target.kind}-${item.id}` : "";
  const progressToday = target?.kind === "task"
    ? taskProgressToday[target.task.id]
    : target ? categoryProgressToday[target.category.id] : undefined;

  return (
    <Modal open={target !== null} onClose={onClose} size="large" bare title={item?.name ?? "Progress Tracking"}>
      {target && item && (
        <ProgressTrackingModalContent
          key={`${itemKey}:${target.highlightEntryDate ?? ""}`}
          readOnly={readOnly}
          estimatedQuantity={item.estimatedQuantity}
          unit={item.unit}
          plannedStartDate={item.plannedStartDate}
          plannedEndDate={item.plannedEndDate}
          plannedMaterials={groupPlannedMaterials(item.materialAssignments)}
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
          highlightLatest={target.highlightLatest ?? false}
          highlightEntryDate={target.highlightEntryDate}
          overrideHistory={overrideHistory[itemKey] ?? []}
          onSave={(input) => target.kind === "task"
            ? recordTaskProgress(target.task.id, projectId, input)
            : recordCategoryProgress(target.category.id, projectId, input)}
          onDeleteOverride={isAdmin && !readOnly ? (entryDate) => target.kind === "task"
            ? deleteTaskProgressEntry(target.task.id, projectId, entryDate)
            : deleteCategoryProgressEntry(target.category.id, projectId, entryDate)
            : undefined}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}
