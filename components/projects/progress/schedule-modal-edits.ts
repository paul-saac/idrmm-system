import type { CostCategory } from "@/lib/cost-estimate/data";

export type ScheduleModalEdit = {
  kind: "task" | "category";
  id: number;
  name?: string;
  isMilestone?: boolean;
  /** Undefined means this form does not expose the relationship. */
  successorId?: number | null;
};
export type PendingScheduleModalEdit = { token: number; edit: ScheduleModalEdit; pending: boolean };

export function scheduleModalEdit(kind: ScheduleModalEdit["kind"], id: number, form: FormData): ScheduleModalEdit {
  const successorField = kind === "task" ? "successorTaskId" : "successorCategoryId";
  const successor = Number(form.get(successorField));
  return {
    kind, id,
    ...(kind === "category" && form.has("categoryName") ? { name: String(form.get("categoryName")).trim() } : {}),
    ...(kind === "task" || form.has("milestoneField") ? { isMilestone: form.get("isMilestone") === "on" } : {}),
    ...(form.has(successorField) ? { successorId: Number.isSafeInteger(successor) && successor > 0 ? successor : null } : {}),
  };
}

/** Patch only fields owned by the Edit modal. Dates, costs, progress, priority,
 * assignments and the edited row's own predecessor are preserved. */
export function applyScheduleModalEdits(categories: CostCategory[], edits: readonly ScheduleModalEdit[]): CostCategory[] {
  return edits.reduce((current, edit) => current.map(category => {
    if (edit.kind === "category") {
      let next = category;
      if (category.id === edit.id) next = { ...next,
        ...(edit.name !== undefined ? { name: edit.name } : {}),
        ...(edit.isMilestone !== undefined ? { isMilestone: edit.isMilestone } : {}),
      };
      if (edit.successorId !== undefined) {
        if (category.id === edit.successorId) next = { ...next, predecessorCategoryId: edit.id };
        else if (category.predecessorCategoryId === edit.id) next = { ...next, predecessorCategoryId: null };
      }
      return next;
    }
    return { ...category, tasks: category.tasks.map(task => {
      let next = task;
      if (task.id === edit.id && edit.isMilestone !== undefined) next = { ...next, isMilestone: edit.isMilestone };
      if (edit.successorId !== undefined) {
        if (task.id === edit.successorId) next = { ...next, predecessorTaskId: edit.id };
        else if (task.predecessorTaskId === edit.id) next = { ...next, predecessorTaskId: null };
      }
      return next;
    }) };
  }), categories);
}

function sameModalFields(left: CostCategory[], right: CostCategory[]) {
  return left.every((category, index) => {
    const next = right[index];
    return category.name === next.name && category.isMilestone === next.isMilestone &&
      (category.predecessorCategoryId ?? null) === (next.predecessorCategoryId ?? null) &&
      category.tasks.every((task, taskIndex) => task.isMilestone === next.tasks[taskIndex].isMilestone &&
        task.predecessorTaskId === next.tasks[taskIndex].predecessorTaskId);
  });
}

/** Retire a saved prefix only when server data confirms its combined result.
 * Checking the combined result handles rapid edits that replace earlier links
 * or change a milestone back before the first refresh arrives. */
export function unconfirmedScheduleModalEdits(categories: CostCategory[], pending: PendingScheduleModalEdit[]) {
  let confirmed = 0;
  const prefix: ScheduleModalEdit[] = [];
  for (let index = 0; index < pending.length && !pending[index].pending; index++) {
    prefix.push(pending[index].edit);
    // A freshly created row can still be missing from an older refresh.
    // Its absence is not confirmation of the edit just made to that row.
    if (!prefix.every(edit => edit.kind === "category"
      ? categories.some(category => category.id === edit.id)
      : categories.some(category => category.tasks.some(task => task.id === edit.id)))) continue;
    if (sameModalFields(categories, applyScheduleModalEdits(categories, prefix))) confirmed = index + 1;
  }
  return confirmed ? pending.slice(confirmed) : pending;
}
