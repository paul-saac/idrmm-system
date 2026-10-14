"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import {
  updateCategoryCostComponents,
  updateTaskCostComponents,
} from "@/lib/cost-estimate/actions";
import type { CostCategory } from "@/lib/cost-estimate/data";
import { categoryDirectCost, computeWeights } from "@/lib/cost-estimate/weights";

/** Which Weight cell was clicked. fromCategoryId is set when a task was
 * opened from its category's own breakdown, so Back can return there. */
export type WeightBreakdownTarget = {
  kind: "task" | "category";
  id: number;
  fromCategoryId?: number;
};

function formatCurrency(amount: number) {
  return `₱${amount.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

function formatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

// An empty input counts as 0; anything else must be a real, non-negative
// number — null flags it as invalid.
function parseAmount(value: string): number | null {
  if (!value.trim()) return 0;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function ComponentRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4">
      <span className="w-24 shrink-0 text-sm text-zinc-600">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function AmountInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-zinc-400">
        ₱
      </span>
      <input
        type="number"
        min={0}
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="w-full rounded-md border border-zinc-200 py-2 pr-3 pl-7 text-right text-sm tabular-nums outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
      />
    </div>
  );
}

function ReadOnlyAmount({ amount }: { amount: number }) {
  return (
    <div className="flex-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-right text-sm text-zinc-500 tabular-nums">
      {formatCurrency(amount)}
    </div>
  );
}

/**
 * How a task's (or category's) weight is computed — its cost over the
 * project's total cost (lib/cost-estimate/weights.ts) — with that cost's
 * own components (Labor, Material, Equipment, Other) editable in place.
 * The weight and formula update live as values change, by rerunning the
 * same computeWeights getCostEstimate uses on the edited copy; Save
 * persists them (updateTaskCostComponents / updateCategoryCostComponents
 * — see the first's doc comment for how a typed Material total sits on
 * top of a task's itemized Material Breakdown lines). A category with
 * tasks lists its tasks instead, each opening its own breakdown.
 */
function WeightBreakdownContent({
  projectId,
  categories,
  target,
  onSelectTask,
  onClose,
}: {
  projectId: number;
  categories: CostCategory[];
  target: WeightBreakdownTarget;
  onSelectTask: (taskId: number) => void;
  onClose: () => void;
}) {
  const category =
    target.kind === "category"
      ? categories.find((c) => c.id === target.id)
      : categories.find((c) => c.tasks.some((t) => t.id === target.id));
  const task =
    target.kind === "task" ? category?.tasks.find((t) => t.id === target.id) : undefined;

  // Each component's stored value — what the inputs start from.
  const saved = task
    ? {
        labor: task.laborEstimate,
        material: task.materialEstimate,
        equipment: task.equipmentEstimate,
        other: task.otherCostEstimate,
      }
    : {
        labor: category?.categoryLaborEstimate ?? 0,
        material: category?.categoryMaterialEstimate ?? 0,
        equipment: category?.categoryEquipmentEstimate ?? 0,
        other: category?.categoryOtherEstimate ?? 0,
      };

  const [labor, setLabor] = useState(() => String(saved.labor));
  const [material, setMaterial] = useState(() => String(saved.material));
  const [equipment, setEquipment] = useState(() => String(saved.equipment));
  const [other, setOther] = useState(() => String(saved.other));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!category || (target.kind === "task" && !task)) return null;

  const hasTasks = category.tasks.length > 0;
  const editable = Boolean(task) || !hasTasks;
  const otherItemized = (task?.otherCostItems.length ?? 0) > 0;
  // Its itemized Material Breakdown lines (a task's, or a standalone
  // category's own) — its Material total can't go below them (see
  // updateTaskCostComponents).
  const itemizedMaterial = (task ?? category).materialAssignments.reduce(
    (sum, line) => sum + (line.amountOverride ?? line.plannedQuantity * line.unitCost),
    0
  );

  const parsed = {
    labor: parseAmount(labor),
    material: parseAmount(material),
    equipment: parseAmount(equipment),
    other: otherItemized ? saved.other : parseAmount(other),
  };
  const valid =
    parsed.labor !== null &&
    parsed.material !== null &&
    parsed.equipment !== null &&
    parsed.other !== null;
  const amounts = valid
    ? {
        labor: parsed.labor!,
        material: parsed.material!,
        equipment: parsed.equipment!,
        other: parsed.other!,
      }
    : saved;
  const dirty =
    valid &&
    (amounts.labor !== saved.labor ||
      amounts.material !== saved.material ||
      amounts.equipment !== saved.equipment ||
      amounts.other !== saved.other);
  const componentsTotal = amounts.labor + amounts.material + amounts.equipment + amounts.other;

  // The edited copy — only once something actually changed, so an
  // untouched breakdown shows exactly the stored numbers.
  const preview = !dirty
    ? categories
    : categories.map((c) => {
        if (c.id !== category.id) return c;
        if (!task) {
          return {
            ...c,
            categoryLaborEstimate: amounts.labor,
            categoryMaterialEstimate: amounts.material,
            categoryEquipmentEstimate: amounts.equipment,
            categoryOtherEstimate: amounts.other,
          };
        }
        return {
          ...c,
          tasks: c.tasks.map((t) =>
            t.id === task.id ? { ...t, totalEstimateCost: componentsTotal } : t
          ),
        };
      });

  const before = computeWeights(categories);
  const after = computeWeights(preview);
  const directCost = categoryDirectCost(category);
  const cost = task
    ? (after.taskCosts.get(task.id) ?? 0)
    : (after.categoryCosts.get(category.id) ?? 0);
  const weight = task
    ? (after.taskWeights.get(task.id) ?? 0)
    : (after.categoryWeights.get(category.id) ?? 0);
  const savedWeight = task
    ? (before.taskWeights.get(task.id) ?? 0)
    : (before.categoryWeights.get(category.id) ?? 0);
  const costLabel = task ? "Task cost" : "Category cost";
  const taskOwnTotal = task ? (dirty ? componentsTotal : task.totalEstimateCost) : 0;

  async function handleSave() {
    if (!valid) {
      setError("Costs must be 0 or more.");
      return;
    }
    if (amounts.material < itemizedMaterial - 0.005) {
      setError(
        `Material can't be less than this ${task ? "task" : "main task"}'s itemized materials (${formatCurrency(itemizedMaterial)}) — lower those in the Material Breakdown.`
      );
      return;
    }
    setError(null);
    setPending(true);
    const input = {
      laborEstimate: amounts.labor,
      materialEstimate: amounts.material,
      equipmentEstimate: amounts.equipment,
      otherCostEstimate: amounts.other,
    };
    const result = task
      ? await updateTaskCostComponents(task.id, projectId, input)
      : await updateCategoryCostComponents(category!.id, projectId, input);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onClose();
  }

  return (
    <div className="flex h-full min-h-full flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          {task && <p className="truncate text-xs text-zinc-400">{category.name}</p>}
          <p className="truncate text-base font-semibold text-zinc-900">
            {task ? task.name : category.name}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-2xl font-semibold text-zinc-900 tabular-nums">
            {formatPercent(weight)}
          </p>
          {dirty && formatPercent(weight) !== formatPercent(savedWeight) && (
            <p className="text-xs text-zinc-400 tabular-nums">
              was {formatPercent(savedWeight)}
            </p>
          )}
        </div>
      </div>

      {editable ? (
        <div className="flex flex-col gap-2.5">
          <ComponentRow label="Labor">
            <AmountInput label="Labor" value={labor} onChange={setLabor} />
          </ComponentRow>
          <ComponentRow label="Material">
            <AmountInput label="Material" value={material} onChange={setMaterial} />
          </ComponentRow>
          <ComponentRow label="Equipment">
            <AmountInput label="Equipment" value={equipment} onChange={setEquipment} />
          </ComponentRow>
          <ComponentRow label="Other">
            {otherItemized ? (
              <ReadOnlyAmount amount={saved.other} />
            ) : (
              <AmountInput label="Other" value={other} onChange={setOther} />
            )}
          </ComponentRow>
          {task && directCost > 0 && (
            <ComponentRow label="Category share">
              <ReadOnlyAmount amount={cost - Math.max(0, taskOwnTotal)} />
            </ComponentRow>
          )}
          <div className="mt-1 flex items-center justify-between border-t border-zinc-200 pt-3 text-sm font-semibold text-zinc-900">
            <span>{costLabel}</span>
            <span className="tabular-nums">{formatCurrency(cost)}</span>
          </div>
        </div>
      ) : (
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="text-xs text-zinc-400">
              <th className="pb-2 text-left font-medium">Task</th>
              <th className="pb-2 text-right font-medium">Cost</th>
              <th className="w-24 pb-2 text-right font-medium">Weight</th>
            </tr>
          </thead>
          <tbody>
            {category.tasks.map((t) => (
              <tr key={t.id} className="text-zinc-600">
                <td className="truncate py-1.5 pr-4">
                  <button
                    type="button"
                    onClick={() => onSelectTask(t.id)}
                    className="max-w-full cursor-pointer truncate text-left underline-offset-2 transition hover:text-zinc-900 hover:underline"
                  >
                    {t.name}
                  </button>
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {formatCurrency(after.taskCosts.get(t.id) ?? 0)}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {formatPercent(after.taskWeights.get(t.id) ?? 0)}
                </td>
              </tr>
            ))}
            <tr className="border-t border-zinc-200 font-semibold text-zinc-900">
              <td className="pt-2 pr-4">{costLabel}</td>
              <td className="pt-2 text-right tabular-nums">{formatCurrency(cost)}</td>
              <td className="pt-2 text-right tabular-nums">{formatPercent(weight)}</td>
            </tr>
          </tbody>
        </table>
      )}

      <div className="flex flex-col gap-1 rounded-md bg-zinc-50 px-4 py-3 text-xs text-zinc-600 tabular-nums">
        <p>Weight = {costLabel} ÷ Total project cost × 100</p>
        {after.projectCost > 0 ? (
          <>
            <p>
              = {formatCurrency(cost)} ÷ {formatCurrency(after.projectCost)} × 100
            </p>
            <p className="font-semibold text-zinc-900">= {formatPercent(weight)}</p>
          </>
        ) : (
          <p className="font-semibold text-zinc-900">= 0.00%</p>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {editable && (
        <div className="mt-auto flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || pending}
            className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Saving..." : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

/** The Weight Breakdown side panel, opened from a Weight cell in the
 * Gantt chart or the Cost Estimate table. `target` null means closed. */
export function WeightBreakdownModal({
  projectId,
  categories,
  target,
  onTargetChange,
}: {
  projectId: number;
  categories: CostCategory[];
  target: WeightBreakdownTarget | null;
  onTargetChange: (target: WeightBreakdownTarget | null) => void;
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
          // A fresh form (inputs, error) for every task/category opened.
          key={`${target.kind}-${target.id}`}
          projectId={projectId}
          categories={categories}
          target={target}
          onSelectTask={(taskId) =>
            onTargetChange({ kind: "task", id: taskId, fromCategoryId: target.id })
          }
          onClose={close}
        />
      )}
    </Modal>
  );
}
