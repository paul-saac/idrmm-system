"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Trash2 } from "lucide-react";
import {
  updateTaskMaterialAssignments,
  updateCategoryMaterialDirect,
} from "@/lib/cost-estimate/actions";
import type { CostCategory } from "@/lib/cost-estimate/data";

function formatCurrency(amount: number | null | undefined) {
  return `₱${(amount ?? 0).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

// Comma-grouped, no currency symbol — for an Amount input's own display
// value while it's not focused (e.g. "20,000"), distinct from
// formatCurrency's "₱20,000" used for read-only rollup cells.
function formatAmountInput(amount: number) {
  return amount.toLocaleString("en-PH", { maximumFractionDigits: 2 });
}

// Tolerant of thousands separators and stray whitespace so a pasted or
// typed "20,000" / "20,000.50" parses the same as "20000" / "20000.5" —
// native number inputs reject commas outright, so every Amount field
// uses type="text" and relies on this instead.
function parseNumber(value: string): number {
  const n = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

let keySeq = 0;
function nextKey() {
  keySeq += 1;
  return `line-${keySeq}`;
}

type DraftLine = {
  // Local-only React key, never persisted — updateTaskMaterialAssignments
  // deletes and reinserts a task's whole list on save, so there's no
  // real id to track client-side between loads.
  key: string;
  materialName: string;
  specification: string;
  quantity: string;
  unit: string;
  unitCost: string;
  // "" means no override — Amount is quantity * unitCost as normal.
  // Set directly by typing into Amount itself (see updateLineAmount);
  // cleared the moment quantity or unitCost is edited directly, so
  // touching the breakdown always wins back over a stale override. See
  // 0043_amount_overrides.sql's own comment for why this needs its own
  // column rather than reusing quantity/unitCost.
  amountOverride: string;
};

/** A task's own direct BOM line (no material breakdown underneath it —
 * see CostTask.materialDirectQuantity's own doc comment for why this is
 * a separate concept from estimatedQuantity/unit). */
type DraftDirect = {
  quantity: string;
  unit: string;
  unitCost: string;
  amountOverride: string;
};

const EMPTY_DIRECT: DraftDirect = {
  quantity: "",
  unit: "",
  unitCost: "",
  amountOverride: "",
};

/**
 * Opened from the Cost Estimate Breakdown table's own "Material" column
 * header (see cost-estimate-view.tsx) — this is where a Bill of
 * Materials import (see import-bom-modal-content.tsx) is meant to land:
 * every task's planned materials, project-wide, laid out the same way a
 * real BOM document is (category -> task -> material lines), and — since
 * AI extraction is never fully trustworthy — directly editable right
 * here rather than read-only, so double-checking and correcting an
 * import (or just hand-maintaining the list without one) both happen in
 * the same place. Large-sized modal (see Modal's own `size` prop) since
 * this is really a small spreadsheet, not a one-glance summary.
 *
 * One continuous table for the whole project (category and task rows
 * are just differently-styled rows inside it, not separate nested boxes/
 * tables per task) — per an explicit request to read like an actual BOM
 * document instead of a stack of cards, with vertical column-divider
 * lines running through every row (category rows included — each is 5
 * real <td>s, not one colSpan cell, specifically so the grid stays
 * unbroken) rather than just the header. Category rows carry their own
 * typable Quantity/Unit/Unit Cost cells too (see CostCategory.
 * materialDirectQuantity's own doc comment) — same pattern as a
 * standalone task's own direct line, one level up, for a category with
 * no tasks yet (or a category-level lump sum); task rows carry the same
 * Quantity/Unit/Unit Cost/Amount cells a material line does, editable
 * directly (for a lump-sum task with no breakdown, e.g. "Mobilization"
 * — see CostTask.materialDirectQuantity's own doc comment); each
 * material underneath is a plain row with the same cells, indented one
 * step further than its own task (pl-6) so the hierarchy stays scannable
 * — a category's own solid gray background (bg-zinc-100) marks it as a
 * section header on top of that. Every Amount cell is computed live from
 * quantity * unit cost as you type, same as a real spreadsheet — but,
 * unlike Quantity/Unit/Unit Cost, Amount has no column of its own
 * anywhere in the schema (see amountToQuantityUnitCostPatch's own doc
 * comment), so it's also directly typable itself: with no quantity yet
 * it becomes 1 x that amount (the same "1 lot" convention a real BOM
 * already uses for a lump-sum line, e.g. "Mobilization" — for exactly
 * this reason, a category/task with no children is never hidden, per
 * below); with an existing quantity, unit cost is solved backwards
 * instead.
 *
 * A task's own Amount cell shows and edits ONLY that task's own direct
 * line, never a rollup of the materials listed underneath it — those
 * already show their own Amount right there, and summing them into the
 * task's row too would double the same cost on screen. A category's own
 * Amount cell works the other way: with no tasks under it (a real BOM's
 * own standalone items, e.g. "Mobilization") it's typable the same way a
 * task's own direct line is; but once it has tasks, it shows their
 * rolled-up total (categoryAmount) same as before — a genuinely useful
 * section subtotal, and read-only there rather than typable, since
 * editing a number that only ever means "my own line on top of the
 * tasks' total" — then displays as something else entirely — would be
 * more confusing than not editing it at all. Either way, the footer's
 * project-wide Total Material Cost always sums every category's
 * categoryAmount, so it's never missing a material line regardless of
 * what any individual row's own Amount cell happens to display. This is
 * what stands in for the per-category Sub-total row that was removed (no
 * dedicated row for it, nor a dedicated remove-material column) — a
 * material line's own remove button instead lives inline at the end of
 * its Description cell, next to the material name input, so every
 * column stays sized to
 * its own header rather than reserving a column that's blank on every
 * row but a material line's.
 *
 * No collapsing at all — every category, every task, and every material
 * line always renders, all at once (this is a Material Breakdown, a
 * flat data table meant to show everything, not a navigation tree the
 * user clicks open section by section). A category with no tasks yet,
 * or a task with no materials, still renders as its own row regardless
 * — a milestone, a zero-cost task, or a lump-sum task with nothing
 * broken out underneath (a real BOM's own "standalone" items, e.g.
 * "Mobilization") is still a real row and must stay visible; its own
 * "Add Material" button (inline in its row, not a separate row below
 * it — unlike the Gantt Chart's own Add Task/Add Phase buttons, this
 * one doesn't need an instant-appear optimistic row, since the blank
 * line it adds is already local, un-persisted draft state) is what
 * gives it its first material line.
 *
 * Saves per-task and per-category, only for the ones actually touched
 * (dirtyTaskIds/dirtyCategoryIds) — a project can have many of both, and
 * resaving every one of them on every edit would mean a lot of needless
 * round trips for rows nobody changed.
 *
 * Task/category creation itself still lives on the Gantt Chart only (see
 * CostEstimateView's own doc comment) — this only ever edits a task's
 * *material list* (and its own direct BOM line) or a category's own
 * direct BOM line, never adds/removes/renames either.
 */
// A standalone top-level component, not nested inside
// MaterialBreakdownModalContent — a component defined inside another
// gets a fresh identity every render, which would remount this input
// (and drop focus) on every keystroke.
function AmountCell({
  focusKey,
  computedAmount,
  overrideValue,
  hasBreakdown,
  onChangeOverride,
  focusedAmountKey,
  setFocusedAmountKey,
  className,
}: {
  focusKey: string;
  computedAmount: number;
  overrideValue: string;
  /** Whether quantity or unit cost already has something typed — Amount
   * shows their live product until the user types into Amount itself. */
  hasBreakdown: boolean;
  onChangeOverride: (value: string) => void;
  focusedAmountKey: string | null;
  setFocusedAmountKey: (key: string | null) => void;
  className: string;
}) {
  const isFocused = focusedAmountKey === focusKey;
  const hasValue = Boolean(overrideValue) || hasBreakdown;
  const rawValue =
    overrideValue || (hasBreakdown ? String(Math.round(computedAmount)) : "");
  const displayValue = isFocused
    ? rawValue
    : hasValue
      ? formatAmountInput(computedAmount)
      : "";
  return (
    <input
      type="text"
      inputMode="decimal"
      value={displayValue}
      onFocus={() => setFocusedAmountKey(focusKey)}
      onBlur={() => {
        if (focusedAmountKey === focusKey) setFocusedAmountKey(null);
      }}
      onChange={(e) => onChangeOverride(e.target.value)}
      placeholder="—"
      className={className}
    />
  );
}
export function MaterialBreakdownModalContent({
  projectId,
  categories,
  onClose,
  onImportBom,
  highlightTaskId,
}: {
  projectId: number;
  categories: CostCategory[];
  onClose: () => void;
  /** Opens the shared "Import Bill of Materials" modal — owned by
   * project-detail-view.tsx, forwarded down through CostEstimateView.
   * Moved here from the Gantt Chart toolbar since this is the actual
   * landing spot for an imported BOM (see CostEstimateView's own doc
   * comment on the Material column). */
  onImportBom: () => void;
  /** Scrolls to and briefly flashes this task's own row once the modal
   * opens — set when arriving here via the Edit Task form's own "See
   * All" button under Assigned Resources (see SubtaskForm's own
   * onViewMaterials prop), null for the plain "Material" column header
   * trigger. Every task always renders here regardless (see this
   * component's own doc comment on why nothing collapses), so there's
   * never a need to expand anything before scrolling to it. */
  highlightTaskId: number | null;
}) {
  const router = useRouter();
  // One ref per task row, keyed by task id — set via each row's own
  // ref callback below, read only by the scroll-to-highlight effect.
  const taskRowRefs = useRef(new Map<number, HTMLTableRowElement>());
  const [flashTaskId, setFlashTaskId] = useState<number | null>(null);

  // Runs once per modal open (Modal only mounts children once `open` is
  // true — see its own doc comment — so this component's own mount IS
  // "the modal just opened"), not on every highlightTaskId identity
  // change, since it's the same primitive number/null across renders
  // anyway. Scrolls the target row to the middle of the scroll
  // container and flashes it briefly so it's unmistakable in a table
  // that can run to hundreds of rows.
  useEffect(() => {
    if (highlightTaskId == null) return;
    const row = taskRowRefs.current.get(highlightTaskId);
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlashTaskId(highlightTaskId);
    const timer = window.setTimeout(() => setFlashTaskId(null), 2000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [draftByTask, setDraftByTask] = useState<Record<number, DraftLine[]>>(
    () => {
      const initial: Record<number, DraftLine[]> = {};
      for (const category of categories) {
        for (const task of category.tasks) {
          initial[task.id] = task.materialAssignments.map((m) => ({
            key: nextKey(),
            materialName: m.materialName,
            specification: m.specification ?? "",
            quantity: String(m.plannedQuantity),
            unit: m.unit ?? "",
            unitCost: String(m.unitCost),
            amountOverride:
              m.amountOverride != null ? String(m.amountOverride) : "",
          }));
        }
      }
      return initial;
    }
  );
  const [directByTask, setDirectByTask] = useState<
    Record<number, DraftDirect>
  >(() => {
    const initial: Record<number, DraftDirect> = {};
    for (const category of categories) {
      for (const task of category.tasks) {
        initial[task.id] = {
          quantity: task.materialDirectQuantity
            ? String(task.materialDirectQuantity)
            : "",
          unit: task.materialDirectUnit ?? "",
          unitCost: task.materialUnitCost ? String(task.materialUnitCost) : "",
          amountOverride:
            task.materialDirectAmountOverride != null
              ? String(task.materialDirectAmountOverride)
              : "",
        };
      }
    }
    return initial;
  });
  // A category's own direct BOM line — same idea as directByTask above,
  // one level up (see CostCategory.materialDirectQuantity's own doc
  // comment). Saved separately (updateCategoryMaterialDirect), since a
  // category isn't a task and has no material assignment rows of its
  // own to delete/reinsert alongside it.
  const [directByCategory, setDirectByCategory] = useState<
    Record<number, DraftDirect>
  >(() => {
    const initial: Record<number, DraftDirect> = {};
    for (const category of categories) {
      initial[category.id] = {
        quantity: category.materialDirectQuantity
          ? String(category.materialDirectQuantity)
          : "",
        unit: category.materialDirectUnit ?? "",
        unitCost: category.materialUnitCost
          ? String(category.materialUnitCost)
          : "",
        amountOverride:
          category.materialDirectAmountOverride != null
            ? String(category.materialDirectAmountOverride)
            : "",
      };
    }
    return initial;
  });
  const [dirtyTaskIds, setDirtyTaskIds] = useState<Set<number>>(new Set());
  const [dirtyCategoryIds, setDirtyCategoryIds] = useState<Set<number>>(
    new Set()
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which single Amount input (by a "category-5"/"task-12"/"material-
  // line-3" key) is currently focused, if any — that one shows its raw
  // editable value; every other Amount input shows the comma-grouped
  // display value instead, matching "type freely while editing, read
  // nicely once you're not."
  const [focusedAmountKey, setFocusedAmountKey] = useState<string | null>(
    null
  );

  function markDirty(taskId: number) {
    setDirtyTaskIds((prev) => (prev.has(taskId) ? prev : new Set(prev).add(taskId)));
  }

  function markCategoryDirty(categoryId: number) {
    setDirtyCategoryIds((prev) =>
      prev.has(categoryId) ? prev : new Set(prev).add(categoryId)
    );
  }

  // Editing quantity or unit cost directly always wins back over a
  // stale amount override — otherwise a leftover override would keep
  // silently ignoring a freshly-typed breakdown. Setting the override
  // itself goes through a patch that only ever touches amountOverride,
  // so this check leaves it alone in that case.
  function clearsOverride(patch: Partial<DraftDirect> | Partial<DraftLine>) {
    return "quantity" in patch || "unitCost" in patch;
  }

  function updateDirect(taskId: number, patch: Partial<DraftDirect>) {
    setDirectByTask((prev) => ({
      ...prev,
      [taskId]: {
        ...(prev[taskId] ?? EMPTY_DIRECT),
        ...patch,
        ...(clearsOverride(patch) ? { amountOverride: "" } : {}),
      },
    }));
    markDirty(taskId);
  }

  function updateTaskAmount(taskId: number, typedAmount: string) {
    updateDirect(taskId, { amountOverride: typedAmount });
  }

  function updateCategoryDirect(categoryId: number, patch: Partial<DraftDirect>) {
    setDirectByCategory((prev) => ({
      ...prev,
      [categoryId]: {
        ...(prev[categoryId] ?? EMPTY_DIRECT),
        ...patch,
        ...(clearsOverride(patch) ? { amountOverride: "" } : {}),
      },
    }));
    markCategoryDirty(categoryId);
  }

  function updateCategoryAmount(categoryId: number, typedAmount: string) {
    updateCategoryDirect(categoryId, { amountOverride: typedAmount });
  }

  function updateLine(taskId: number, key: string, patch: Partial<DraftLine>) {
    setDraftByTask((prev) => ({
      ...prev,
      [taskId]: prev[taskId].map((line) =>
        line.key === key
          ? {
              ...line,
              ...patch,
              ...(clearsOverride(patch) ? { amountOverride: "" } : {}),
            }
          : line
      ),
    }));
    markDirty(taskId);
  }

  function updateLineAmount(taskId: number, line: DraftLine, typedAmount: string) {
    updateLine(taskId, line.key, { amountOverride: typedAmount });
  }

  function removeLine(taskId: number, key: string) {
    setDraftByTask((prev) => ({
      ...prev,
      [taskId]: prev[taskId].filter((line) => line.key !== key),
    }));
    markDirty(taskId);
  }

  function addLine(taskId: number) {
    setDraftByTask((prev) => ({
      ...prev,
      [taskId]: [
        ...(prev[taskId] ?? []),
        {
          key: nextKey(),
          materialName: "",
          specification: "",
          quantity: "",
          unit: "",
          unitCost: "",
          amountOverride: "",
        },
      ],
    }));
    markDirty(taskId);
  }

  // Live, as-you-type totals — the whole point of an "excel-like" sheet
  // is that Amount/Sub-total/Total never wait for a save round trip to
  // reflect what's currently typed.
  function directAmount(taskId: number) {
    const direct = directByTask[taskId] ?? EMPTY_DIRECT;
    if (direct.amountOverride) return parseNumber(direct.amountOverride);
    return parseNumber(direct.quantity) * parseNumber(direct.unitCost);
  }
  function lineAmount(line: DraftLine) {
    if (line.amountOverride) return parseNumber(line.amountOverride);
    return parseNumber(line.quantity) * parseNumber(line.unitCost);
  }
  function taskAmount(taskId: number) {
    const lines = draftByTask[taskId] ?? [];
    return (
      directAmount(taskId) +
      lines.reduce((sum, line) => sum + lineAmount(line), 0)
    );
  }
  function categoryDirectAmount(categoryId: number) {
    const direct = directByCategory[categoryId] ?? EMPTY_DIRECT;
    if (direct.amountOverride) return parseNumber(direct.amountOverride);
    return parseNumber(direct.quantity) * parseNumber(direct.unitCost);
  }
  // A category's own Amount cell rolls up the same way a task's own
  // does (directAmount + its children's amounts) — this is what stands
  // in for the per-category Sub-total row that was removed, without
  // bringing back a dedicated row for it.
  function categoryAmount(category: CostCategory) {
    return (
      categoryDirectAmount(category.id) +
      category.tasks.reduce((sum, t) => sum + taskAmount(t.id), 0)
    );
  }

  async function handleSave() {
    setError(null);
    setPending(true);
    const [taskResults, categoryResults] = await Promise.all([
      Promise.all(
        Array.from(dirtyTaskIds).map((taskId) => {
          const direct = directByTask[taskId] ?? EMPTY_DIRECT;
          return updateTaskMaterialAssignments(
            taskId,
            projectId,
            {
              quantity: parseNumber(direct.quantity),
              unit: direct.unit || null,
              unitCost: parseNumber(direct.unitCost),
              amountOverride: direct.amountOverride
                ? parseNumber(direct.amountOverride)
                : null,
            },
            (draftByTask[taskId] ?? []).map((line) => ({
              materialName: line.materialName,
              specification: line.specification || null,
              plannedQuantity: parseNumber(line.quantity),
              unit: line.unit || null,
              unitCost: parseNumber(line.unitCost),
              amountOverride: line.amountOverride
                ? parseNumber(line.amountOverride)
                : null,
            }))
          );
        })
      ),
      Promise.all(
        Array.from(dirtyCategoryIds).map((categoryId) => {
          const direct = directByCategory[categoryId] ?? EMPTY_DIRECT;
          return updateCategoryMaterialDirect(categoryId, projectId, {
            quantity: parseNumber(direct.quantity),
            unit: direct.unit || null,
            unitCost: parseNumber(direct.unitCost),
            amountOverride: direct.amountOverride
              ? parseNumber(direct.amountOverride)
              : null,
          });
        })
      ),
    ]);
    setPending(false);
    const failed = [...taskResults, ...categoryResults].find((r) => r.error);
    if (failed?.error) {
      setError(failed.error);
      return;
    }
    // Without this, a still-mounted sibling view reading the same
    // `categories` prop (e.g. Labor Breakdown's own project-wide cost
    // base) kept seeing pre-save numbers until something else happened
    // to trigger a refresh — confirmed directly as the cause of the
    // Labor Rate % field appearing to compute against ₱0 right after a
    // Material Breakdown save in the same session.
    router.refresh();
    onClose();
  }

  const grandTotal = categories.reduce(
    (sum, c) => sum + categoryAmount(c),
    0
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="overflow-hidden rounded-md border border-zinc-200">
        <table className="w-full table-fixed text-left text-sm">
          <colgroup>
            <col />
            <col style={{ width: 90 }} />
            <col style={{ width: 70 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 100 }} />
          </colgroup>
          <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
            <tr>
              <th className="border-r border-b border-zinc-300 px-3 py-2">
                Description
              </th>
              <th className="border-r border-b border-zinc-300 px-3 py-2 text-right">
                Quantity
              </th>
              <th className="border-r border-b border-zinc-300 px-3 py-2 text-right">
                Unit
              </th>
              <th className="border-r border-b border-zinc-300 px-3 py-2 text-right">
                Unit Cost
              </th>
              <th className="border-b border-zinc-300 px-3 py-2 text-right">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => {
              // Every task shows here regardless of whether it has its own
              // material lines (or, at this level, whether the category
              // has any tasks at all yet) — same reasoning as a task's own
              // chevron below: nothing to expand just means no chevron,
              // never a hidden row.
              const tasks = category.tasks;
              return (
                <Fragment key={category.id}>
                  <tr className="border-y border-y-zinc-200 bg-zinc-100">
                    <td className="border-r border-r-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-600">
                      {category.name}
                    </td>
                    <td className="border-r border-r-zinc-300">
                      <input
                        type="number"
                        min={0}
                        value={
                          (directByCategory[category.id] ?? EMPTY_DIRECT)
                            .quantity
                        }
                        onChange={(e) =>
                          updateCategoryDirect(category.id, {
                            quantity: e.target.value,
                          })
                        }
                        placeholder="—"
                        className="w-full bg-transparent px-3 py-1.5 text-right text-sm font-medium text-zinc-700 outline-none transition placeholder:text-xs placeholder:text-zinc-300 hover:bg-zinc-900 hover:text-white focus:bg-white focus:text-zinc-700"
                      />
                    </td>
                    <td className="border-r border-r-zinc-300">
                      <input
                        type="text"
                        value={
                          (directByCategory[category.id] ?? EMPTY_DIRECT).unit
                        }
                        onChange={(e) =>
                          updateCategoryDirect(category.id, {
                            unit: e.target.value,
                          })
                        }
                        placeholder="—"
                        className="w-full bg-transparent px-3 py-1.5 text-right text-sm font-medium text-zinc-700 outline-none transition placeholder:text-xs placeholder:text-zinc-300 hover:bg-zinc-900 hover:text-white focus:bg-white focus:text-zinc-700"
                      />
                    </td>
                    <td className="border-r border-r-zinc-300">
                      <input
                        type="number"
                        min={0}
                        value={
                          (directByCategory[category.id] ?? EMPTY_DIRECT)
                            .unitCost
                        }
                        onChange={(e) =>
                          updateCategoryDirect(category.id, {
                            unitCost: e.target.value,
                          })
                        }
                        placeholder="—"
                        className="w-full bg-transparent px-3 py-1.5 text-right text-sm font-medium text-zinc-700 outline-none transition placeholder:text-xs placeholder:text-zinc-300 hover:bg-zinc-900 hover:text-white focus:bg-white focus:text-zinc-700"
                      />
                    </td>
                    <td>
                      {tasks.length > 0 ? (
                        // A category with tasks shows their rolled-up
                        // total, same as before — genuinely useful as a
                        // section subtotal, unlike a task's own Amount
                        // (which never rolls up its materials, since
                        // those already sit right underneath it). Read-
                        // only here rather than typable: editing this
                        // number could only ever mean "add my own direct
                        // line on top of the tasks' total," and typing a
                        // number that then displays as something else
                        // entirely (direct + rollup) would be far more
                        // confusing than just not editing it here. Not
                        // hoverable either, for the same reason — this
                        // cell is never itself editable once a category
                        // has tasks, so it shouldn't look interactive on
                        // hover the way an editable cell does.
                        <div className="px-3 py-1.5 text-right text-sm font-semibold whitespace-nowrap text-zinc-900">
                          {formatCurrency(categoryAmount(category))}
                        </div>
                      ) : (
                        <AmountCell
                          focusKey={`category-${category.id}`}
                          computedAmount={categoryDirectAmount(category.id)}
                          overrideValue={
                            (directByCategory[category.id] ?? EMPTY_DIRECT)
                              .amountOverride
                          }
                          hasBreakdown={Boolean(
                            (directByCategory[category.id] ?? EMPTY_DIRECT)
                              .quantity ||
                              (directByCategory[category.id] ?? EMPTY_DIRECT)
                                .unitCost
                          )}
                          onChangeOverride={(value) =>
                            updateCategoryAmount(category.id, value)
                          }
                          focusedAmountKey={focusedAmountKey}
                          setFocusedAmountKey={setFocusedAmountKey}
                          className="w-full bg-transparent px-3 py-1.5 text-right text-sm font-semibold text-zinc-900 outline-none transition placeholder:text-xs placeholder:text-zinc-300 hover:bg-zinc-900 hover:text-white focus:bg-white focus:text-zinc-900"
                        />
                      )}
                    </td>
                  </tr>
                  {tasks.map((task) => {
                    const lines = draftByTask[task.id] ?? [];
                    const direct = directByTask[task.id] ?? EMPTY_DIRECT;
                    // Every horizontal row divider in the table (task-to-
                    // task, task-to-material, material-to-material) uses
                    // this same color — zinc-300 is reserved for vertical
                    // column dividers, so this stays one shade lighter
                    // (zinc-200) than that, but still clearly visible
                    // against a plain white row (zinc-100 all but
                    // disappears there without an adjacent gray section
                    // to contrast against) — no row boundary reads as
                    // heavier than another. Side-specific (border-b-*),
                    // not the bare border-zinc-* utility — cells that also
                    // carry a border-r-zinc-300 (vertical divider) would
                    // otherwise have ONE of the two colors silently win
                    // for all four sides (Tailwind's bare border-color
                    // utility isn't scoped to whichever side has a width
                    // utility) — that's what caused the bottom edge to
                    // render in the wrong, inconsistent color before.
                    const taskBottomBorder = "border-b border-b-zinc-200";
                    return (
                      <Fragment key={task.id}>
                        <tr
                          ref={(el) => {
                            if (el) taskRowRefs.current.set(task.id, el);
                            else taskRowRefs.current.delete(task.id);
                          }}
                          className={
                            flashTaskId === task.id
                              ? "bg-amber-100 transition-colors duration-1000"
                              : "transition-colors duration-1000"
                          }
                        >
                          <td
                            className={`border-r border-r-zinc-300 py-1.5 pr-3 pl-6 ${taskBottomBorder}`}
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-600">
                                {task.name}
                              </span>
                              <button
                                type="button"
                                onClick={() => addLine(task.id)}
                                className="shrink-0 cursor-pointer rounded border border-zinc-300 px-2 py-0.5 text-[11px] font-medium text-zinc-500 transition hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-800"
                              >
                                Add Material
                              </button>
                            </div>
                          </td>
                          <td className={`border-r border-r-zinc-300 ${taskBottomBorder}`}>
                            <input
                              type="number"
                              min={0}
                              value={direct.quantity}
                              onChange={(e) =>
                                updateDirect(task.id, { quantity: e.target.value })
                              }
                              placeholder="—"
                              className="w-full bg-transparent px-3 py-1.5 text-right text-sm font-medium text-zinc-700 outline-none transition placeholder:text-xs placeholder:text-zinc-300 hover:bg-zinc-900 hover:text-white focus:bg-white focus:text-zinc-700"
                            />
                          </td>
                          <td className={`border-r border-r-zinc-300 ${taskBottomBorder}`}>
                            <input
                              type="text"
                              value={direct.unit}
                              onChange={(e) =>
                                updateDirect(task.id, { unit: e.target.value })
                              }
                              placeholder="—"
                              className="w-full bg-transparent px-3 py-1.5 text-right text-sm font-medium text-zinc-700 outline-none transition placeholder:text-xs placeholder:text-zinc-300 hover:bg-zinc-900 hover:text-white focus:bg-white focus:text-zinc-700"
                            />
                          </td>
                          <td className={`border-r border-r-zinc-300 ${taskBottomBorder}`}>
                            <input
                              type="number"
                              min={0}
                              value={direct.unitCost}
                              onChange={(e) =>
                                updateDirect(task.id, { unitCost: e.target.value })
                              }
                              placeholder="—"
                              className="w-full bg-transparent px-3 py-1.5 text-right text-sm font-medium text-zinc-700 outline-none transition placeholder:text-xs placeholder:text-zinc-300 hover:bg-zinc-900 hover:text-white focus:bg-white focus:text-zinc-700"
                            />
                          </td>
                          <td className={taskBottomBorder}>
                            <AmountCell
                              focusKey={`task-${task.id}`}
                              computedAmount={directAmount(task.id)}
                              overrideValue={direct.amountOverride}
                              hasBreakdown={Boolean(
                                direct.quantity || direct.unitCost
                              )}
                              onChangeOverride={(value) =>
                                updateTaskAmount(task.id, value)
                              }
                              focusedAmountKey={focusedAmountKey}
                              setFocusedAmountKey={setFocusedAmountKey}
                              className="w-full bg-transparent px-3 py-1.5 text-right text-sm font-semibold text-zinc-900 outline-none transition placeholder:text-xs placeholder:text-zinc-300 hover:bg-zinc-900 hover:text-white focus:bg-white focus:text-zinc-900"
                            />
                          </td>
                        </tr>
                        {lines.map((line) => (
                          <tr
                            key={line.key}
                            className={`border-b border-b-zinc-200 border-l-2 border-l-zinc-900 transition-colors duration-1000 ${
                              flashTaskId === task.id ? "bg-amber-100" : ""
                            }`}
                          >
                            <td className="border-r border-r-zinc-300 pr-3 pl-9">
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  value={line.materialName}
                                  onChange={(e) =>
                                    updateLine(task.id, line.key, {
                                      materialName: e.target.value,
                                    })
                                  }
                                  placeholder="Material"
                                  className="min-w-0 flex-1 bg-transparent py-1.5 text-xs font-semibold text-zinc-600 outline-none focus:bg-zinc-50"
                                />
                                <button
                                  type="button"
                                  onClick={() => removeLine(task.id, line.key)}
                                  aria-label="Remove material"
                                  className="mr-2 shrink-0 cursor-pointer rounded p-1 text-zinc-300 transition hover:bg-red-50 hover:text-red-600"
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              </div>
                            </td>
                            <td className="border-r border-r-zinc-300">
                              <input
                                type="number"
                                min={0}
                                value={line.quantity}
                                onChange={(e) =>
                                  updateLine(task.id, line.key, {
                                    quantity: e.target.value,
                                  })
                                }
                                className="w-full bg-transparent px-3 py-1.5 text-right text-sm text-zinc-700 outline-none transition hover:bg-zinc-900 hover:text-white focus:bg-zinc-50 focus:text-zinc-700"
                              />
                            </td>
                            <td className="border-r border-r-zinc-300">
                              <input
                                type="text"
                                value={line.unit}
                                onChange={(e) =>
                                  updateLine(task.id, line.key, {
                                    unit: e.target.value,
                                  })
                                }
                                placeholder="—"
                                className="w-full bg-transparent px-3 py-1.5 text-right text-sm text-zinc-700 outline-none transition placeholder:text-xs placeholder:text-zinc-300 hover:bg-zinc-900 hover:text-white focus:bg-zinc-50 focus:text-zinc-700"
                              />
                            </td>
                            <td className="border-r border-r-zinc-300">
                              <input
                                type="number"
                                min={0}
                                value={line.unitCost}
                                onChange={(e) =>
                                  updateLine(task.id, line.key, {
                                    unitCost: e.target.value,
                                  })
                                }
                                className="w-full bg-transparent px-3 py-1.5 text-right text-sm text-zinc-700 outline-none transition hover:bg-zinc-900 hover:text-white focus:bg-zinc-50 focus:text-zinc-700"
                              />
                            </td>
                            <td>
                              <AmountCell
                                focusKey={`material-${line.key}`}
                                computedAmount={lineAmount(line)}
                                overrideValue={line.amountOverride}
                                hasBreakdown={Boolean(
                                  line.quantity || line.unitCost
                                )}
                                onChangeOverride={(value) =>
                                  updateLineAmount(task.id, line, value)
                                }
                                focusedAmountKey={focusedAmountKey}
                                setFocusedAmountKey={setFocusedAmountKey}
                                className="w-full bg-transparent px-3 py-1 text-right text-sm text-zinc-700 outline-none transition placeholder:text-xs placeholder:text-zinc-300 hover:bg-zinc-900 hover:text-white focus:bg-zinc-50 focus:text-zinc-700"
                              />
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
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
            Total Material Cost (Project)
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
            onClick={onImportBom}
            className="flex cursor-pointer items-center gap-1.5 rounded border border-zinc-800 bg-zinc-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-950"
          >
            <Sparkles className="size-3.5" />
            Import
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={
              pending ||
              (dirtyTaskIds.size === 0 && dirtyCategoryIds.size === 0)
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
