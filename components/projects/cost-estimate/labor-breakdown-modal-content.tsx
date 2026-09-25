"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { updateProjectDefaultLaborCostPercent } from "@/lib/projects/actions";
import {
  applyLaborRateProjectWide,
  updateCategoryLaborEstimate,
  updateTaskLaborEstimate,
} from "@/lib/cost-estimate/actions";
import type { CostCategory, CostTask } from "@/lib/cost-estimate/data";

function formatCurrency(amount: number | null | undefined) {
  return `₱${(amount ?? 0).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

function formatPercent(percent: number) {
  return percent.toLocaleString("en-PH", { maximumFractionDigits: 2 });
}

function parsePercent(value: string): number {
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : 0;
}

// The base every task's own Labor Percentage is a share of — the
// project's own overall Material + Equipment + Other cost (every
// category's own direct line plus every task's), not just that one
// task's own — the same rule-of-thumb 0036_project_default_labor_
// cost_percent.sql originally documented, now live/per-task instead of
// just a one-time creation-time suggestion, and shared project-wide per
// an explicit request rather than scoped to each task's own subtotal.
function projectLaborBase(categories: CostCategory[]) {
  return categories.reduce((sum, category) => {
    const tasksSum = category.tasks.reduce(
      (s, t) => s + t.materialEstimate + t.equipmentEstimate + t.otherCostEstimate,
      0
    );
    return sum + category.categoryMaterialEstimate + tasksSum;
  }, 0);
}

function taskLaborPercent(task: CostTask, projectBase: number) {
  return projectBase > 0 ? (task.laborEstimate / projectBase) * 100 : 0;
}

function categoryLaborPercent(category: CostCategory, projectBase: number) {
  return projectBase > 0 ? (category.categoryLaborEstimate / projectBase) * 100 : 0;
}

/**
 * Same purpose as MaterialBreakdownModalContent, for the "Labor" column
 * header instead — a project-wide view of every task's labor cost,
 * grouped by category then task, using the same table chrome (borders,
 * indentation, section-header rows) AND the same Cancel/Save Changes
 * footer/draft-then-save flow as that modal, rather than committing each
 * cell on blur.
 *
 * Unlike Material Breakdown, there's no separate quantity/unit-cost
 * breakdown to type — a row's own Labor Percentage cell (a share of the
 * project's own overall Material + Equipment + Other cost, see
 * projectLaborBase above — deliberately project-wide, not scoped to
 * that one row's own subtotal, per an explicit request) is the only
 * editable input, and Amount is always just what that percentage
 * computes to (live, as you type, same as Material Breakdown's own
 * Amount cells). A category row gets that same editable cell ONLY while
 * it has no tasks yet (a standalone lump-sum item, e.g. "MOBILIZATION")
 * — same asymmetric rule Material Breakdown already established for its
 * own direct line one level down: once a category has tasks, its own
 * cell goes back to a read-only rollup of theirs instead.
 *
 * The Labor Rate % field above the table is folded into this SAME
 * draft/save flow, not its own immediate action — typing into it only
 * updates local state (rateDirty) until Save Changes actually runs it
 * (see handleSave below), same as every other cell here. It used to
 * commit on blur by itself, which — since a project usually gets its
 * rate set before ever touching an individual row — made Save Changes
 * read as pointless: the one number anyone actually types was already
 * gone the moment they tabbed away, before they'd even reached the
 * button. When it IS applied, it still bulk-applies to EVERY row (every
 * task, and every task-less category), resetting each one's labor cost
 * to rate% of the project total — that reset runs first, so any
 * individual row also edited in the same save still wins afterward
 * (see handleSave's own ordering).
 *
 * Every category and every task always renders here, same as Material
 * Breakdown — not just the ones with a labor cost already on them.
 *
 * Deliberately unrelated to the Gantt Chart's own "Assigned" column
 * (task_worker_assignments, real named workers for on-site
 * accountability) — this is the cost-estimation planning side, a lump
 * labor cost per task, not who specifically is doing the work.
 */
export function LaborBreakdownModalContent({
  projectId,
  categories,
  defaultLaborCostPercent,
  onClose,
}: {
  projectId: number;
  categories: CostCategory[];
  /** Moved here from the Add/Edit Project forms (see
   * updateProjectDefaultLaborCostPercent's own doc comment) — the one
   * authoritative labor rate for the whole project (see handleSave's
   * own doc comment on why applying it is a reset, not a suggestion). */
  defaultLaborCostPercent: number | null;
  onClose: () => void;
}) {
  const router = useRouter();

  const [ratePercentInput, setRatePercentInput] = useState(
    defaultLaborCostPercent != null ? String(defaultLaborCostPercent) : ""
  );
  // Only true once the field's actually been typed into — Save Changes
  // stays disabled (see its own disabled= below) until something is
  // genuinely dirty, same as every other cell here; merely tabbing
  // through with no edit shouldn't enable it.
  const [rateDirty, setRateDirty] = useState(false);

  // Every row's own Labor Percentage is a share of this SAME
  // project-wide number (see projectLaborBase's own doc comment) — not
  // recomputed per row, so typing into one row's percentage doesn't
  // shift what 1% means for every other one.
  const projectBase = projectLaborBase(categories);

  // The table's own draft-then-save state — typing into a row's own
  // Labor Percentage cell only ever touches these (and marks that row
  // dirty); nothing is persisted until Save Changes, same as Material
  // Breakdown's own draftByTask/dirtyTaskIds. Categories get their own
  // separate pair since a category id and a task id share no namespace.
  const [taskPercentDraft, setTaskPercentDraft] = useState<
    Record<number, string>
  >({});
  const [dirtyTaskIds, setDirtyTaskIds] = useState<Set<number>>(new Set());
  const [categoryPercentDraft, setCategoryPercentDraft] = useState<
    Record<number, string>
  >({});
  const [dirtyCategoryIds, setDirtyCategoryIds] = useState<Set<number>>(
    new Set()
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateTaskDraft(taskId: number, value: string) {
    setTaskPercentDraft((prev) => ({ ...prev, [taskId]: value }));
    setDirtyTaskIds((prev) => (prev.has(taskId) ? prev : new Set(prev).add(taskId)));
  }

  function updateCategoryDraft(categoryId: number, value: string) {
    setCategoryPercentDraft((prev) => ({ ...prev, [categoryId]: value }));
    setDirtyCategoryIds((prev) =>
      prev.has(categoryId) ? prev : new Set(prev).add(categoryId)
    );
  }

  // Live, as-you-type — same "excel-like" feel Material Breakdown's own
  // Amount cells have, computed from whatever's currently in the draft
  // rather than waiting for the Save Changes round trip.
  function liveTaskAmount(task: CostTask) {
    const draft = taskPercentDraft[task.id];
    const percent =
      draft !== undefined ? parsePercent(draft) : taskLaborPercent(task, projectBase);
    return (percent / 100) * projectBase;
  }

  function liveCategoryAmount(category: CostCategory) {
    const draft = categoryPercentDraft[category.id];
    const percent =
      draft !== undefined
        ? parsePercent(draft)
        : categoryLaborPercent(category, projectBase);
    return (percent / 100) * projectBase;
  }

  // The rate is the one authoritative source for labor cost, per an
  // explicit decision — applying it doesn't just store the number on
  // the project, it recomputes every row's own labor cost to rate% of
  // the project's overall Material + Equipment + Other total,
  // overwriting whatever was there before on every row. There's no
  // "already has its own labor cost, leave it alone" carve-out; the
  // rate is a reset, not a fill-in-the-blanks default. Run FIRST, before
  // any individual row's own edit below, so a row also touched in this
  // same save still ends up reflecting what was typed into IT — not
  // silently clobbered back to the rate a moment later.
  //
  // The bulk-apply itself runs server-side (applyLaborRateProjectWide)
  // against a FRESH read of every row's own cost, rather than being
  // computed here from the `categories` prop — that prop can be one
  // revalidation behind the database (e.g. right after a Material
  // Breakdown save earlier in the same session), and computing the %
  // against a stale, too-low total silently under-applied the rate —
  // confirmed directly as the cause of a project's own rate appearing
  // to do nothing despite its Material cost already being real.
  async function handleSave() {
    setError(null);
    setPending(true);

    if (rateDirty) {
      const trimmed = ratePercentInput.trim();
      const parsed = trimmed === "" ? null : Number(trimmed);
      if (parsed != null && !Number.isFinite(parsed)) {
        setPending(false);
        setError("Enter a valid percentage.");
        return;
      }

      const rateResult = await updateProjectDefaultLaborCostPercent(
        projectId,
        parsed
      );
      if (rateResult.error) {
        setPending(false);
        setError(rateResult.error);
        return;
      }

      if (parsed != null) {
        const applyResult = await applyLaborRateProjectWide(projectId, parsed);
        if (applyResult.error) {
          setPending(false);
          setError(applyResult.error);
          return;
        }
      }
    }

    const results = await Promise.all([
      ...Array.from(dirtyTaskIds).map((taskId) => {
        const percent = parsePercent(taskPercentDraft[taskId] ?? "0");
        const newLaborEstimate = (percent / 100) * projectBase;
        return updateTaskLaborEstimate(taskId, projectId, newLaborEstimate);
      }),
      ...Array.from(dirtyCategoryIds).map((categoryId) => {
        const percent = parsePercent(categoryPercentDraft[categoryId] ?? "0");
        const newLaborEstimate = (percent / 100) * projectBase;
        return updateCategoryLaborEstimate(categoryId, projectId, newLaborEstimate);
      }),
    ]);
    setPending(false);
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      setError(failed.error);
      return;
    }
    router.refresh();
    onClose();
  }

  const grandTotal = categories.reduce(
    (sum, c) =>
      sum +
      (c.tasks.length > 0
        ? c.tasks.reduce((s, t) => s + liveTaskAmount(t), 0)
        : liveCategoryAmount(c)),
    0
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-500">
          Labor cost planned across every task in this project.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <label
            htmlFor="defaultLaborRatePercent"
            className="text-sm font-medium text-zinc-700"
          >
            Labor Rate %
          </label>
          <input
            id="defaultLaborRatePercent"
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={ratePercentInput}
            onChange={(e) => {
              setRatePercentInput(e.target.value);
              setRateDirty(true);
            }}
            placeholder="—"
            className="w-20 rounded-md border border-zinc-200 px-2 py-1 text-right text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-zinc-200">
        <table className="w-full table-fixed text-left text-sm">
          <colgroup>
            <col />
            <col style={{ width: 120 }} />
            <col style={{ width: 130 }} />
          </colgroup>
          <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
            <tr>
              <th className="border-r border-b border-zinc-300 px-3 py-2">
                Description
              </th>
              <th className="border-r border-b border-zinc-300 px-3 py-2 text-right">
                Labor Percentage
              </th>
              <th className="border-b border-zinc-300 px-3 py-2 text-right">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => {
              const hasTasks = category.tasks.length > 0;
              const categoryTotal = hasTasks
                ? category.tasks.reduce((sum, t) => sum + liveTaskAmount(t), 0)
                : liveCategoryAmount(category);
              return (
                <Fragment key={category.id}>
                  <tr className="border-y border-y-zinc-200 bg-zinc-100">
                    <td className="border-r border-r-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-600">
                      {category.name}
                    </td>
                    <td className="border-r border-r-zinc-300">
                      {hasTasks ? (
                        // Never hoverable — unlike the empty-category
                        // branch below, this cell is never itself
                        // editable (a category with subtasks always
                        // shows a rollup here; the actual editable
                        // Labor Percentage cells are its own subtasks'
                        // rows underneath), so it shouldn't look
                        // interactive on hover the way an editable cell
                        // does.
                        <div className="px-3 py-2 text-right text-sm text-zinc-400">
                          —
                        </div>
                      ) : (
                        <div className="group flex items-center justify-end gap-1 px-3 py-2 transition hover:bg-zinc-900 focus-within:bg-white">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={
                              categoryPercentDraft[category.id] ??
                              formatPercent(
                                categoryLaborPercent(category, projectBase)
                              )
                            }
                            onChange={(e) =>
                              updateCategoryDraft(category.id, e.target.value)
                            }
                            aria-label={`${category.name} labor percentage`}
                            className="w-full min-w-0 bg-transparent text-right text-sm text-zinc-700 outline-none transition group-hover:text-white group-focus-within:text-zinc-700"
                          />
                          <span className="shrink-0 text-xs text-zinc-400">
                            %
                          </span>
                        </div>
                      )}
                    </td>
                    {/* Never hoverable — Amount is always computed from
                        Labor Percentage, never itself directly typed
                        into (unlike Material Breakdown's own Amount
                        cell, which genuinely is editable there), so it
                        stays a plain view-only cell regardless of
                        whether this category has tasks. */}
                    <td className="px-3 py-2 text-right text-sm font-semibold whitespace-nowrap text-zinc-900">
                      {formatCurrency(categoryTotal)}
                    </td>
                  </tr>
                  {category.tasks.map((task, index) => (
                    <tr
                      key={task.id}
                      className={
                        index !== category.tasks.length - 1
                          ? "border-b border-b-zinc-200"
                          : ""
                      }
                    >
                      <td className="border-r border-r-zinc-300 py-1.5 pr-3 pl-6 text-xs font-semibold text-zinc-600">
                        {task.name}
                      </td>
                      <td className="border-r border-r-zinc-300">
                        <div className="group flex items-center justify-end gap-1 px-3 py-1.5 transition hover:bg-zinc-900 focus-within:bg-white">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={
                              taskPercentDraft[task.id] ??
                              formatPercent(taskLaborPercent(task, projectBase))
                            }
                            onChange={(e) =>
                              updateTaskDraft(task.id, e.target.value)
                            }
                            aria-label={`${task.name} labor percentage`}
                            className="w-full min-w-0 bg-transparent text-right text-sm text-zinc-700 outline-none transition group-hover:text-white group-focus-within:text-zinc-700"
                          />
                          <span className="shrink-0 text-xs text-zinc-400">
                            %
                          </span>
                        </div>
                      </td>
                      {/* Never hoverable — see the matching comment on
                          the category's own Amount cell above. */}
                      <td className="px-3 py-1.5 text-right text-sm font-semibold text-zinc-900">
                        {formatCurrency(liveTaskAmount(task))}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-zinc-200 pt-4">
        <div className="text-sm">
          <span className="font-medium text-zinc-500">
            Total Labor Cost (Project)
          </span>{" "}
          <span className="font-semibold text-zinc-900">
            {formatCurrency(grandTotal)}
          </span>
        </div>
        <div className="flex items-center gap-3">
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
            disabled={
              pending ||
              (!rateDirty &&
                dirtyTaskIds.size === 0 &&
                dirtyCategoryIds.size === 0)
            }
            className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
