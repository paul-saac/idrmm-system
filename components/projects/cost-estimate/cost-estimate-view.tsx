"use client";

import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import {
  MaterialBreakdownModalContent,
  type MaterialBreakdownHighlightTarget,
} from "@/components/projects/cost-estimate/material-breakdown-modal-content";
import {
  LaborBreakdownModalContent,
  type LaborBreakdownHighlightTarget,
} from "@/components/projects/cost-estimate/labor-breakdown-modal-content";
import {
  OtherBreakdownModalContent,
  type OtherBreakdownHighlightTarget,
} from "@/components/projects/cost-estimate/other-breakdown-modal-content";
import {
  WeightBreakdownModal,
  type CostEstimateHighlightField,
  type CostNavigateDestination,
  type WeightBreakdownTarget,
} from "@/components/projects/cost-estimate/weight-breakdown-modal-content";
import type { CostEstimate } from "@/lib/cost-estimate/data";
import {
  updateCategoryEstimatedQuantity,
  updateTaskEstimatedQuantity,
} from "@/lib/cost-estimate/actions";

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

// An empty cell counts as 0; null flags anything that isn't a real,
// non-negative number.
function parseQuantity(value: string): number | null {
  if (!value) return 0;
  const quantity = Number(value.replace(/,/g, ""));
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : null;
}

/** An inline-editable cell — fills its whole <td> (which carries no
 * padding of its own, see EDITABLE_TD), saves on blur or Enter, only
 * when the value actually changed; Escape puts it back, and so does a
 * failed save. Remounts (via key) whenever the stored value changes, so
 * it always shows what's saved. */
function EditableCell({
  value,
  label,
  numeric = false,
  onSave,
}: {
  value: string;
  label: string;
  numeric?: boolean;
  onSave: (next: string) => Promise<boolean>;
}) {
  return (
    <input
      key={value}
      type="text"
      inputMode={numeric ? "decimal" : undefined}
      defaultValue={value}
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = value;
          e.currentTarget.blur();
        }
      }}
      onBlur={async (e) => {
        const input = e.currentTarget;
        const next = input.value.trim();
        if (next === value) return;
        if (!(await onSave(next))) input.value = value;
      }}
      className={`block w-full bg-transparent px-4 py-2.5 outline-none focus:bg-white focus:text-zinc-900 ${
        numeric ? "text-right tabular-nums" : ""
      }`}
    />
  );
}

// The <td> around an EditableCell — no padding, so the input itself
// (carrying the same px-4 py-2.5) fills the cell edge to edge.
const EDITABLE_TD = "border-r border-zinc-200 p-0";

const MIN_CATEGORIES_WIDTH = 200;
const DEFAULT_CATEGORIES_WIDTH = 280;

// Every column this table renders — Categories, Estimated Quantity,
// Unit, Labor, Material, Equipment, Other, Total Estimated Cost, Weight
// — used only to span the "Other" cost breakdown row across all of
// them. A plain constant rather than something computed: this table has
// no manage-mode/Action column anymore (see CostEstimateView's own doc
// comment on why), so the count never varies.
const _COLUMN_COUNT = 9;

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
 * list — the intended landing spot for an AI-imported document, and
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
  defaultLaborCostPercent,
  onImportBom,
  materialBreakdownOpen,
  materialBreakdownHighlightTaskId,
  onOpenMaterialBreakdown,
  onCloseMaterialBreakdown,
  onNavigateToCostEstimate,
  costEstimateHighlight,
}: {
  projectId: number;
  estimate: CostEstimate;
  /** The project's own default labor cost % (see
   * updateProjectDefaultLaborCostPercent's own doc comment) — forwarded
   * straight down to LaborBreakdownModalContent, which owns editing it. */
  defaultLaborCostPercent: number | null;
  /** Opens the shared "Import with AI" modal — owned by
   * project-detail-view.tsx, the nearest common ancestor, in case
   * another entry point ever needs the same modal instance. Forwarded
   * straight down to MaterialBreakdownModalContent's own footer. */
  onImportBom: () => void;
  /** The Material Breakdown modal's own open state and which task's row
   * (if any) to highlight once it opens — lifted up to
   * project-detail-view.tsx (same reasoning as onImportBom above) since
   * the Gantt Chart's own Edit Task form needs to open this exact modal
   * instance too, from a completely different subtree. This view's own
   * "Material" column header still opens it, just through this callback
   * now instead of local state. */
  materialBreakdownOpen: boolean;
  materialBreakdownHighlightTaskId: number | null;
  onOpenMaterialBreakdown: (taskId?: number) => void;
  onCloseMaterialBreakdown: () => void;
  onNavigateToCostEstimate?: (target: CostNavigateDestination) => void;
  costEstimateHighlight?: (CostNavigateDestination & { timestamp: number }) | null;
}) {
  // Project-wide, not per-task — see the two modal components' own doc
  // comments for why a column-header trigger replaced an earlier
  // per-task-row version of this.
  const [laborBreakdownOpen, setLaborBreakdownOpen] = useState(false);
  const [otherBreakdownOpen, setOtherBreakdownOpen] = useState(false);
  const [equipmentBreakdownOpen, setEquipmentBreakdownOpen] = useState(false);
  const [equipmentHighlight, setEquipmentHighlight] = useState<OtherBreakdownHighlightTarget>(null);
  const [materialBreakdownHighlight, setMaterialBreakdownHighlight] =
    useState<MaterialBreakdownHighlightTarget>(null);
  const [laborBreakdownHighlight, setLaborBreakdownHighlight] =
    useState<LaborBreakdownHighlightTarget>(null);
  const [otherBreakdownHighlight, setOtherBreakdownHighlight] =
    useState<OtherBreakdownHighlightTarget>(null);
  // A Weight cell's own click-through — how that weight was computed.
  const [weightBreakdown, setWeightBreakdown] = useState<WeightBreakdownTarget | null>(
    null
  );
  // Active highlight target triggered by navigation from the Weight Breakdown modal.
  const [highlightedTarget, setHighlightedTarget] = useState<{
    kind: "task" | "category";
    id: number;
    field?: CostEstimateHighlightField;
  } | null>(null);

  function handleCostNavigate(dest: CostNavigateDestination) {
    setWeightBreakdown(null);
    if (dest.field === "material") {
      setMaterialBreakdownHighlight({
        kind: dest.kind,
        id: dest.id,
        lineId: dest.materialId,
        materialName: dest.materialName,
      });
      onOpenMaterialBreakdown(dest.kind === "task" ? dest.id : undefined);
    } else if (dest.field === "labor") {
      setLaborBreakdownHighlight({
        kind: dest.kind,
        id: dest.id,
      });
      setLaborBreakdownOpen(true);
    } else if (dest.field === "other") {
      setOtherBreakdownHighlight({
        kind: dest.kind,
        id: dest.id,
        costName: dest.otherCostName,
      });
      setOtherBreakdownOpen(true);
    } else {
      onNavigateToCostEstimate?.(dest);
    }
  }

  // Every phase starts collapsed — this table is a quick-reference
  // summary now (all editing happens on the Gantt Chart below), so
  // landing on just the category rows/subtotals first, with the detail
  // an opt-in expand away, reads better than a long fully-open table on
  // every visit. Lazy initializer since this only ever needs to run
  // once, off however many categories exist at mount.
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState<
    Set<number>
  >(() => new Set(estimate.categories.map((c) => c.id)));

  // When navigated to a task, expand its parent category during render if collapsed.
  const [prevHighlightTimestamp, setPrevHighlightTimestamp] = useState<number | null>(null);
  if (costEstimateHighlight && costEstimateHighlight.timestamp !== prevHighlightTimestamp) {
    setPrevHighlightTimestamp(costEstimateHighlight.timestamp);
    if (costEstimateHighlight.field === "material") {
      setMaterialBreakdownHighlight({
        kind: costEstimateHighlight.kind,
        id: costEstimateHighlight.id,
        lineId: costEstimateHighlight.materialId,
        materialName: costEstimateHighlight.materialName,
      });
    } else if (costEstimateHighlight.field === "labor") {
      setLaborBreakdownHighlight({
        kind: costEstimateHighlight.kind,
        id: costEstimateHighlight.id,
      });
      setLaborBreakdownOpen(true);
    } else if (costEstimateHighlight.field === "other") {
      setOtherBreakdownHighlight({
        kind: costEstimateHighlight.kind,
        id: costEstimateHighlight.id,
        costName: costEstimateHighlight.otherCostName,
      });
      setOtherBreakdownOpen(true);
    } else if (costEstimateHighlight.kind === "task") {
      const parent = estimate.categories.find((c) =>
        c.tasks.some((t) => t.id === costEstimateHighlight.id)
      );
      if (parent && collapsedCategoryIds.has(parent.id)) {
        const next = new Set(collapsedCategoryIds);
        next.delete(parent.id);
        setCollapsedCategoryIds(next);
      }
    }
  }

  // Scroll to the row and flash the highlight when navigated here from the Weight Breakdown modal.
  useEffect(() => {
    if (!costEstimateHighlight) return;
    const { kind, id, field } = costEstimateHighlight;

    if (field === "material") {
      onOpenMaterialBreakdown(kind === "task" ? id : undefined);
      return;
    }

    if (field === "labor" || field === "other") {
      return;
    }

    const timer = setTimeout(() => {
      const selector =
        kind === "task"
          ? `[data-cost-task-row="${id}"]`
          : `[data-cost-category-row="${id}"]`;
      const el = document.querySelector(selector);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        setHighlightedTarget({ kind, id, field });
        const clearTimer = setTimeout(() => {
          setHighlightedTarget(null);
        }, 3000);
        return () => clearTimeout(clearTimer);
      }
    }, 70);

    return () => clearTimeout(timer);
  }, [costEstimateHighlight, onOpenMaterialBreakdown]);
  // The only resizable column — a task name can run much longer than
  // any of the fixed numeric columns need, so this one's width is
  // user-controlled instead of guessing a single width that fits every
  // project's own naming style.
  const [categoriesWidth, setCategoriesWidth] = useState(
    DEFAULT_CATEGORIES_WIDTH
  );

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
  const [saveError, setSaveError] = useState<string | null>(null);

  // Estimated Quantity/Unit — a task's, or a task-less category's own
  // (a category with tasks has none; its tasks each carry theirs).
  async function saveEstimatedQuantity(
    target: { kind: "task" | "category"; id: number },
    fields: { estimatedQuantity: number | null; unit: string | null }
  ): Promise<boolean> {
    if (fields.estimatedQuantity === null) {
      setSaveError("Estimated quantity must be 0 or more.");
      return false;
    }
    setSaveError(null);
    const input = { estimatedQuantity: fields.estimatedQuantity, unit: fields.unit };
    const result =
      target.kind === "task"
        ? await updateTaskEstimatedQuantity(target.id, projectId, input)
        : await updateCategoryEstimatedQuantity(target.id, projectId, input);
    if (result.error) {
      setSaveError(result.error);
      return false;
    }
    return true;
  }

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
            Add a phase and task items, or import a document with AI, from
            the Gantt Chart below to start building the cost breakdown
            structure.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          {saveError && (
            <p role="alert" className="px-4 py-2 text-sm text-red-600">
              {saveError}
            </p>
          )}
          <table className="w-full table-fixed text-left text-sm">
              <thead className="bg-white text-xs font-medium text-zinc-500">
                <tr>
                  <th
                    style={{ width: categoriesWidth }}
                    className="relative border-r border-zinc-200 px-4 py-2.5"
                  >
                    Tasks
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
                      className="flex h-full w-full cursor-pointer items-center justify-end gap-1 px-4 py-2.5 text-right transition hover:bg-zinc-900 hover:text-white"
                    >
                      Labor
                      <ChevronRight className="size-3.5 shrink-0" />
                    </button>
                  </th>
                  <th className="w-28 border-r border-zinc-200 text-right">
                    <button
                      type="button"
                      onClick={() => onOpenMaterialBreakdown()}
                      title="View the project's full material breakdown"
                      className="flex h-full w-full cursor-pointer items-center justify-end gap-1 px-4 py-2.5 text-right transition hover:bg-zinc-900 hover:text-white"
                    >
                      Material
                      <ChevronRight className="size-3.5 shrink-0" />
                    </button>
                  </th>
                  <th className="w-28 border-r border-zinc-200 text-right">
                    <button type="button" onClick={() => { setEquipmentHighlight(null); setEquipmentBreakdownOpen(true); }}
                      className="flex h-full w-full cursor-pointer items-center justify-end gap-1 px-4 py-2.5 text-right transition hover:bg-zinc-900 hover:text-white">
                      Tools &amp; Equipment <ChevronRight className="size-3.5 shrink-0" />
                    </button>
                  </th>
                  <th className="w-24 border-r border-zinc-200 text-right">
                    <button
                      type="button"
                      onClick={() => setOtherBreakdownOpen(true)}
                      title="View the project's full other cost breakdown"
                      className="flex h-full w-full cursor-pointer items-center justify-end gap-1 px-4 py-2.5 text-right transition hover:bg-zinc-900 hover:text-white"
                    >
                      Other
                      <ChevronRight className="size-3.5 shrink-0" />
                    </button>
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
                  // Each column is the category's own direct line (its
                  // labor/material/equipment/other — see 0047, 0042 and
                  // 0056_category_equipment_other.sql) plus every one of
                  // its tasks', the same way the Material Breakdown
                  // modal's own categoryAmount does it (see
                  // material-breakdown-modal-content.tsx).
                  const categoryLaborTotal =
                    category.categoryLaborEstimate +
                    category.tasks.reduce((sum, t) => sum + t.laborEstimate, 0);
                  const categoryMaterialTotal =
                    category.categoryMaterialEstimate +
                    category.tasks.reduce((sum, t) => sum + t.materialEstimate, 0);
                  const categoryEquipmentTotal =
                    category.categoryEquipmentEstimate +
                    category.tasks.reduce((sum, t) => sum + t.equipmentEstimate, 0);
                  const categoryOtherTotal =
                    category.categoryOtherEstimate +
                    category.tasks.reduce((sum, t) => sum + t.otherCostEstimate, 0);
                  const categoryTotalCost =
                    category.categoryMaterialEstimate +
                    category.categoryLaborEstimate +
                    category.categoryEquipmentEstimate +
                    category.categoryOtherEstimate +
                    category.tasks.reduce((sum, t) => sum + t.totalEstimateCost, 0);
                  return (
                    <Fragment key={category.id}>
                      <tr
                        data-cost-category-row={category.id}
                        className={`border-y border-zinc-200 text-xs font-medium transition-colors duration-500 ${
                          highlightedTarget?.kind === "category" &&
                          highlightedTarget.id === category.id
                            ? "bg-amber-50 text-zinc-900 ring-1 ring-amber-300 ring-inset"
                            : "bg-white text-zinc-500"
                        }`}
                      >
                        <td className="border-r border-zinc-200 px-4 py-2.5">
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
                        <td
                          className={
                            category.tasks.length === 0
                              ? EDITABLE_TD
                              : "border-r border-zinc-200 px-4 py-2.5 text-right"
                          }
                        >
                          {category.tasks.length === 0 ? (
                            <EditableCell
                              value={String(category.estimatedQuantity)}
                              label={`${category.name} estimated quantity`}
                              numeric
                              onSave={(next) =>
                                saveEstimatedQuantity(
                                  { kind: "category", id: category.id },
                                  { estimatedQuantity: parseQuantity(next), unit: category.unit }
                                )
                              }
                            />
                          ) : (
                            "—"
                          )}
                        </td>
                        <td
                          className={
                            category.tasks.length === 0
                              ? EDITABLE_TD
                              : "border-r border-zinc-200 px-4 py-2.5"
                          }
                        >
                          {category.tasks.length === 0 ? (
                            <EditableCell
                              value={category.unit ?? ""}
                              label={`${category.name} unit`}
                              onSave={(next) =>
                                saveEstimatedQuantity(
                                  { kind: "category", id: category.id },
                                  { estimatedQuantity: category.estimatedQuantity, unit: next }
                                )
                              }
                            />
                          ) : (
                            "—"
                          )}
                        </td>
                        <td
                          className={`border-r border-zinc-200 px-4 py-2.5 text-right transition-colors duration-500 ${
                            highlightedTarget?.kind === "category" &&
                            highlightedTarget.id === category.id &&
                            highlightedTarget.field === "labor"
                              ? "bg-amber-100/80 font-bold text-zinc-900 ring-1 ring-amber-400 ring-inset"
                              : ""
                          }`}
                        >
                          {formatCurrency(categoryLaborTotal)}
                        </td>
                        <td
                          className={`border-r border-zinc-200 px-4 py-2.5 text-right transition-colors duration-500 ${
                            highlightedTarget?.kind === "category" &&
                            highlightedTarget.id === category.id &&
                            highlightedTarget.field === "material"
                              ? "bg-amber-100/80 font-bold text-zinc-900 ring-1 ring-amber-400 ring-inset"
                              : ""
                          }`}
                        >
                          {formatCurrency(categoryMaterialTotal)}
                        </td>
                        <td
                          className={`border-r border-zinc-200 px-4 py-2.5 text-right transition-colors duration-500 ${
                            highlightedTarget?.kind === "category" &&
                            highlightedTarget.id === category.id &&
                            highlightedTarget.field === "equipment"
                              ? "bg-amber-100/80 font-bold text-zinc-900 ring-1 ring-amber-400 ring-inset"
                              : ""
                          }`}
                        >
                          <button type="button" className="cursor-pointer hover:underline" onClick={() => { setEquipmentHighlight({kind:"category",id:category.id}); setEquipmentBreakdownOpen(true); }}>{formatCurrency(categoryEquipmentTotal)}</button>
                        </td>
                        <td
                          className={`border-r border-zinc-200 px-4 py-2.5 text-right transition-colors duration-500 ${
                            highlightedTarget?.kind === "category" &&
                            highlightedTarget.id === category.id &&
                            highlightedTarget.field === "other"
                              ? "bg-amber-100/80 font-bold text-zinc-900 ring-1 ring-amber-400 ring-inset"
                              : ""
                          }`}
                        >
                          {formatCurrency(categoryOtherTotal)}
                        </td>
                        <td
                          className={`border-r border-zinc-200 px-4 py-2.5 text-right transition-colors duration-500 ${
                            highlightedTarget?.kind === "category" &&
                            highlightedTarget.id === category.id &&
                            highlightedTarget.field === "total"
                              ? "bg-amber-100/80 font-bold text-zinc-900 ring-1 ring-amber-400 ring-inset"
                              : ""
                          }`}
                        >
                          {formatCurrency(categoryTotalCost)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              setWeightBreakdown({ kind: "category", id: category.id })
                            }
                            className="cursor-pointer underline-offset-2 transition hover:underline"
                          >
                            {formatWeight(category.weight)}
                          </button>
                        </td>
                      </tr>

                      {isOpen &&
                        tasks.map((task) => (
                          <tr
                            key={task.id}
                            data-cost-task-row={task.id}
                            className={`border-b border-zinc-200 text-xs font-medium transition-colors duration-500 ${
                              highlightedTarget?.kind === "task" &&
                              highlightedTarget.id === task.id
                                ? "bg-amber-50 text-zinc-900 ring-1 ring-amber-300 ring-inset"
                                : "text-zinc-500 hover:bg-zinc-900 hover:text-white"
                            }`}
                          >
                            <td className="truncate border-r border-zinc-200 px-4 py-2.5 pl-8">
                              {task.name}
                            </td>
                            <td className={EDITABLE_TD}>
                              <EditableCell
                                value={String(task.estimatedQuantity)}
                                label={`${task.name} estimated quantity`}
                                numeric
                                onSave={(next) =>
                                  saveEstimatedQuantity(
                                    { kind: "task", id: task.id },
                                    { estimatedQuantity: parseQuantity(next), unit: task.unit }
                                  )
                                }
                              />
                            </td>
                            <td className={EDITABLE_TD}>
                              <EditableCell
                                value={task.unit ?? ""}
                                label={`${task.name} unit`}
                                onSave={(next) =>
                                  saveEstimatedQuantity(
                                    { kind: "task", id: task.id },
                                    { estimatedQuantity: task.estimatedQuantity, unit: next }
                                  )
                                }
                              />
                            </td>
                            <td
                              className={`border-r border-zinc-200 px-4 py-2.5 text-right transition-colors duration-500 ${
                                highlightedTarget?.kind === "task" &&
                                highlightedTarget.id === task.id &&
                                highlightedTarget.field === "labor"
                                  ? "bg-amber-100/80 font-bold text-zinc-900 ring-1 ring-amber-400 ring-inset"
                                  : ""
                              }`}
                            >
                              {formatCurrency(task.laborEstimate)}
                            </td>
                            <td
                              className={`border-r border-zinc-200 px-4 py-2.5 text-right transition-colors duration-500 ${
                                highlightedTarget?.kind === "task" &&
                                highlightedTarget.id === task.id &&
                                highlightedTarget.field === "material"
                                  ? "bg-amber-100/80 font-bold text-zinc-900 ring-1 ring-amber-400 ring-inset"
                                  : ""
                              }`}
                            >
                              {formatCurrency(task.materialEstimate)}
                            </td>
                            <td
                              className={`border-r border-zinc-200 px-4 py-2.5 text-right transition-colors duration-500 ${
                                highlightedTarget?.kind === "task" &&
                                highlightedTarget.id === task.id &&
                                highlightedTarget.field === "equipment"
                                  ? "bg-amber-100/80 font-bold text-zinc-900 ring-1 ring-amber-400 ring-inset"
                                  : ""
                              }`}
                            >
                              <button type="button" className="cursor-pointer hover:underline" onClick={() => { setEquipmentHighlight({kind:"task",id:task.id}); setEquipmentBreakdownOpen(true); }}>{formatCurrency(task.equipmentEstimate)}</button>
                            </td>
                            <td
                              className={`border-r border-zinc-200 px-4 py-2.5 text-right transition-colors duration-500 ${
                                highlightedTarget?.kind === "task" &&
                                highlightedTarget.id === task.id &&
                                highlightedTarget.field === "other"
                                  ? "bg-amber-100/80 font-bold text-zinc-900 ring-1 ring-amber-400 ring-inset"
                                  : ""
                              }`}
                            >
                              {formatCurrency(task.otherCostEstimate)}
                            </td>
                            <td
                              className={`border-r border-zinc-200 px-4 py-2.5 text-right transition-colors duration-500 ${
                                highlightedTarget?.kind === "task" &&
                                highlightedTarget.id === task.id &&
                                highlightedTarget.field === "total"
                                  ? "bg-amber-100/80 font-bold text-zinc-900 ring-1 ring-amber-400 ring-inset"
                                  : ""
                              }`}
                            >
                              {formatCurrency(task.totalEstimateCost)}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <button
                                type="button"
                                onClick={() =>
                                  setWeightBreakdown({ kind: "task", id: task.id })
                                }
                                className="cursor-pointer underline-offset-2 transition hover:underline"
                              >
                                {formatWeight(task.weight)}
                              </button>
                            </td>
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
              </tbody>
              {/* Same "black" as the project header (bg-zinc-900 — see
                  that header's own doc comment on this token). */}
              <tfoot>
                <tr className="bg-zinc-900 text-sm font-semibold text-white">
                  <td className="border-r border-white/10 px-4 py-3" colSpan={3}>
                    PROJECT TOTAL
                  </td>
                  <td className="border-r border-white/10 px-4 py-3 text-right">
                    {formatCurrency(summary.totalsByColumn.labor)}
                  </td>
                  <td className="border-r border-white/10 px-4 py-3 text-right">
                    {formatCurrency(summary.totalsByColumn.material)}
                  </td>
                  <td className="border-r border-white/10 px-4 py-3 text-right">
                    {formatCurrency(summary.totalsByColumn.equipment)}
                  </td>
                  <td className="border-r border-white/10 px-4 py-3 text-right">
                    {formatCurrency(summary.totalsByColumn.other)}
                  </td>
                  <td className="border-r border-white/10 px-4 py-3 text-right">
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
        onClose={() => {
          setMaterialBreakdownHighlight(null);
          onCloseMaterialBreakdown();
        }}
        title="Material Breakdown"
        size="large"
      >
        <MaterialBreakdownModalContent
          projectId={projectId}
          categories={categories}
          onClose={() => {
            setMaterialBreakdownHighlight(null);
            onCloseMaterialBreakdown();
          }}
          onImportBom={onImportBom}
          highlightTaskId={materialBreakdownHighlightTaskId}
          highlightTarget={materialBreakdownHighlight}
        />
      </Modal>

      <Modal
        open={laborBreakdownOpen}
        onClose={() => {
          setLaborBreakdownHighlight(null);
          setLaborBreakdownOpen(false);
        }}
        title="Labor Breakdown"
        size="medium"
      >
        <LaborBreakdownModalContent
          projectId={projectId}
          categories={categories}
          defaultLaborCostPercent={defaultLaborCostPercent}
          onClose={() => {
            setLaborBreakdownHighlight(null);
            setLaborBreakdownOpen(false);
          }}
          highlightTarget={laborBreakdownHighlight}
        />
      </Modal>

      <Modal
        open={otherBreakdownOpen}
        onClose={() => {
          setOtherBreakdownHighlight(null);
          setOtherBreakdownOpen(false);
        }}
        title="Other Cost Breakdown"
        size="large"
      >
        <OtherBreakdownModalContent
          projectId={projectId}
          categories={categories}
          onClose={() => {
            setOtherBreakdownHighlight(null);
            setOtherBreakdownOpen(false);
          }}
          highlightTarget={otherBreakdownHighlight}
        />
      </Modal>

      <Modal open={equipmentBreakdownOpen} onClose={() => setEquipmentBreakdownOpen(false)} title="Tools & Equipment Cost Breakdown" size="large">
        <OtherBreakdownModalContent projectId={projectId} categories={categories} costType="equipment"
          highlightTarget={equipmentHighlight} onClose={() => setEquipmentBreakdownOpen(false)} />
      </Modal>

      <WeightBreakdownModal
        projectId={projectId}
        categories={categories}
        target={weightBreakdown}
        onTargetChange={setWeightBreakdown}
        onNavigateToCostEstimate={handleCostNavigate}
      />
    </div>
  );
}
