import { createClient } from "@/lib/supabase/server";

/** One entry in a project's own Manpower roster — see the Gantt Chart
 * Schedule's "Manpower" toolbar button. */
export type Worker = {
  id: number;
  fullName: string;
  trade: string | null;
};

/** Every task's current set of assigned worker ids, for one project —
 * powers the Gantt task list's own "Assigned" column. Keyed by task id
 * (as a string, since object keys always are) rather than an array of
 * rows since every read site wants "who's on this task" for a specific
 * task, not the flat list. A plain object rather than a Map — this
 * crosses the Server -> Client boundary at app/admin/projects/[id]/
 * page.tsx -> ProjectDetailView ("use client"), and a plain JSON-
 * shaped object is unambiguously safe to pass across that boundary,
 * unlike a Map. */
export type TaskWorkerAssignments = Record<number, number[]>;

/** Same idea as TaskWorkerAssignments above, one level up — a category
 * (phase) with no tasks yet (or work that belongs to the phase as a
 * whole) can still have workers assigned directly. Keyed by category id
 * for the same reason. See 0045_category_worker_assignments.sql. */
export type CategoryWorkerAssignments = Record<number, number[]>;

export async function listWorkers(projectId: number): Promise<Worker[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("workers")
    .select("id, full_name, trade")
    .eq("project_id", projectId)
    .order("full_name", { ascending: true });

  return (data ?? []).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    trade: row.trade,
  }));
}

export async function listTaskWorkerAssignments(
  projectId: number
): Promise<TaskWorkerAssignments> {
  const supabase = await createClient();

  // task_worker_assignments has no project_id column of its own (it
  // hangs off task_id, which already implies a project) — same "fetch
  // this project's task ids first" shape getCostEstimate itself uses
  // for its own child-table fetches.
  const { data: taskRows } = await supabase
    .from("estimate_tasks")
    .select("id")
    .eq("project_id", projectId);

  const taskIds = (taskRows ?? []).map((row) => row.id);
  if (taskIds.length === 0) return {};

  const { data } = await supabase
    .from("task_worker_assignments")
    .select("task_id, worker_id")
    .in("task_id", taskIds);

  const result: TaskWorkerAssignments = {};
  for (const row of data ?? []) {
    const existing = result[row.task_id];
    if (existing) {
      existing.push(row.worker_id);
    } else {
      result[row.task_id] = [row.worker_id];
    }
  }
  return result;
}

export async function listCategoryWorkerAssignments(
  projectId: number
): Promise<CategoryWorkerAssignments> {
  const supabase = await createClient();

  // Unlike task_worker_assignments, category_worker_assignments could
  // filter straight off estimate_categories.project_id via a join, but
  // Supabase's own .in() shape (fetch this project's category ids
  // first, same as listTaskWorkerAssignments does for tasks) keeps both
  // functions symmetric and avoids relying on PostgREST's embedded-
  // filter syntax for a table with no direct project_id column of its
  // own.
  const { data: categoryRows } = await supabase
    .from("estimate_categories")
    .select("id")
    .eq("project_id", projectId);

  const categoryIds = (categoryRows ?? []).map((row) => row.id);
  if (categoryIds.length === 0) return {};

  const { data } = await supabase
    .from("category_worker_assignments")
    .select("category_id, worker_id")
    .in("category_id", categoryIds);

  const result: CategoryWorkerAssignments = {};
  for (const row of data ?? []) {
    const existing = result[row.category_id];
    if (existing) {
      existing.push(row.worker_id);
    } else {
      result[row.category_id] = [row.worker_id];
    }
  }
  return result;
}
