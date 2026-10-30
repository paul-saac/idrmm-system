"use client";

import { ProjectWriteInput, ProjectWriteButton } from "@/components/projects/project-access-context";
import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Calculator } from "lucide-react";
import { updateProjectDefaultLaborCostPercent } from "@/lib/projects/actions";
import {
  applyLaborRateProjectWide,
  updateCategoryLaborEstimate,
  updateTaskLaborEstimate,
} from "@/lib/cost-estimate/actions";
import type { CostCategory, CostTask } from "@/lib/cost-estimate/data";
import { useEstimateSync } from "./estimate-sync-context";
import type { EstimateRowPatch } from "@/lib/cost-estimate/live-estimate";
import {
  DIVIDER,
  GROUP_ROW,
  GroupLabel,
  MAIN_TASK_ROW,
  STICKY_FOOTER,
  SUBTASK_NAME_CELL,
  TREE_CELL,
  TreeLine,
} from "@/components/projects/cost-estimate/breakdown-table-shared";

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
    return (
      sum +
      category.categoryMaterialEstimate +
      category.categoryEquipmentEstimate +
      category.categoryOtherEstimate +
      tasksSum
    );
  }, 0);
}

function taskLaborPercent(task: CostTask, projectBase: number) {
  return projectBase > 0 ? (task.laborEstimate / projectBase) * 100 : 0;
}

function categoryLaborPercent(category: CostCategory, projectBase: number) {
  return projectBase > 0 ? (category.categoryLaborEstimate / projectBase) * 100 : 0;
}

// Never hoverable — Amount is always computed from Labor Percentage,
// never itself typed into (unlike Material Breakdown's own Amount cell).
const AMOUNT_CELL =
  "px-4 py-2.5 text-right text-xs font-medium whitespace-nowrap text-zinc-700";

/** A row's own typable Labor Percentage, with a trailing "%" — the
 * Material Breakdown's cell inputs' own hover (dark) and focus (the row's
 * own fill) states. A standalone top-level component, so typing never
 * remounts it. */
function PercentCell({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div className="group/cell flex h-9 items-center justify-end gap-1 px-4 transition hover:not-focus-within:bg-zinc-900">
      <ProjectWriteInput
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="w-full min-w-0 bg-transparent text-right text-xs font-medium text-zinc-700 outline-none transition group-hover/cell:not-focus:text-white"
      />
      <span className="shrink-0 text-xs text-zinc-400">%</span>
    </div>
  );
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
export type LaborBreakdownHighlightTarget = {
  kind: "task" | "category";
  id: number;
} | null;

export function LaborBreakdownModalContent({
  projectId,
  categories,
  defaultLaborCostPercent,
  onClose,
  highlightTarget,
}: {
  projectId: number;
  categories: CostCategory[];
  /** Moved here from the Add/Edit Project forms (see
   * updateProjectDefaultLaborCostPercent's own doc comment) — the one
   * authoritative labor rate for the whole project (see handleSave's
   * own doc comment on why applying it is a reset, not a suggestion). */
  defaultLaborCostPercent: number | null;
  onClose: () => void;
  highlightTarget?: LaborBreakdownHighlightTarget;
}) {
  const router = useRouter();
  const estimateSync = useEstimateSync();
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const [flashingKey, setFlashingKey] = useState<string | null>(null);

  useEffect(() => {
    if (!highlightTarget) return;
    const key = `${highlightTarget.kind}-${highlightTarget.id}`;
    const el = rowRefs.current.get(key);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlashingKey(key);
    const timer = window.setTimeout(() => setFlashingKey(null), 2500);
    return () => window.clearTimeout(timer);
  }, [highlightTarget]);

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
    const parsed = ratePercentInput.trim() === "" ? null : Number(ratePercentInput.trim());
    if (rateDirty && parsed != null && !Number.isFinite(parsed)) {
      setError("Enter a valid percentage.");
      return;
    }
    setPending(true);
    const ratePatches: EstimateRowPatch[] = rateDirty && parsed != null ? categories.flatMap<EstimateRowPatch>(category => [
      ...(!category.tasks.length ? [{ kind: "category" as const, id: category.id, values: { categoryLaborEstimate: parsed / 100 * projectBase } }] : []),
      ...category.tasks.map(task => ({ kind: "task" as const, id: task.id, values: { laborEstimate: parsed / 100 * projectBase } })),
    ]) : [];
    const rateToken = ratePatches.length ? estimateSync?.begin(ratePatches) : undefined;
    let rateCompleted = false;
    const edits = [
      ...Array.from(dirtyTaskIds, id => ({ kind: "task" as const, id, amount: parsePercent(taskPercentDraft[id] ?? "0") / 100 * projectBase })),
      ...Array.from(dirtyCategoryIds, id => ({ kind: "category" as const, id, amount: parsePercent(categoryPercentDraft[id] ?? "0") / 100 * projectBase })),
    ].map(edit => ({ ...edit, token: estimateSync?.begin([edit.kind === "task"
      ? { kind: "task", id: edit.id, values: { laborEstimate: edit.amount } }
      : { kind: "category", id: edit.id, values: { categoryLaborEstimate: edit.amount } }]) }));
    try {
      if (rateDirty) {
        const rateResult = await updateProjectDefaultLaborCostPercent(projectId, parsed);
        if (rateResult.error) throw new Error(rateResult.error);
        if (parsed != null) {
          const result = await applyLaborRateProjectWide(projectId, parsed);
          if (result.error) throw new Error(result.error);
        }
      }
      if (rateToken !== undefined) estimateSync?.complete(rateToken);
      rateCompleted = true;
      const results = await Promise.all(edits.map(async edit => {
        try {
          const result = edit.kind === "task" ? await updateTaskLaborEstimate(edit.id, projectId, edit.amount)
            : await updateCategoryLaborEstimate(edit.id, projectId, edit.amount);
          if (edit.token !== undefined) {
            if (result.error) estimateSync?.rollback(edit.token); else estimateSync?.complete(edit.token);
          }
          return result;
        } catch {
          if (edit.token !== undefined) estimateSync?.rollback(edit.token);
          return { error: "Could not save labor costs. Please try again." };
        }
      }));
      const failed = results.find(result => result.error);
      if (failed?.error) { setError(failed.error); return; }
      onClose();
    } catch (error) {
      if (!rateCompleted && rateToken !== undefined) estimateSync?.rollback(rateToken);
      for (const edit of edits) if (edit.token !== undefined) estimateSync?.rollback(edit.token);
      setError(error instanceof Error ? error.message : "Could not save labor costs. Please try again.");
    } finally {
      setPending(false);
      router.refresh();
    }
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
    <div className="flex min-h-full flex-col gap-5">
      <div className="flex flex-wrap items-center gap-4 rounded border border-sky-200 bg-sky-50 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3 text-sm text-slate-500">
          <Calculator aria-hidden className="size-4 shrink-0 text-slate-500" />
          <span>Task rate × estimate = labor amount</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <label
            htmlFor="defaultLaborRatePercent"
            className="text-sm font-semibold text-slate-700"
          >
            Labor Rate
          </label>
          <div className="relative">
            <ProjectWriteInput
              id="defaultLaborRatePercent"
              type="number"
              min={0}
              max={100}
              step="0.01"
              autoComplete="off"
              value={ratePercentInput}
              onChange={(e) => {
                setRatePercentInput(e.target.value);
                setRateDirty(true);
              }}
              className="w-24 rounded border border-slate-300 bg-white py-2 pr-7 pl-2 text-right text-sm text-slate-700 outline-none [appearance:textfield] focus:border-slate-400 focus:ring-2 focus:ring-slate-200 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span aria-hidden className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-sm text-slate-500">%</span>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-zinc-200 bg-white">
        <table className="w-full table-fixed text-left text-xs">
          <colgroup>
            <col className="w-9" />
            <col />
            <col className="w-36" />
            <col className="w-32" />
          </colgroup>
          <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
            <tr>
              <th colSpan={2} className="border-r border-b border-zinc-200 px-4 py-2.5">Task</th>
              <th className="border-r border-b border-zinc-200 px-4 py-2.5 text-right">
                Labor Percentage
              </th>
              <th className="border-b border-zinc-200 px-4 py-2.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => {
              const tasks = category.tasks;
              const hasTasks = tasks.length > 0;
              const categoryTotal = hasTasks
                ? tasks.reduce((sum, t) => sum + liveTaskAmount(t), 0)
                : liveCategoryAmount(category);
              return (
                <Fragment key={category.id}>
                  <tr
                    ref={(el) => {
                      if (el) rowRefs.current.set(`category-${category.id}`, el);
                      else rowRefs.current.delete(`category-${category.id}`);
                    }}
                    className={`${MAIN_TASK_ROW} duration-500 ${
                      flashingKey === `category-${category.id}`
                        ? "bg-amber-50 ring-1 ring-amber-300 ring-inset"
                        : ""
                    }`}
                  >
                    {/* With subtasks, its name spans Labor Percentage too —
                        its Amount is just their subtotal. */}
                    <td colSpan={hasTasks ? 3 : 2} className={`${DIVIDER} px-4`}>
                      <GroupLabel label={category.name} />
                    </td>
                    {!hasTasks && (
                      <td className={DIVIDER}>
                        <PercentCell
                          value={
                            categoryPercentDraft[category.id] ??
                            formatPercent(categoryLaborPercent(category, projectBase))
                          }
                          onChange={(value) => updateCategoryDraft(category.id, value)}
                          label={`${category.name} labor percentage`}
                        />
                      </td>
                    )}
                    <td className={AMOUNT_CELL}>{formatCurrency(categoryTotal)}</td>
                  </tr>
                  {tasks.map((task, taskIndex) => (
                    <tr
                      key={task.id}
                      ref={(el) => {
                        if (el) rowRefs.current.set(`task-${task.id}`, el);
                        else rowRefs.current.delete(`task-${task.id}`);
                      }}
                      className={`${GROUP_ROW} duration-500 ${
                        flashingKey === `task-${task.id}`
                          ? "bg-amber-50 ring-1 ring-amber-300 ring-inset"
                          : "bg-white"
                      }`}
                    >
                      <td className={TREE_CELL}>
                        <TreeLine branch end={taskIndex === tasks.length - 1} />
                      </td>
                      <td className={SUBTASK_NAME_CELL}>
                        <GroupLabel label={task.name} />
                      </td>
                      <td className={DIVIDER}>
                        <PercentCell
                          value={
                            taskPercentDraft[task.id] ??
                            formatPercent(taskLaborPercent(task, projectBase))
                          }
                          onChange={(value) => updateTaskDraft(task.id, value)}
                          label={`${task.name} labor percentage`}
                        />
                      </td>
                      <td className={AMOUNT_CELL}>{formatCurrency(liveTaskAmount(task))}</td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className={STICKY_FOOTER}>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="flex items-center justify-between gap-3">
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
            <ProjectWriteButton
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
            </ProjectWriteButton>
          </div>
        </div>
      </div>
    </div>
  );
}
