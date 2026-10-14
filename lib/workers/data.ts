import { createClient } from "@/lib/supabase/server";
import { toIsoDate } from "@/lib/task-progress/calculate";
import {
  categoryForTitle,
  isMemberCategory,
  type EmploymentType,
  type MemberCategory,
} from "@/lib/workers/presets";

/** One member of the company Team (the admin's Team page) — assigned
 * straight to tasks/phases from the Gantt chart. See 0059_company_team.sql
 * and 0060_team_member_details.sql. */
export type Worker = {
  id: number;
  fullName: string;
  /** Their job, e.g. Foreman or Mason (stored as trade). */
  title: string | null;
  contactNumber: string | null;
  /** YYYY-MM-DD. */
  dateHired: string | null;
  /** The Team page's own table — see 0063_team_categories.sql. */
  category: MemberCategory;
  employmentType: EmploymentType;
  subcontractorCompany: string | null;
  /** Their own login account, when they have one (a project manager's
   * or foreman's). */
  profileId: string | null;
};

/** One task or phase a member is (or was) on. Open while its project
 * isn't completed and it hasn't ended (no end date, or one today or
 * later) — any open one makes them Assigned rather than Available. */
export type WorkerAssignment = {
  workerId: number;
  /** "project": a project they run, as its project manager or foreman. */
  kind: "task" | "category" | "project";
  itemId: number;
  itemName: string;
  projectId: number;
  projectName: string;
  startDate: string | null;
  endDate: string | null;
  open: boolean;
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

export async function listWorkers(): Promise<Worker[]> {
  const supabase = await createClient();
  // "*" so columns a migration hasn't added yet read as empty.
  const { data } = await supabase
    .from("workers")
    .select("*")
    .order("full_name", { ascending: true });

  return (data ?? []).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    title: row.trade,
    contactNumber: row.contact_number ?? null,
    dateHired: row.date_hired ?? null,
    // Before 0063 has run: a category from the title, an employee. A
    // retired one (laborer, until 0064 has run) falls back the same way.
    category: isMemberCategory(row.category ?? "")
      ? row.category
      : (categoryForTitle(row.trade ?? "") ?? "skilled"),
    employmentType: row.employment_type ?? "employee",
    subcontractorCompany: row.subcontractor_company ?? null,
    profileId: row.profile_id ?? null,
  }));
}

/** Every member's assignments, across every project — see
 * team_assignments (0060). Empty until that migration has run. */
export async function listAssignments(): Promise<WorkerAssignment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("team_assignments");
  if (error) return [];

  const today = toIsoDate(new Date());
  return (data ?? []).map((row) => ({
    workerId: row.worker_id,
    kind: row.item_kind,
    itemId: row.item_id,
    itemName: row.item_name,
    projectId: row.project_id,
    projectName: row.project_name,
    startDate: row.start_date,
    endDate: row.end_date,
    open: !row.project_completed && (row.end_date === null || row.end_date >= today),
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

/** A project manager's or foreman's login account a Team member can be
 * linked to (Worker.profileId). */
export type LinkableAccount = {
  id: string;
  name: string;
  email: string;
  role: "project_manager" | "foreman";
  active: boolean;
};
