"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Trash2 } from "lucide-react";
import {
  updateTaskMaterialAssignments,
  updateCategoryMaterialAssignments,
} from "@/lib/cost-estimate/actions";
import type { CostCategory, TaskMaterialAssignment } from "@/lib/cost-estimate/data";
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
  // (and updateCategoryMaterialAssignments) deletes and reinserts a whole
  // list on save, so there's no real id to track client-side between
  // loads.
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

/** Whose material lines these are — a task's, or a standalone category's
 * own (0058_category_material_lines.sql). */
type LineOwner = { kind: "task" | "category"; id: number };

function toDraftLine(m: TaskMaterialAssignment): DraftLine {
  return {
    key: nextKey(),
    materialName: m.materialName,
    specification: m.specification ?? "",
    quantity: String(m.plannedQuantity),
    unit: m.unit ?? "",
    unitCost: String(m.unitCost),
    amountOverride: m.amountOverride != null ? String(m.amountOverride) : "",
  };
}

function toDirectInput(direct: DraftDirect) {
  return {
    quantity: parseNumber(direct.quantity),
    unit: direct.unit || null,
    unitCost: parseNumber(direct.unitCost),
    amountOverride: direct.amountOverride ? parseNumber(direct.amountOverride) : null,
  };
}

function toLineInput(line: DraftLine) {
  return {
    materialName: line.materialName,
    specification: line.specification || null,
    plannedQuantity: parseNumber(line.quantity),
    unit: line.unit || null,
    unitCost: parseNumber(line.unitCost),
    amountOverride: line.amountOverride ? parseNumber(line.amountOverride) : null,
  };
}

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
 * lines running through every row (a real <td> per column, not one
 * colSpan cell, so the grid stays unbroken; only a category's name spans
 * the first two — the subtasks' tree column and their name column)
 * rather than just the header. A category with no
 * tasks yet carries its own typable Quantity/Unit/Unit Cost cells too
 * (see CostCategory.materialDirectQuantity's own doc comment) — same
 * pattern as a standalone task's own direct line, one level up — while
 * one with tasks spans its name across those three instead, its Amount
 * their subtotal (see below); task rows carry the same
 * Quantity/Unit/Unit Cost/Amount cells a material line does, editable
 * directly (for a lump-sum task with no breakdown, e.g. "Mobilization"
 * — see CostTask.materialDirectQuantity's own doc comment); each
 * material underneath is a plain row with the same cells, its name in
 * the same second column its task's sits in (the first is the tree),
 * under its task's own, behind a gray left accent below its task's dark
 * one (on a row tinted the Gantt chart's own today color) —
 * category and task
 * rows are group rows (categories a gray fill, tasks hanging off them on
 * a light tree line — see TreeLine) on top of that. Every Amount cell is
 * computed live from
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
 * its Material cell, next to the material name input, rather than in a
 * column of its own.
 *
 * Styled like the Expenses tab's ledger tables (expense-table-shared.tsx)
 * — every category and task is a group row, and every row always shows
 * at once (nothing folds away). A category with no tasks yet,
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
 * direct BOM line (and, standalone, its own material list — Add Material
 * on its row too), never adds/removes/renames either.
 */
// The shared table look is breakdown-table-shared.tsx's; on top of it, a
// material line's own row: a gray left accent on its name cell, the row
// itself MATERIAL_ROW_BG.
const ITEM_ROW =
  "group border-y border-zinc-200 transition-colors hover:bg-[rgba(252,211,77,0.15)]";
// The Gantt chart's own today color (its todayColor prop, 0.15) at about
// half strength — the full color is its hover (ITEM_ROW).
const MATERIAL_ROW_BG = "bg-[rgba(252,211,77,0.08)]";
// Hidden until its own row is hovered (or it's reached by keyboard).
const HOVER_ONLY = "opacity-0 group-hover:opacity-100 focus-visible:opacity-100";
const CELL_INPUT =
  "h-9 w-full bg-transparent px-4 text-right text-xs font-medium text-zinc-700 outline-none transition placeholder:text-zinc-300 hover:bg-zinc-900 hover:text-white focus:bg-transparent focus:text-zinc-700";
const GROUP_BUTTON =
  "inline-flex shrink-0 cursor-pointer items-center rounded-sm border border-zinc-200 bg-white h-6 px-2.5 text-xs font-medium text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900";

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
  /** Opens the shared "Import with AI" modal — owned by
   * project-detail-view.tsx, forwarded down through CostEstimateView.
   * Also reachable from the Gantt Chart's own toolbar (see gantt-chart-
   * view.tsx's own onImportBom) — this is the actual landing spot either
   * way, see CostEstimateView's own doc comment on the Material column. */
  onImportBom: () => void;
  /** Scrolls to and briefly flashes this task's own row once the modal
   * opens — set when arriving here via the Edit Task form's own "See
   * All" button under Assigned Resources (see SubtaskForm's own
   * onViewMaterials prop), null for the plain "Material" column header
   * trigger. Nothing folds away (see this component's own doc comment),
   * so the row is always there to scroll to. */
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
          initial[task.id] = task.materialAssignments.map(toDraftLine);
        }
      }
      return initial;
    }
  );
  // A standalone category's own itemized lines — draftByTask's own shape,
  // one level up (0058_category_material_lines.sql).
  const [draftByCategory, setDraftByCategory] = useState<Record<number, DraftLine[]>>(
    () => {
      const initial: Record<number, DraftLine[]> = {};
      for (const category of categories) {
        initial[category.id] = category.materialAssignments.map(toDraftLine);
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
  // comment). Saved with its own lines (draftByCategory) through
  // updateCategoryMaterialAssignments.
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

  function editLines(owner: LineOwner, edit: (lines: DraftLine[]) => DraftLine[]) {
    const setDraft = owner.kind === "task" ? setDraftByTask : setDraftByCategory;
    setDraft((prev) => ({ ...prev, [owner.id]: edit(prev[owner.id] ?? []) }));
    if (owner.kind === "task") markDirty(owner.id);
    else markCategoryDirty(owner.id);
  }

  function updateLine(owner: LineOwner, key: string, patch: Partial<DraftLine>) {
    editLines(owner, (lines) =>
      lines.map((line) =>
        line.key === key
          ? {
              ...line,
              ...patch,
              ...(clearsOverride(patch) ? { amountOverride: "" } : {}),
            }
          : line
      )
    );
  }

  function updateLineAmount(owner: LineOwner, line: DraftLine, typedAmount: string) {
    updateLine(owner, line.key, { amountOverride: typedAmount });
  }

  function removeLine(owner: LineOwner, key: string) {
    editLines(owner, (lines) => lines.filter((line) => line.key !== key));
  }

  function addLine(owner: LineOwner) {
    editLines(owner, (lines) => [
      ...lines,
      {
        key: nextKey(),
        materialName: "",
        specification: "",
        quantity: "",
        unit: "",
        unitCost: "",
        amountOverride: "",
      },
    ]);
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
      (draftByCategory[category.id] ?? []).reduce((sum, line) => sum + lineAmount(line), 0) +
      category.tasks.reduce((sum, t) => sum + taskAmount(t.id), 0)
    );
  }

  async function handleSave() {
    setError(null);
    setPending(true);
    const [taskResults, categoryResults] = await Promise.all([
      Promise.all(
        Array.from(dirtyTaskIds).map((taskId) => {
          return updateTaskMaterialAssignments(
            taskId,
            projectId,
            toDirectInput(directByTask[taskId] ?? EMPTY_DIRECT),
            (draftByTask[taskId] ?? []).map(toLineInput)
          );
        })
      ),
      Promise.all(
        Array.from(dirtyCategoryIds).map((categoryId) => {
          return updateCategoryMaterialAssignments(
            categoryId,
            projectId,
            toDirectInput(directByCategory[categoryId] ?? EMPTY_DIRECT),
            (draftByCategory[categoryId] ?? []).map(toLineInput)
          );
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

  // One material line's own row — a task's (tree: whether its task's tree
  // line carries on past it) or a standalone category's own.
  function renderMaterialRow(
    owner: LineOwner,
    line: DraftLine,
    { tree, flashing }: { tree: boolean; flashing: boolean }
  ) {
    return (
      <tr
        key={line.key}
        className={`${ITEM_ROW} duration-1000 ${
          flashing ? "bg-amber-100" : MATERIAL_ROW_BG
        }`}
      >
        <td className={TREE_CELL}>{tree && <TreeLine />}</td>
        <td className={`${DIVIDER} border-l-3 border-l-zinc-300 pr-2 pl-4`}>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={line.materialName}
              onChange={(e) =>
                updateLine(owner, line.key, {
                  materialName: e.target.value,
                })
              }
              placeholder="Material"
              className="h-9 min-w-0 flex-1 bg-transparent text-xs font-medium text-zinc-700 outline-none placeholder:font-normal placeholder:text-zinc-300"
            />
            <button
              type="button"
              onClick={() => removeLine(owner, line.key)}
              aria-label="Remove material"
              className={`shrink-0 cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-red-50 hover:text-red-600 ${HOVER_ONLY}`}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </td>
        <td className={DIVIDER}>
          <input
            type="number"
            min={0}
            value={line.quantity}
            onChange={(e) =>
              updateLine(owner, line.key, {
                quantity: e.target.value,
              })
            }
            className={CELL_INPUT}
          />
        </td>
        <td className={DIVIDER}>
          <input
            type="text"
            value={line.unit}
            onChange={(e) =>
              updateLine(owner, line.key, {
                unit: e.target.value,
              })
            }
            placeholder="—"
            className={CELL_INPUT}
          />
        </td>
        <td className={DIVIDER}>
          <input
            type="number"
            min={0}
            value={line.unitCost}
            onChange={(e) =>
              updateLine(owner, line.key, {
                unitCost: e.target.value,
              })
            }
            className={CELL_INPUT}
          />
        </td>
        <td>
          <AmountCell
            focusKey={`material-${line.key}`}
            computedAmount={lineAmount(line)}
            overrideValue={line.amountOverride}
            hasBreakdown={Boolean(line.quantity || line.unitCost)}
            onChangeOverride={(value) =>
              updateLineAmount(owner, line, value)
            }
            focusedAmountKey={focusedAmountKey}
            setFocusedAmountKey={setFocusedAmountKey}
            className={CELL_INPUT}
          />
        </td>
      </tr>
    );
  }

  const grandTotal = categories.reduce(
    (sum, c) => sum + categoryAmount(c),
    0
  );

  return (
    <div className="flex min-h-full flex-col gap-5">
      <div className="overflow-hidden rounded-md border border-zinc-200 bg-white">
        <table className="w-full table-fixed text-left text-xs">
          {/* The first column is the subtasks' tree (TreeLine): a
              subtask's name and its materials' start right after it, the
              header and category names spanning both. */}
          <colgroup>
            <col className="w-9" />
            <col />
            <col className="w-28" />
            <col className="w-24" />
            <col className="w-28" />
            <col className="w-32" />
          </colgroup>
          <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
            <tr>
              <th colSpan={2} className="border-r border-b border-zinc-200 px-4 py-2.5">
                Task
              </th>
              <th className="border-r border-b border-zinc-200 px-4 py-2.5 text-right">
                Quantity
              </th>
              <th className="border-r border-b border-zinc-200 px-4 py-2.5 text-right">
                Unit
              </th>
              <th className="border-r border-b border-zinc-200 px-4 py-2.5 text-right">
                Unit Cost
              </th>
              <th className="border-b border-zinc-200 px-4 py-2.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => {
              // Every task shows here regardless of whether it has its own
              // material lines (or, at this level, whether the category
              // has any tasks at all yet) — never a hidden row.
              const tasks = category.tasks;
              const categoryDirect = directByCategory[category.id] ?? EMPTY_DIRECT;
              return (
                <Fragment key={category.id}>
                  <tr className={MAIN_TASK_ROW}>
                    {/* With subtasks, its name spans Quantity/Unit/Unit
                        Cost too — its Amount is just their subtotal. */}
                    <td
                      colSpan={tasks.length > 0 ? 5 : 2}
                      className={`${DIVIDER} px-4`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <GroupLabel label={category.name} />
                        {tasks.length === 0 && (
                          <button
                            type="button"
                            onClick={() => addLine({ kind: "category", id: category.id })}
                            className={`${GROUP_BUTTON} ${HOVER_ONLY}`}
                          >
                            Add Material
                          </button>
                        )}
                      </div>
                    </td>
                    {tasks.length === 0 && (
                      <>
                        <td className={DIVIDER}>
                          <input
                            type="number"
                            min={0}
                            value={categoryDirect.quantity}
                            onChange={(e) =>
                              updateCategoryDirect(category.id, {
                                quantity: e.target.value,
                              })
                            }
                            placeholder="—"
                            className={CELL_INPUT}
                          />
                        </td>
                        <td className={DIVIDER}>
                          <input
                            type="text"
                            value={categoryDirect.unit}
                            onChange={(e) =>
                              updateCategoryDirect(category.id, {
                                unit: e.target.value,
                              })
                            }
                            placeholder="—"
                            className={CELL_INPUT}
                          />
                        </td>
                        <td className={DIVIDER}>
                          <input
                            type="number"
                            min={0}
                            value={categoryDirect.unitCost}
                            onChange={(e) =>
                              updateCategoryDirect(category.id, {
                                unitCost: e.target.value,
                              })
                            }
                            placeholder="—"
                            className={CELL_INPUT}
                          />
                        </td>
                      </>
                    )}
                    <td>
                      {tasks.length > 0 ? (
                        // A category with tasks shows their rolled-up
                        // total — a useful section subtotal, read-only
                        // (typing here could only ever mean "my own direct
                        // line on top of the tasks' total," then display
                        // as something else entirely), so it doesn't look
                        // interactive on hover either.
                        <div className="px-4 py-2.5 text-right text-xs font-medium whitespace-nowrap text-zinc-700">
                          {formatCurrency(categoryAmount(category))}
                        </div>
                      ) : (
                        <AmountCell
                          focusKey={`category-${category.id}`}
                          computedAmount={categoryDirectAmount(category.id)}
                          overrideValue={categoryDirect.amountOverride}
                          hasBreakdown={Boolean(
                            categoryDirect.quantity || categoryDirect.unitCost
                          )}
                          onChangeOverride={(value) =>
                            updateCategoryAmount(category.id, value)
                          }
                          focusedAmountKey={focusedAmountKey}
                          setFocusedAmountKey={setFocusedAmountKey}
                          className={CELL_INPUT}
                        />
                      )}
                    </td>
                  </tr>
                  {(draftByCategory[category.id] ?? []).map((line) =>
                    renderMaterialRow({ kind: "category", id: category.id }, line, {
                      tree: false,
                      flashing: false,
                    })
                  )}
                  {tasks.map((task, taskIndex) => {
                    const lines = draftByTask[task.id] ?? [];
                    const direct = directByTask[task.id] ?? EMPTY_DIRECT;
                    const flashing = flashTaskId === task.id;
                    const lastTask = taskIndex === tasks.length - 1;
                    return (
                      <Fragment key={task.id}>
                        <tr
                          ref={(el) => {
                            if (el) taskRowRefs.current.set(task.id, el);
                            else taskRowRefs.current.delete(task.id);
                          }}
                          className={`${GROUP_ROW} duration-1000 ${
                            flashing ? "bg-amber-100" : "bg-white"
                          }`}
                        >
                          <td className={TREE_CELL}>
                            <TreeLine branch end={lastTask} />
                          </td>
                          <td className={SUBTASK_NAME_CELL}>
                            <div className="flex items-center justify-between gap-2">
                              <GroupLabel label={task.name} />
                              <button
                                type="button"
                                onClick={() => addLine({ kind: "task", id: task.id })}
                                className={`${GROUP_BUTTON} ${HOVER_ONLY}`}
                              >
                                Add Material
                              </button>
                            </div>
                          </td>
                          <td className={DIVIDER}>
                            <input
                              type="number"
                              min={0}
                              value={direct.quantity}
                              onChange={(e) =>
                                updateDirect(task.id, { quantity: e.target.value })
                              }
                              placeholder="—"
                              className={CELL_INPUT}
                            />
                          </td>
                          <td className={DIVIDER}>
                            <input
                              type="text"
                              value={direct.unit}
                              onChange={(e) =>
                                updateDirect(task.id, { unit: e.target.value })
                              }
                              placeholder="—"
                              className={CELL_INPUT}
                            />
                          </td>
                          <td className={DIVIDER}>
                            <input
                              type="number"
                              min={0}
                              value={direct.unitCost}
                              onChange={(e) =>
                                updateDirect(task.id, { unitCost: e.target.value })
                              }
                              placeholder="—"
                              className={CELL_INPUT}
                            />
                          </td>
                          <td>
                            <AmountCell
                              focusKey={`task-${task.id}`}
                              computedAmount={directAmount(task.id)}
                              overrideValue={direct.amountOverride}
                              hasBreakdown={Boolean(direct.quantity || direct.unitCost)}
                              onChangeOverride={(value) => updateTaskAmount(task.id, value)}
                              focusedAmountKey={focusedAmountKey}
                              setFocusedAmountKey={setFocusedAmountKey}
                              className={CELL_INPUT}
                            />
                          </td>
                        </tr>
                        {lines.map((line) =>
                          renderMaterialRow({ kind: "task", id: task.id }, line, {
                            tree: !lastTask,
                            flashing,
                          })
                        )}
                      </Fragment>
                    );
                  })}
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
              className="flex cursor-pointer items-center gap-1.5 rounded border border-zinc-900 bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800"
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
    </div>
  );
}
