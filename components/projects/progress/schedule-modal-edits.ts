import type { CostCategory } from "@/lib/cost-estimate/data";

export type ScheduleModalEdit = {
  kind: "task" | "category";
  id: number;
  name?: string;
  isMilestone?: boolean;
  /** Undefined means this form does not expose the relationship. */
  successorId?: number | null;
  successorKind?: "category" | "task";
  predecessorId?: number | null;
  predecessorKind?: "category" | "task";
  previousSuccessorId?: number | null;
  previousSuccessorKind?: "category" | "task";
};
export type PendingScheduleModalEdit = { token: number; edit: ScheduleModalEdit; pending: boolean };

export function scheduleModalEdit(kind: ScheduleModalEdit["kind"], id: number, form: FormData): ScheduleModalEdit {
  const successorField = kind === "task" ? "successorTaskId" : "successorCategoryId";
  const successor = Number(form.get(successorField));
  const projectSuccessor = /^(category|task):([1-9][0-9]*)$/.exec(String(form.get("successorRowKey") ?? ""));
  const predecessor = /^(category|task):([1-9][0-9]*)$/.exec(String(form.get("predecessorRowKey") ?? ""));
  const previous = /^(category|task):([1-9][0-9]*)$/.exec(String(form.get("previousSuccessorRowKey") ?? ""));
  return {
    kind, id,
    ...(form.has("previousSuccessorRowKey") ? { previousSuccessorId: previous ? Number(previous[2]) : null,
      previousSuccessorKind: (previous?.[1] ?? kind) as "category" | "task" } : {}),
    ...(form.has("predecessorRowKey") ? { predecessorId: predecessor ? Number(predecessor[2]) : null,
      predecessorKind: (predecessor?.[1] ?? kind) as "category" | "task" } : {}),
    ...(kind === "category" && form.has("categoryName") ? { name: String(form.get("categoryName")).trim() } : {}),
    ...(kind === "task" || form.has("milestoneField") ? { isMilestone: form.get("isMilestone") === "on" } : {}),
    ...(form.has("successorRowKey") ? { successorId: projectSuccessor ? Number(projectSuccessor[2]) : null,
      successorKind: (projectSuccessor?.[1] ?? kind) as "category" | "task" }
      : form.has(successorField) ? { successorId: Number.isSafeInteger(successor) && successor > 0 ? successor : null } : {}),
  };
}

/** Patch only fields owned by the Edit modal. Dates, costs, progress, priority,
 * assignments and relationships not exposed by the form are preserved. */
export function applyScheduleModalEdits(categories: CostCategory[], edits: readonly ScheduleModalEdit[]): CostCategory[] {
  function dependency<T extends { id: number; predecessorCategoryId?: number | null; predecessorTaskId?: number | null }>(row: T, kind: "category" | "task", edit: ScheduleModalEdit): T {
    if (kind === edit.kind && row.id === edit.id && edit.predecessorId !== undefined) return { ...row,
      predecessorCategoryId: edit.predecessorKind === "category" ? edit.predecessorId : null,
      predecessorTaskId: edit.predecessorKind === "task" ? edit.predecessorId : null,
    };
    if (edit.successorId === undefined) return row;
    if (kind === (edit.successorKind ?? edit.kind) && row.id === edit.successorId) return { ...row,
      predecessorCategoryId: edit.kind === "category" ? edit.id : null,
      predecessorTaskId: edit.kind === "task" ? edit.id : null,
    };
    const ownsOldLink = edit.previousSuccessorId === undefined || (kind === edit.previousSuccessorKind && row.id === edit.previousSuccessorId);
    if (ownsOldLink && edit.kind === "category" && row.predecessorCategoryId === edit.id) return { ...row, predecessorCategoryId: null };
    if (ownsOldLink && edit.kind === "task" && row.predecessorTaskId === edit.id) return { ...row, predecessorTaskId: null };
    return row;
  }
  return edits.reduce((current, edit) => current.map(category => {
    let next = dependency(category, "category", edit);
    if (edit.kind === "category" && category.id === edit.id) next = { ...next,
        ...(edit.name !== undefined ? { name: edit.name } : {}),
        ...(edit.isMilestone !== undefined ? { isMilestone: edit.isMilestone } : {}),
    };
    return { ...next, tasks: next.tasks.map(task => {
      let updated = dependency(task, "task", edit);
      if (edit.kind === "task" && task.id === edit.id && edit.isMilestone !== undefined) updated = { ...updated, isMilestone: edit.isMilestone };
      return updated;
    }) };
  }), categories);
}

function sameModalFields(left: CostCategory[], right: CostCategory[]) {
  return left.every((category, index) => {
    const next = right[index];
    return category.name === next.name && category.isMilestone === next.isMilestone &&
      (category.predecessorCategoryId ?? null) === (next.predecessorCategoryId ?? null) &&
      (category.predecessorTaskId ?? null) === (next.predecessorTaskId ?? null) &&
      category.tasks.every((task, taskIndex) => task.isMilestone === next.tasks[taskIndex].isMilestone &&
        (task.predecessorTaskId ?? null) === (next.tasks[taskIndex].predecessorTaskId ?? null) &&
        (task.predecessorCategoryId ?? null) === (next.tasks[taskIndex].predecessorCategoryId ?? null));
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
