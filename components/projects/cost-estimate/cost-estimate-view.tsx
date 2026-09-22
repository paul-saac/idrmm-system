"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { MaterialBreakdownModalContent } from "@/components/projects/cost-estimate/material-breakdown-modal-content";
import { LaborBreakdownModalContent } from "@/components/projects/cost-estimate/labor-breakdown-modal-content";
import type { CostEstimate } from "@/lib/cost-estimate/data";

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

const MIN_CATEGORIES_WIDTH = 200;
const DEFAULT_CATEGORIES_WIDTH = 280;

// Every column this table renders — Categories, Estimated Quantity,
// Unit, Labor, Material, Equipment, Other, Total Estimated Cost, Weight
// — used only to span the "Other" cost breakdown row across all of
// them. A plain constant rather than something computed: this table has
// no manage-mode/Action column anymore (see CostEstimateView's own doc
// comment on why), so the count never varies.
const COLUMN_COUNT = 9;

/**
 * A read-only view of the project's own cost estimate *structure* —
 * every add/edit/delete of a category or task itself lives on the Gantt
 * Chart instead (see gantt-chart-view.tsx), per an explicit decision
 * that task management should have exactly one place, not two that
 * could drift out of sync or leave someone unsure which screen to use.
 *
 * The Material column is the one deliberate exception: clicking its own
 * header (see MaterialBreakdownModalContent's own doc comment) opens a
 * project-wide, *editable* view of every task's planned material
 * list — the intended landing spot for a Bill of Materials import, and
 * for hand-editing that same list without one. That's editing a task's
 * material sub-list, not the task itself, so it doesn't reopen the
 * "only Gantt edits tasks" rule above. Labor's own header opens the
 * read-only equivalent (project-wide, but view-only — see
 * LaborBreakdownModalContent) since nothing has asked for that one to
 * be editable here yet.
 */
export function CostEstimateView({
  projectId,
  estimate,
}: {
  projectId: number;
  estimate: CostEstimate;
}) {
  // Project-wide, not per-task — see the two modal components' own doc
  // comments for why a column-header trigger replaced an earlier
  // per-task-row version of this.
  const [materialBreakdownOpen, setMaterialBreakdownOpen] = useState(false);
  const [laborBreakdownOpen, setLaborBreakdownOpen] = useState(false);
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<number>>(
    new Set()
  );
  // Every phase starts collapsed — this table is a quick-reference
  // summary now (all editing happens on the Gantt Chart below), so
  // landing on just the category rows/subtotals first, with the detail
  // an opt-in expand away, reads better than a long fully-open table on
  // every visit. Lazy initializer since this only ever needs to run
  // once, off however many categories exist at mount.
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState<
    Set<number>
  >(() => new Set(estimate.categories.map((c) => c.id)));
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

  return (
    // No border/rounded chrome of its own — this renders as a direct
    // extension of whatever dropdown/card it's embedded in (currently
    // the Cost Overview section in project-detail-view.tsx), not a
    // nested card of its own. bg-white is still its own, though — that
    // section's own background is a light gray fill, and this table
    // reads as white against it rather than picking up the same tint.
    <div className="border-t border-zinc-200 bg-white">
      {categories.length === 0 ? (
        <div className="mx-5 mb-5 flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white py-16 text-center">
          <p className="text-sm font-medium text-zinc-700">
            No cost estimate yet
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            Add a phase and task items, or import a Bill of Materials, from
            the Gantt Chart below to start building the cost breakdown
            structure.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-left text-sm">
              <thead className="bg-white text-xs font-medium text-zinc-500">
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
                  <th className="w-28 border-r border-zinc-200 text-right">
                    <button
                      type="button"
                      onClick={() => setLaborBreakdownOpen(true)}
                      title="View the project's full labor breakdown"
                      className="flex h-full w-full cursor-pointer items-center justify-end gap-1 px-4 py-2.5 text-right transition hover:bg-zinc-100 hover:text-zinc-900"
                    >
                      Labor
                      <ChevronRight className="size-3.5 shrink-0" />
                    </button>
                  </th>
                  <th className="w-28 border-r border-zinc-200 text-right">
                    <button
                      type="button"
                      onClick={() => setMaterialBreakdownOpen(true)}
                      title="View the project's full material breakdown"
                      className="flex h-full w-full cursor-pointer items-center justify-end gap-1 px-4 py-2.5 text-right transition hover:bg-zinc-100 hover:text-zinc-900"
                    >
                      Material
                      <ChevronRight className="size-3.5 shrink-0" />
                    </button>
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
                  <th className="w-24 px-4 py-2.5 text-right">Weight</th>
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
                      <tr className="border-y border-zinc-200 bg-white text-xs font-medium text-zinc-500">
                        <td
                          className="border-r border-zinc-200 px-4 py-2.5"
                          colSpan={8}
                        >
                          <button
                            type="button"
                            onClick={() => toggleCategory(category.id)}
                            className="flex cursor-pointer items-center gap-2 transition hover:text-zinc-900"
                          >
                            {isOpen ? (
                              <ChevronDown className="size-3.5 shrink-0 text-zinc-400" />
                            ) : (
                              <ChevronRight className="size-3.5 shrink-0 text-zinc-400" />
                            )}
                            {category.name}
                          </button>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {formatWeight(category.weight)}
                        </td>
                      </tr>

                      {isOpen &&
                        tasks.map((task) => {
                        const hasOtherCosts = task.otherCostItems.length > 0;
                        const expanded = expandedTaskIds.has(task.id);
                        return (
                          <Fragment key={task.id}>
                            <tr className="border-b border-zinc-200 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-50">
                              <td className="truncate border-r border-zinc-200 px-4 py-2.5 pl-8">
                                {task.name}
                              </td>
                              <td className="border-r border-zinc-200 px-4 py-2.5 text-right">
                                {task.estimatedQuantity}
                              </td>
                              <td className="border-r border-zinc-200 px-4 py-2.5">
                                {task.unit ?? "—"}
                              </td>
                              <td className="border-r border-zinc-200 px-4 py-2.5 text-right">
                                {formatCurrency(task.laborEstimate)}
                              </td>
                              <td className="border-r border-zinc-200 px-4 py-2.5 text-right">
                                {formatCurrency(task.materialEstimate)}
                              </td>
                              <td className="border-r border-zinc-200 px-4 py-2.5 text-right">
                                {formatCurrency(task.equipmentEstimate)}
                              </td>
                              <td className="border-r border-zinc-200 px-4 py-2.5 text-right">
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
                                    className="flex cursor-pointer items-center justify-end gap-1 transition hover:text-zinc-900"
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
                              <td className="border-r border-zinc-200 px-4 py-2.5 text-right">
                                {formatCurrency(task.totalEstimateCost)}
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                {formatWeight(task.weight)}
                              </td>
                            </tr>
                            {expanded && hasOtherCosts && (
                              <tr className="border-b border-zinc-200 bg-zinc-50/60">
                                <td
                                  className="px-4 py-2"
                                  colSpan={COLUMN_COUNT}
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
                <tr className="bg-zinc-100 text-sm font-semibold text-zinc-800">
                  <td className="border-r border-zinc-300 px-4 py-3" colSpan={3}>
                    PROJECT TOTAL
                  </td>
                  <td className="border-r border-zinc-300 px-4 py-3 text-right">
                    {formatCurrency(summary.totalsByColumn.labor)}
                  </td>
                  <td className="border-r border-zinc-300 px-4 py-3 text-right">
                    {formatCurrency(summary.totalsByColumn.material)}
                  </td>
                  <td className="border-r border-zinc-300 px-4 py-3 text-right">
                    {formatCurrency(summary.totalsByColumn.equipment)}
                  </td>
                  <td className="border-r border-zinc-300 px-4 py-3 text-right">
                    {formatCurrency(summary.totalsByColumn.other)}
                  </td>
                  <td className="border-r border-zinc-300 px-4 py-3 text-right">
                    {formatCurrency(summary.totalEstimatedCost)}
                  </td>
                  <td className="px-4 py-3 text-right">100.00%</td>
                </tr>
              </tfoot>
            </table>
        </div>
      )}

      <Modal
        open={materialBreakdownOpen}
        onClose={() => setMaterialBreakdownOpen(false)}
        title="Material Breakdown"
        size="large"
      >
        <MaterialBreakdownModalContent
          projectId={projectId}
          categories={categories}
          onClose={() => setMaterialBreakdownOpen(false)}
        />
      </Modal>

      <Modal
        open={laborBreakdownOpen}
        onClose={() => setLaborBreakdownOpen(false)}
        title="Labor Breakdown"
      >
        <LaborBreakdownModalContent categories={categories} />
      </Modal>
    </div>
  );
}
