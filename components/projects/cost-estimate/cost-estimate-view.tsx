"use client";

import { Fragment, useActionState, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
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

const MIN_CATEGORIES_WIDTH = 200;
const DEFAULT_CATEGORIES_WIDTH = 280;

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
  // Editing only — adding a category or task item now happens from the
  // Gantt Chart tab instead (see gantt-chart-view.tsx's own Add Phase/
  // Add Task, which write to this same cost estimate data), so there's
  // no "add" mode to track here anymore, just which existing row (if
  // any) is open for editing.
  const [categoryModal, setCategoryModal] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [taskModal, setTaskModal] = useState<CostTask | null>(null);
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<number>>(
    new Set()
  );
  // Every phase starts expanded (unlike Daily Logs' own list, this table
  // is normally browsed as "the whole estimate," not scanned
  // chronologically) — collapsing one is opt-in per phase.
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState<
    Set<number>
  >(new Set());
  // The only resizable column — a task name can run much longer than
  // any of the fixed numeric columns need, so this one's width is
  // user-controlled instead of guessing a single width that fits every
  // project's own naming style.
  const [categoriesWidth, setCategoriesWidth] = useState(
    DEFAULT_CATEGORIES_WIDTH
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

  function toggleCategory(categoryId: number) {
    setCollapsedCategoryIds((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  }

  function handleCategoriesResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = categoriesWidth;

    function onMove(ev: MouseEvent) {
      const delta = ev.clientX - startX;
      setCategoriesWidth(Math.max(MIN_CATEGORIES_WIDTH, startWidth + delta));
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const { categories, summary } = estimate;
  const categoryOptions = categories.map((c) => ({ id: c.id, name: c.name }));
  const columnCount = 9 + (manageMode ? 1 : 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* A plain fill bar, not a border-b — see StatCard's own comment
            in project-detail-view.tsx for why a border-b here mitered a
            visible diagonal notch into the corner instead of a straight
            edge. */}
        <div className="relative rounded-t-lg border border-zinc-200 bg-white p-5">
          <p className="text-sm text-zinc-500">Total Estimated Cost</p>
          <p className="mt-2 text-xl font-semibold text-zinc-900">
            {formatCurrency(summary.totalEstimatedCost)}
          </p>
          <div className="absolute inset-x-0 bottom-0 h-1 bg-zinc-900" />
        </div>
        <div className="relative rounded-t-lg border border-zinc-200 bg-white p-5">
          <p className="text-sm text-zinc-500">Total Phase</p>
          <p className="mt-2 text-xl font-semibold text-zinc-900">
            {String(summary.categoryCount).padStart(2, "0")}
          </p>
          <div className="absolute inset-x-0 bottom-0 h-1 bg-zinc-900" />
        </div>
        <div className="relative rounded-t-lg border border-zinc-200 bg-white p-5">
          <p className="text-sm text-zinc-500">Total Task Items</p>
          <p className="mt-2 text-xl font-semibold text-zinc-900">
            {String(summary.taskCount).padStart(2, "0")}
          </p>
          <div className="absolute inset-x-0 bottom-0 h-1 bg-zinc-900" />
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
      </div>

      {categories.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white py-16 text-center">
          <p className="text-sm font-medium text-zinc-700">
            No cost estimate yet
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            Add a phase and task items from the Gantt Chart tab to start
            building the cost breakdown structure.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
                <tr>
                  <th
                    style={{ width: categoriesWidth }}
                    className="relative border-r border-zinc-200 px-4 py-2.5"
                  >
                    Categories
                    {/* The one resize handle in this table — a wider
                        invisible drag target than the border itself, so
                        it's actually easy to grab. */}
                    <div
                      onMouseDown={handleCategoriesResizeMouseDown}
                      className="absolute top-0 right-0 z-10 h-full w-2 cursor-col-resize"
                    />
                  </th>
                  <th className="w-44 border-r border-zinc-200 px-4 py-2.5 text-right whitespace-nowrap">
                    Estimated Quantity
                  </th>
                  <th className="w-20 border-r border-zinc-200 px-4 py-2.5">
                    Unit
                  </th>
                  <th className="w-28 border-r border-zinc-200 px-4 py-2.5 text-right">
                    Labor
                  </th>
                  <th className="w-28 border-r border-zinc-200 px-4 py-2.5 text-right">
                    Material
                  </th>
                  <th className="w-28 border-r border-zinc-200 px-4 py-2.5 text-right">
                    Equipment
                  </th>
                  <th className="w-24 border-r border-zinc-200 px-4 py-2.5 text-right">
                    Other
                  </th>
                  <th className="w-48 border-r border-zinc-200 px-4 py-2.5 text-right whitespace-nowrap">
                    Total Estimated Cost
                  </th>
                  <th
                    className={`w-24 px-4 py-2.5 text-right ${manageMode ? "border-r border-zinc-200" : ""}`}
                  >
                    Weight
                  </th>
                  {manageMode && (
                    <th className="w-24 px-4 py-2.5 text-right">Action</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => {
                  // Milestones are point-in-time schedule markers (the
                  // Gantt Chart's own diamond rows) created from its own
                  // lightweight Add Task form, which never asks for
                  // quantity/cost — so in practice one always lands here
                  // at ₱0, a dead row. But isMilestone doesn't actually
                  // lock a task out of having real cost fields (this
                  // page's own Edit form doesn't special-case it either;
                  // see CostTask's own doc comment) — an admin could
                  // still deliberately cost one out (e.g. a permit fee
                  // tied to a "Permit Approved" milestone), so only a
                  // milestone that's *actually* still ₱0 gets hidden,
                  // never one that's had a real cost entered against it.
                  const tasks = category.tasks.filter(
                    (t) => !t.isMilestone || t.totalEstimateCost > 0
                  );
                  const isOpen = !collapsedCategoryIds.has(category.id);
                  return (
                    <Fragment key={category.id}>
                      <tr className="border-y border-zinc-100 border-l-2 border-l-zinc-900 bg-zinc-50/60">
                        <td
                          className="border-r border-zinc-200 px-4 py-2.5"
                          colSpan={8}
                        >
                          <span className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => toggleCategory(category.id)}
                              className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-zinc-800 transition hover:text-zinc-900"
                            >
                              {isOpen ? (
                                <ChevronDown className="size-3.5 flex-shrink-0 text-zinc-400" />
                              ) : (
                                <ChevronRight className="size-3.5 flex-shrink-0 text-zinc-400" />
                              )}
                              {category.name}
                            </button>
                            {manageMode && (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCategoryModal({
                                      id: category.id,
                                      name: category.name,
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
                        <td
                          className={`border-r border-zinc-200 px-4 py-2.5 text-right text-sm font-semibold text-zinc-800 ${manageMode ? "" : "border-r-0"}`}
                        >
                          {formatWeight(category.weight)}
                        </td>
                        {manageMode && <td className="px-4 py-2.5" />}
                      </tr>

                      {isOpen &&
                        tasks.map((task) => {
                        const hasOtherCosts = task.otherCostItems.length > 0;
                        const expanded = expandedTaskIds.has(task.id);
                        return (
                          <Fragment key={task.id}>
                            <tr className="border-b border-zinc-100 transition-colors hover:bg-zinc-50">
                              <td className="truncate border-r border-zinc-200 px-4 py-2.5 pl-8 font-medium text-zinc-900">
                                {task.name}
                              </td>
                              <td className="border-r border-zinc-200 px-4 py-2.5 text-right text-zinc-600">
                                {task.estimatedQuantity}
                              </td>
                              <td className="border-r border-zinc-200 px-4 py-2.5 text-zinc-600">
                                {task.unit ?? "—"}
                              </td>
                              <td className="border-r border-zinc-200 px-4 py-2.5 text-right text-zinc-600">
                                {formatCurrency(task.laborEstimate)}
                              </td>
                              <td className="border-r border-zinc-200 px-4 py-2.5 text-right text-zinc-600">
                                {formatCurrency(task.materialEstimate)}
                              </td>
                              <td className="border-r border-zinc-200 px-4 py-2.5 text-right text-zinc-600">
                                {formatCurrency(task.equipmentEstimate)}
                              </td>
                              <td className="border-r border-zinc-200 px-4 py-2.5 text-right text-zinc-600">
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
                                    className="flex cursor-pointer items-center justify-end gap-1 text-zinc-600 transition hover:text-zinc-900"
                                  >
                                    {expanded ? (
                                      <ChevronDown className="size-3.5" />
                                    ) : (
                                      <ChevronRight className="size-3.5" />
                                    )}
                                    {formatCurrency(task.otherCostEstimate)}
                                  </button>
                                ) : (
                                  formatCurrency(0)
                                )}
                              </td>
                              <td className="border-r border-zinc-200 px-4 py-2.5 text-right font-medium text-zinc-900">
                                {formatCurrency(task.totalEstimateCost)}
                              </td>
                              <td
                                className={`px-4 py-2.5 text-right text-zinc-600 ${manageMode ? "border-r border-zinc-200" : ""}`}
                              >
                                {formatWeight(task.weight)}
                              </td>
                              {manageMode && (
                                <td className="px-4 py-2.5">
                                  <div className="flex items-center justify-end gap-1">
                                    <button
                                      type="button"
                                      onClick={() => setTaskModal(task)}
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
                              <tr className="border-b border-zinc-100 bg-zinc-50/60">
                                <td
                                  className="px-4 py-2"
                                  colSpan={columnCount}
                                >
                                  <ul className="ml-8 flex flex-col gap-0.5 text-xs text-zinc-500">
                                    {task.otherCostItems.map((item) => (
                                      <li
                                        key={item.id}
                                        className="flex items-center gap-2"
                                      >
                                        <span>{item.costName}</span>
                                        <span className="text-zinc-300">
                                          —
                                        </span>
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
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-zinc-900 text-sm font-semibold text-white">
                  <td className="border-r border-zinc-700 px-4 py-3" colSpan={3}>
                    PROJECT TOTAL
                  </td>
                  <td className="border-r border-zinc-700 px-4 py-3 text-right">
                    {formatCurrency(summary.totalsByColumn.labor)}
                  </td>
                  <td className="border-r border-zinc-700 px-4 py-3 text-right">
                    {formatCurrency(summary.totalsByColumn.material)}
                  </td>
                  <td className="border-r border-zinc-700 px-4 py-3 text-right">
                    {formatCurrency(summary.totalsByColumn.equipment)}
                  </td>
                  <td className="border-r border-zinc-700 px-4 py-3 text-right">
                    {formatCurrency(summary.totalsByColumn.other)}
                  </td>
                  <td className="border-r border-zinc-700 px-4 py-3 text-right">
                    {formatCurrency(summary.totalEstimatedCost)}
                  </td>
                  <td className="px-4 py-3 text-right">100.00%</td>
                  {manageMode && <td className="px-4 py-3" />}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={categoryModal !== null}
        onClose={() => setCategoryModal(null)}
        title="Edit Category"
      >
        <CategoryForm
          projectId={projectId}
          category={categoryModal ?? undefined}
          onSuccess={() => setCategoryModal(null)}
        />
      </Modal>

      <Modal
        open={taskModal !== null}
        onClose={() => setTaskModal(null)}
        title="Edit Task Item"
      >
        <TaskForm
          projectId={projectId}
          categories={categoryOptions}
          task={taskModal ?? undefined}
          onSuccess={() => setTaskModal(null)}
        />
      </Modal>
    </div>
  );
}
