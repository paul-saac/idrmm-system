"use client";

import { ChevronRight } from "lucide-react";
import { Modal, ModalFooter } from "@/components/ui/modal";
import type { CostCategory } from "@/lib/cost-estimate/data";
import { computeWeights } from "@/lib/cost-estimate/weights";

/** Which Weight cell was clicked. fromCategoryId is set when a task was
 * opened from its category's own breakdown, so Back can return there. */
export type WeightBreakdownTarget = {
  kind: "task" | "category";
  id: number;
  fromCategoryId?: number;
};

export type CostEstimateHighlightField =
  | "labor"
  | "material"
  | "equipment"
  | "other"
  | "total";

export type CostNavigateDestination = {
  kind: "task" | "category";
  id: number;
  field?: CostEstimateHighlightField;
  materialId?: number;
  materialName?: string;
  otherCostName?: string;
};

function formatCurrency(amount: number) {
  return `₱${amount.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

function formatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

type CostBreakdownRow = {
  id: string | number;
  name: string;
  amount: number;
  target?: { kind: "task" | "category"; id: number };
  materialId?: number;
  otherCostName?: string;
};

/**
 * A cost category container (Labor, Material, Equipment, Other) with its
 * header button showing label, amount, and right-pointing dropdown arrow,
 * plus the orange breakdown rows (name + amount) underneath.
 */
function CostSectionCard({
  label,
  amount,
  field,
  items,
  onNavigate,
}: {
  label: string;
  amount: number;
  field: CostEstimateHighlightField;
  items: CostBreakdownRow[];
  onNavigate: (
    targetItem?: { kind: "task" | "category"; id: number },
    field?: CostEstimateHighlightField,
    extra?: { materialId?: number; materialName?: string; otherCostName?: string }
  ) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white transition hover:border-zinc-300">
      <button
        type="button"
        onClick={() => onNavigate(undefined, field)}
        title={`Click to view ${label} in Cost Estimate Breakdown`}
        className="group flex w-full cursor-pointer items-center justify-between px-3.5 py-2.5 text-sm transition hover:bg-zinc-50"
      >
        <span className="font-medium text-zinc-600 group-hover:text-zinc-900">
          {label}
        </span>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-zinc-900 tabular-nums">
            {formatCurrency(amount)}
          </span>
          <ChevronRight className="size-4 text-zinc-400 transition group-hover:text-zinc-900" />
        </div>
      </button>

      {items.length > 0 && (
        <div className="divide-y divide-zinc-200 border-t border-zinc-200">
          {items.map((item) => (
            <div
              key={item.id}
              onClick={() =>
                onNavigate(item.target, field, {
                  materialId: item.materialId,
                  materialName: item.name,
                  otherCostName: item.otherCostName,
                })
              }
              title={`Click to view "${item.name}" in Cost Estimate Breakdown`}
              className="group flex cursor-pointer items-center justify-between bg-[rgba(252,211,77,0.08)] px-3.5 py-2 text-xs transition-colors hover:bg-[rgba(252,211,77,0.18)]"
            >
              <span className="truncate font-medium text-zinc-800">
                {item.name}
              </span>
              <span className="shrink-0 font-semibold text-zinc-900 tabular-nums">
                {formatCurrency(item.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Displays the cost breakdown of a task or category based on the Cost
 * Estimate Breakdown table, showing its component costs (Labor, Material,
 * Equipment, Other), its total cost, and the DPWH weight formula.
 * Each cost item is clickable and directs to that row in the Cost
 * Estimate Breakdown table with highlight.
 */
function WeightBreakdownContent({
  categories,
  target,
  _onSelectTask,
  onClose,
  onNavigateToCostEstimate,
}: {
  categories: CostCategory[];
  target: WeightBreakdownTarget;
  _onSelectTask?: (taskId: number) => void;
  onClose: () => void;
  onNavigateToCostEstimate?: (target: CostNavigateDestination) => void;
}) {
  const category =
    target.kind === "category"
      ? categories.find((c) => c.id === target.id)
      : categories.find((c) => c.tasks.some((t) => t.id === target.id));
  const task =
    target.kind === "task" ? category?.tasks.find((t) => t.id === target.id) : undefined;

  if (!category || (target.kind === "task" && !task)) return null;

  const hasTasks = target.kind === "category" && category.tasks.length > 0;
  const computed = computeWeights(categories);

  const costLabel = task ? "Task cost" : "Category cost";
  const weight = task
    ? (computed.taskWeights.get(task.id) ?? task.weight)
    : (computed.categoryWeights.get(category.id) ?? category.weight);

  // Component costs matching the Cost Estimate Breakdown table columns
  const labor = task
    ? task.laborEstimate
    : category.categoryLaborEstimate +
      category.tasks.reduce((sum, t) => sum + t.laborEstimate, 0);

  const material = task
    ? task.materialEstimate
    : category.categoryMaterialEstimate +
      category.tasks.reduce((sum, t) => sum + t.materialEstimate, 0);

  const equipment = task
    ? task.equipmentEstimate
    : category.categoryEquipmentEstimate +
      category.tasks.reduce((sum, t) => sum + t.equipmentEstimate, 0);

  const other = task
    ? task.otherCostEstimate
    : category.categoryOtherEstimate +
      category.tasks.reduce((sum, t) => sum + t.otherCostEstimate, 0);

  const totalCost = task
    ? task.totalEstimateCost
    : category.categoryLaborEstimate +
      category.categoryMaterialEstimate +
      category.categoryEquipmentEstimate +
      category.categoryOtherEstimate +
      category.tasks.reduce((sum, t) => sum + t.totalEstimateCost, 0);

  // Itemized breakdown rows matching Cost Estimate Breakdown table
  // 1. Material Breakdown items
  const materialItems: CostBreakdownRow[] = [];
  if (task) {
    for (const a of task.materialAssignments) {
      materialItems.push({
        id: `task-mat-${a.id}`,
        materialId: a.id,
        name: a.materialName,
        amount: a.amountOverride ?? a.plannedQuantity * a.unitCost,
        target: { kind: "task", id: task.id },
      });
    }
    const directAmt =
      task.materialDirectAmountOverride ??
      task.materialDirectQuantity * task.materialUnitCost;
    if (directAmt > 0 && (task.materialDirectQuantity > 0 || materialItems.length === 0)) {
      materialItems.push({
        id: `task-mat-direct-${task.id}`,
        name: task.name,
        amount: directAmt,
        target: { kind: "task", id: task.id },
      });
    }
  } else {
    for (const a of category.materialAssignments) {
      materialItems.push({
        id: `cat-mat-${a.id}`,
        materialId: a.id,
        name: a.materialName,
        amount: a.amountOverride ?? a.plannedQuantity * a.unitCost,
        target: { kind: "category", id: category.id },
      });
    }
    const directAmt =
      category.materialDirectAmountOverride ??
      category.materialDirectQuantity * category.materialUnitCost;
    if (directAmt > 0 && (category.materialDirectQuantity > 0 || materialItems.length === 0)) {
      materialItems.push({
        id: `cat-mat-direct-${category.id}`,
        name: category.name,
        amount: directAmt,
        target: { kind: "category", id: category.id },
      });
    }
    for (const t of category.tasks) {
      for (const a of t.materialAssignments) {
        materialItems.push({
          id: `task-${t.id}-mat-${a.id}`,
          materialId: a.id,
          name: a.materialName,
          amount: a.amountOverride ?? a.plannedQuantity * a.unitCost,
          target: { kind: "task", id: t.id },
        });
      }
      const taskDirectAmt =
        t.materialDirectAmountOverride ??
        t.materialDirectQuantity * t.materialUnitCost;
      if (
        taskDirectAmt > 0 &&
        (t.materialDirectQuantity > 0 || t.materialAssignments.length === 0)
      ) {
        materialItems.push({
          id: `task-${t.id}-mat-direct`,
          name: t.name,
          amount: taskDirectAmt,
          target: { kind: "task", id: t.id },
        });
      }
    }
  }
  if (materialItems.length === 0 && material > 0) {
    materialItems.push({
      id: "material-fallback",
      name: task ? task.name : category.name,
      amount: material,
      target: task
        ? { kind: "task", id: task.id }
        : { kind: "category", id: category.id },
    });
  }

  // 2. Other Cost items
  const otherItems: CostBreakdownRow[] = [];
  if (task) {
    for (const item of task.otherCostItems) {
      otherItems.push({
        id: `task-other-${item.id}`,
        name: item.costName,
        otherCostName: item.costName,
        amount: item.amountOverride ?? item.amount,
        target: { kind: "task", id: task.id },
      });
    }
  } else {
    for (const item of category.otherCostItems ?? []) {
      otherItems.push({
        id: `cat-other-${item.id}`,
        name: item.costName,
        otherCostName: item.costName,
        amount: item.amountOverride ?? item.amount,
        target: { kind: "category", id: category.id },
      });
    }
    for (const t of category.tasks) {
      for (const item of t.otherCostItems) {
        otherItems.push({
          id: `task-${t.id}-other-${item.id}`,
          name: item.costName,
          otherCostName: item.costName,
          amount: item.amountOverride ?? item.amount,
          target: { kind: "task", id: t.id },
        });
      }
    }
  }
  if (otherItems.length === 0 && other > 0) {
    otherItems.push({
      id: "other-fallback",
      name: "Other cost",
      amount: other,
      target: task
        ? { kind: "task", id: task.id }
        : { kind: "category", id: category.id },
    });
  }

  // 3. Labor items
  const laborItems: CostBreakdownRow[] = [];
  if (task) {
    if (labor > 0) {
      laborItems.push({
        id: `task-${task.id}-labor`,
        name: "Labor cost",
        amount: labor,
        target: { kind: "task", id: task.id },
      });
    }
  } else {
    if (category.tasks.length > 0) {
      for (const t of category.tasks) {
        if (t.laborEstimate > 0) {
          laborItems.push({
            id: `task-${t.id}-labor`,
            name: `${t.name} (Labor)`,
            amount: t.laborEstimate,
            target: { kind: "task", id: t.id },
          });
        }
      }
    }
    if (category.categoryLaborEstimate > 0) {
      laborItems.push({
        id: `cat-${category.id}-labor`,
        name: "Labor cost",
        amount: category.categoryLaborEstimate,
        target: { kind: "category", id: category.id },
      });
    }
    if (laborItems.length === 0 && labor > 0) {
      laborItems.push({
        id: "labor-fallback",
        name: "Labor cost",
        amount: labor,
        target: { kind: "category", id: category.id },
      });
    }
  }

  // 4. Equipment items
  const equipmentItems: CostBreakdownRow[] = [];
  if (task) {
    if (equipment > 0) {
      equipmentItems.push({
        id: `task-${task.id}-equipment`,
        name: "Equipment cost",
        amount: equipment,
        target: { kind: "task", id: task.id },
      });
    }
  } else {
    if (category.tasks.length > 0) {
      for (const t of category.tasks) {
        if (t.equipmentEstimate > 0) {
          equipmentItems.push({
            id: `task-${t.id}-equipment`,
            name: `${t.name} (Equipment)`,
            amount: t.equipmentEstimate,
            target: { kind: "task", id: t.id },
          });
        }
      }
    }
    if (category.categoryEquipmentEstimate > 0) {
      equipmentItems.push({
        id: `cat-${category.id}-equipment`,
        name: "Equipment cost",
        amount: category.categoryEquipmentEstimate,
        target: { kind: "category", id: category.id },
      });
    }
    if (equipmentItems.length === 0 && equipment > 0) {
      equipmentItems.push({
        id: "equipment-fallback",
        name: "Equipment cost",
        amount: equipment,
        target: { kind: "category", id: category.id },
      });
    }
  }

  function handleNavigate(
    targetItem?: { kind: "task" | "category"; id: number },
    field?: CostEstimateHighlightField,
    extra?: { materialId?: number; materialName?: string; otherCostName?: string }
  ) {
    const dest = targetItem ?? { kind: target.kind, id: target.id };
    onClose();
    onNavigateToCostEstimate?.({
      ...dest,
      field,
      materialId: extra?.materialId,
      materialName: extra?.materialName,
      otherCostName: extra?.otherCostName,
    });
  }

  return (
    <div className="flex h-full min-h-full flex-col gap-5">
      {/* Header: Name and Weight Badge */}
      <div className="-mx-6 -mt-1 flex items-center justify-between gap-4 border-b border-zinc-200 px-6 pb-4">
        <div className="min-w-0">
          {task && <p className="truncate text-xs text-zinc-400">{category.name}</p>}
          <h3 className="truncate text-base font-semibold text-zinc-900">
            {task ? task.name : category.name}
          </h3>
        </div>
        <div className="shrink-0 text-right">
          <span className="text-base font-semibold text-zinc-900 tabular-nums">
            {formatPercent(weight)}
          </span>
        </div>
      </div>

      {/* Cost Breakdown based on Cost Estimate Breakdown table */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Cost Breakdown
          </span>
          <span className="text-[11px] text-zinc-400">
            Click to view in Cost Estimate Breakdown
          </span>
        </div>

        <div className="flex flex-col gap-2.5">
          <CostSectionCard
            label="Labor"
            amount={labor}
            field="labor"
            items={laborItems}
            onNavigate={handleNavigate}
          />
          <CostSectionCard
            label="Material"
            amount={material}
            field="material"
            items={materialItems}
            onNavigate={handleNavigate}
          />
          <CostSectionCard
            label="Equipment"
            amount={equipment}
            field="equipment"
            items={equipmentItems}
            onNavigate={handleNavigate}
          />
          <CostSectionCard
            label="Other"
            amount={other}
            field="other"
            items={otherItems}
            onNavigate={handleNavigate}
          />

          <button
            type="button"
            onClick={() => handleNavigate(undefined, "total")}
            title={`Click to view ${costLabel} in Cost Estimate Breakdown`}
            className="group mt-1 flex w-full cursor-pointer items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-3 text-sm font-semibold text-zinc-900 transition hover:border-zinc-400 hover:bg-zinc-100"
          >
            <span>{costLabel}</span>
            <div className="flex items-center gap-2">
              <span className="text-base tabular-nums font-bold">
                {formatCurrency(totalCost)}
              </span>
              <ChevronRight className="size-4 text-zinc-400 transition group-hover:text-zinc-900" />
            </div>
          </button>
        </div>
      </div>

      {/* If category has subtasks, show itemized subtasks breakdown */}
      {hasTasks && (
        <div className="flex flex-col gap-2 border-t border-zinc-200 pt-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Subtasks Breakdown
            </span>
            <span className="text-[11px] text-zinc-400">
              {category.tasks.length} {category.tasks.length === 1 ? "task" : "tasks"}
            </span>
          </div>

          <div className="max-h-56 overflow-y-auto rounded-lg border border-zinc-200">
            <table className="w-full table-fixed text-xs">
              <thead className="sticky top-0 bg-zinc-50 text-zinc-500 border-b border-zinc-200">
                <tr>
                  <th className="py-2 pl-3 pr-2 text-left font-medium">Task</th>
                  <th className="py-2 px-2 text-right font-medium">Labor</th>
                  <th className="py-2 px-2 text-right font-medium">Material</th>
                  <th className="py-2 px-2 text-right font-medium">Total</th>
                  <th className="py-2 pr-3 pl-2 text-right font-medium w-16">Weight</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white">
                {category.tasks.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => handleNavigate({ kind: "task", id: t.id })}
                    title={`Click to view "${t.name}" in Cost Estimate Breakdown`}
                    className="group cursor-pointer transition hover:bg-zinc-900 hover:text-white"
                  >
                    <td className="truncate py-2 pl-3 pr-2 font-medium">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="truncate">{t.name}</span>
                        <ChevronRight className="size-3.5 shrink-0 opacity-0 transition group-hover:opacity-100" />
                      </div>
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      {formatCurrency(t.laborEstimate)}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      {formatCurrency(t.materialEstimate)}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums font-semibold">
                      {formatCurrency(t.totalEstimateCost)}
                    </td>
                    <td className="py-2 pr-3 pl-2 text-right tabular-nums">
                      {formatPercent(computed.taskWeights.get(t.id) ?? t.weight)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Formula Explanation Card */}
      <div className="flex flex-col gap-1 rounded-md bg-zinc-50 px-4 py-3 text-xs text-zinc-600 tabular-nums">
        <p className="font-medium text-zinc-700">
          Weight = {costLabel} ÷ Total project cost × 100
        </p>
        {computed.projectCost > 0 ? (
          <>
            <p>
              = {formatCurrency(totalCost)} ÷ {formatCurrency(computed.projectCost)} × 100
            </p>
            <p className="font-semibold text-zinc-900">= {formatPercent(weight)}</p>
          </>
        ) : (
          <p className="font-semibold text-zinc-900">= 0.00%</p>
        )}
      </div>

      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Close
        </button>
      </ModalFooter>
    </div>
  );
}

/** The Weight Breakdown side panel, opened from a Weight cell in the
 * Gantt chart or the Cost Estimate table. `target` null means closed. */
export function WeightBreakdownModal({
  projectId: _projectId,
  categories,
  target,
  onTargetChange,
  onNavigateToCostEstimate,
}: {
  projectId: number;
  categories: CostCategory[];
  target: WeightBreakdownTarget | null;
  onTargetChange: (target: WeightBreakdownTarget | null) => void;
  onNavigateToCostEstimate?: (target: CostNavigateDestination) => void;
}) {
  const close = () => onTargetChange(null);
  const backTo = target?.fromCategoryId;
  return (
    <Modal
      open={target !== null}
      onClose={close}
      onBack={
        backTo !== undefined
          ? () => onTargetChange({ kind: "category", id: backTo })
          : undefined
      }
      title="Weight Breakdown"
    >
      {target && (
        <WeightBreakdownContent
          key={`${target.kind}-${target.id}`}
          categories={categories}
          target={target}
          _onSelectTask={(taskId) =>
            onTargetChange({ kind: "task", id: taskId, fromCategoryId: target.id })
          }
          onClose={close}
          onNavigateToCostEstimate={onNavigateToCostEstimate}
        />
      )}
    </Modal>
  );
}
