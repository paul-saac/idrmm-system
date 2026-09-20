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
