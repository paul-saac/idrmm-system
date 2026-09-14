"use client";

import { Fragment, useActionState, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { CategoryForm } from "@/components/projects/cost-estimate/category-form";
import { TaskForm } from "@/components/projects/cost-estimate/task-form";
import {
  deleteCategory,
  deleteTask,
  type CostEstimateActionState,
} from "@/lib/cost-estimate/actions";
import type { CostEstimate, CostTask } from "@/lib/cost-estimate/data";

// Accept null/undefined even though the props are typed as plain `number`
// — lib/cost-estimate/data.ts already coalesces every numeric field to 0,
// but these are the exact functions that crashed on a raw DB null before
// that fix, so they stay defensive rather than trusting the type alone.
function formatCurrency(amount: number | null | undefined) {
  return `₱${(amount ?? 0).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

function formatWeight(weight: number | null | undefined) {
  return `${(weight ?? 0).toFixed(2)}%`;
}

const deleteInitialState: CostEstimateActionState = {};

export function CategoryDeleteButton({
  categoryId,
  projectId,
  categoryName,
}: {
  categoryId: number;
  projectId: number;
  categoryName: string;
}) {
  const boundAction = deleteCategory.bind(null, categoryId, projectId);
  const [state, formAction, pending] = useActionState(
    boundAction,
    deleteInitialState
  );

  return (
    <span className="relative inline-flex">
      <form
        action={formAction}
        onSubmit={(e) => {
          if (!window.confirm(`Delete "${categoryName}"?`)) {
            e.preventDefault();
          }
        }}
      >
        <button
          type="submit"
          disabled={pending}
          aria-label="Delete category"
          className="cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Trash2 className="size-3.5" />
        </button>
      </form>
      {state?.error && (
        <span
          role="alert"
          className="absolute top-full left-1/2 z-10 mt-1 w-48 -translate-x-1/2 rounded-md border border-red-200 bg-white px-2 py-1 text-center text-xs font-normal text-red-600 normal-case shadow-sm"
        >
          {state.error}
        </span>
      )}
    </span>
  );
}

export function TaskDeleteButton({
  taskId,
  projectId,
  taskName,
}: {
  taskId: number;
  projectId: number;
  taskName: string;
}) {
  const boundAction = deleteTask.bind(null, taskId, projectId);
  const [state, formAction, pending] = useActionState(
    boundAction,
    deleteInitialState
  );

  return (
    <span className="relative inline-flex">
      <form
        action={formAction}
        onSubmit={(e) => {
          if (!window.confirm(`Delete "${taskName}"?`)) {
            e.preventDefault();
          }
        }}
      >
        <button
          type="submit"
          disabled={pending}
          aria-label="Delete task item"
          className="cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Trash2 className="size-3.5" />
        </button>
      </form>
      {state?.error && (
        <span
          role="alert"
          className="absolute top-full right-0 z-10 mt-1 w-48 rounded-md border border-red-200 bg-white px-2 py-1 text-right text-xs font-normal text-red-600 shadow-sm"
        >
          {state.error}
        </span>
      )}
    </span>
  );
}

export function CostEstimateView({
  projectId,
  estimate,
}: {
  projectId: number;
  estimate: CostEstimate;
}) {
  const [manageMode, setManageMode] = useState(false);
  const [categoryModal, setCategoryModal] = useState<
    | { mode: "add" }
    | { mode: "edit"; category: { id: number; name: string } }
    | null
  >(null);
  const [taskModal, setTaskModal] = useState<
    | { mode: "add"; defaultCategoryId?: number }
    | { mode: "edit"; task: CostTask }
    | null
  >(null);
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<number>>(
    new Set()
  );

  function toggleExpanded(taskId: number) {
    setExpandedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }

  const { categories, summary } = estimate;
  const categoryOptions = categories.map((c) => ({ id: c.id, name: c.name }));
  // Every task across every phase, for the Predecessor dropdown — a task
  // can depend on a task in a different phase (e.g. "Pour Slab" waiting
  // on "Site Grading" from an earlier phase), not just its own siblings.
  const allTasks = categories.flatMap((c) =>
    c.tasks.map((t) => ({ id: t.id, name: t.name, categoryName: c.name }))
  );
  const columnCount = 9 + (manageMode ? 1 : 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-zinc-200 bg-white p-5">
          <p className="text-sm text-zinc-500">Total Estimated Cost</p>
          <p className="mt-2 text-xl font-semibold text-zinc-900 underline decoration-zinc-300 underline-offset-4">
            {formatCurrency(summary.totalEstimatedCost)}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-5">
          <p className="text-sm text-zinc-500">Total Phase</p>
          <p className="mt-2 text-xl font-semibold text-zinc-900 underline decoration-zinc-300 underline-offset-4">
            {String(summary.categoryCount).padStart(2, "0")}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-5">
          <p className="text-sm text-zinc-500">Total Task Items</p>
          <p className="mt-2 text-xl font-semibold text-zinc-900 underline decoration-zinc-300 underline-offset-4">
            {String(summary.taskCount).padStart(2, "0")}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setManageMode((m) => !m)}
          aria-label="Toggle edit mode"
          aria-pressed={manageMode}
          className={`cursor-pointer rounded border p-2 transition ${
            manageMode
              ? "border-zinc-900 bg-zinc-900 text-white"
              : "border-zinc-200 text-zinc-500 hover:bg-zinc-50"
          }`}
        >
          <Pencil className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => setCategoryModal({ mode: "add" })}
          className="flex cursor-pointer items-center gap-1.5 rounded border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          <Plus className="size-4" />
          Add Category
        </button>
        <button
          type="button"
          onClick={() => setTaskModal({ mode: "add" })}
          className="flex cursor-pointer items-center gap-1.5 rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800"
        >
          <Plus className="size-4" />
          Add Task Item
        </button>
      </div>

      {categories.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white py-16 text-center">
          <p className="text-sm font-medium text-zinc-700">
            No cost estimate yet
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            Add a category to start building the cost breakdown structure.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
              <tr>
                <th className="px-4 py-2.5">Categories</th>
                <th className="px-4 py-2.5">Estimated Quantity</th>
                <th className="px-4 py-2.5">Unit</th>
                <th className="px-4 py-2.5">Labor</th>
                <th className="px-4 py-2.5">Material</th>
                <th className="px-4 py-2.5">Equipment</th>
                <th className="px-4 py-2.5">Other</th>
                <th className="px-4 py-2.5">Total Estimated Cost</th>
                <th className="px-4 py-2.5">Weight</th>
                {manageMode && (
                  <th className="px-4 py-2.5 text-right">Action</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {categories.map((category) => (
                <Fragment key={category.id}>
                  <tr className="bg-zinc-100 text-xs font-semibold text-zinc-700 uppercase">
                    <td className="px-4 py-2" colSpan={8}>
                      <span className="flex items-center gap-2 normal-case">
                        {category.name}
                        {manageMode && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                setCategoryModal({
                                  mode: "edit",
                                  category: {
                                    id: category.id,
                                    name: category.name,
                                  },
                                })
                              }
                              aria-label="Edit category"
                              className="cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <CategoryDeleteButton
                              categoryId={category.id}
                              projectId={projectId}
                              categoryName={category.name}
                            />
                          </>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {formatWeight(category.weight)}
                    </td>
                    {manageMode && <td className="px-4 py-2" />}
                  </tr>

                  {category.tasks.map((task) => {
                    const hasOtherCosts = task.otherCostItems.length > 0;
                    const expanded = expandedTaskIds.has(task.id);
                    return (
                      <Fragment key={task.id}>
                        <tr className="transition-colors hover:bg-zinc-50">
                          <td className="px-4 py-2.5 pl-8 font-medium text-zinc-900">
                            {task.name}
                          </td>
                          <td className="px-4 py-2.5 text-zinc-600">
                            {task.estimatedQuantity}
                          </td>
                          <td className="px-4 py-2.5 text-zinc-600">
                            {task.unit ?? "—"}
                          </td>
                          <td className="px-4 py-2.5 text-zinc-600">
                            {formatCurrency(task.laborEstimate)}
                          </td>
                          <td className="px-4 py-2.5 text-zinc-600">
                            {formatCurrency(task.materialEstimate)}
                          </td>
                          <td className="px-4 py-2.5 text-zinc-600">
                            {formatCurrency(task.equipmentEstimate)}
                          </td>
                          <td className="px-4 py-2.5 text-zinc-600">
                            {hasOtherCosts ? (
                              <button
                                type="button"
                                onClick={() => toggleExpanded(task.id)}
                                aria-expanded={expanded}
                                aria-label={
                                  expanded
                                    ? "Collapse other cost breakdown"
                                    : "Expand other cost breakdown"
                                }
                                className="flex cursor-pointer items-center gap-1 text-zinc-600 transition hover:text-zinc-900"
                              >
                                {formatCurrency(task.otherCostEstimate)}
                                {expanded ? (
                                  <ChevronDown className="size-3.5" />
                                ) : (
                                  <ChevronRight className="size-3.5" />
                                )}
                              </button>
                            ) : (
                              formatCurrency(0)
                            )}
                          </td>
                          <td className="px-4 py-2.5 font-medium text-zinc-900">
                            {formatCurrency(task.totalEstimateCost)}
                          </td>
                          <td className="px-4 py-2.5 text-zinc-600">
                            {formatWeight(task.weight)}
                          </td>
                          {manageMode && (
                            <td className="px-4 py-2.5">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setTaskModal({ mode: "edit", task })
                                  }
                                  aria-label="Edit task item"
                                  className="cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
                                >
                                  <Pencil className="size-3.5" />
                                </button>
                                <TaskDeleteButton
                                  taskId={task.id}
                                  projectId={projectId}
                                  taskName={task.name}
                                />
                              </div>
                            </td>
                          )}
                        </tr>
                        {expanded && hasOtherCosts && (
                          <tr className="bg-zinc-50/60">
                            <td className="px-4 py-2" colSpan={columnCount}>
                              <ul className="ml-8 flex flex-col gap-0.5 text-xs text-zinc-500">
                                {task.otherCostItems.map((item) => (
                                  <li
                                    key={item.id}
                                    className="flex items-center gap-2"
                                  >
                                    <span>{item.costName}</span>
                                    <span className="text-zinc-300">—</span>
                                    <span className="font-medium text-zinc-700">
                                      {formatCurrency(item.amount)}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-zinc-900 text-sm font-semibold text-white">
                <td className="px-4 py-3" colSpan={3}>
                  PROJECT TOTAL
                </td>
                <td className="px-4 py-3">
                  {formatCurrency(summary.totalsByColumn.labor)}
                </td>
                <td className="px-4 py-3">
                  {formatCurrency(summary.totalsByColumn.material)}
                </td>
                <td className="px-4 py-3">
                  {formatCurrency(summary.totalsByColumn.equipment)}
                </td>
                <td className="px-4 py-3">
                  {formatCurrency(summary.totalsByColumn.other)}
                </td>
                <td className="px-4 py-3">
                  {formatCurrency(summary.totalEstimatedCost)}
                </td>
                <td className="px-4 py-3">100.00%</td>
                {manageMode && <td className="px-4 py-3" />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <Modal
        open={categoryModal !== null}
        onClose={() => setCategoryModal(null)}
        title={categoryModal?.mode === "edit" ? "Edit Category" : "Add Category"}
      >
        <CategoryForm
          projectId={projectId}
          category={
            categoryModal?.mode === "edit" ? categoryModal.category : undefined
          }
          onSuccess={() => setCategoryModal(null)}
        />
      </Modal>

      <Modal
        open={taskModal !== null}
        onClose={() => setTaskModal(null)}
        title={taskModal?.mode === "edit" ? "Edit Task Item" : "Add Task Item"}
      >
        <TaskForm
          projectId={projectId}
          categories={categoryOptions}
          tasks={allTasks}
          task={taskModal?.mode === "edit" ? taskModal.task : undefined}
          defaultCategoryId={
            taskModal?.mode === "add" ? taskModal.defaultCategoryId : undefined
          }
          onSuccess={() => setTaskModal(null)}
        />
      </Modal>
    </div>
  );
}
