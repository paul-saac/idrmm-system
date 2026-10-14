import { createClient } from "@/lib/supabase/server";
import { listProjects, type ProjectRow } from "@/lib/projects/data";
import { getCostEstimate, type CostCategory } from "@/lib/cost-estimate/data";
import {
  listEquipmentExpenses,
  listLaborExpenses,
  listMaterialExpenses,
  listOtherExpenses,
} from "@/lib/expenses/data";
import { listEquipment } from "@/lib/equipment/data";
import { listAssignments, listWorkers } from "@/lib/workers/data";
import {
  computeExpectedProgress,
  scheduleStatusFor,
  type ScheduleStatus,
} from "@/lib/task-progress/calculate";

/** One active (planning or ongoing) project on the dashboard. */
export type DashboardProject = {
  id: number;
  name: string;
  status: "planning" | "ongoing";
  location: string | null;
  targetEndDate: string | null;
  /** 0-100 — the Gantt chart's own overall progress (every task's weight
   * x its % complete). */
  progress: number;
  /** Where its schedule says it should be by now, same weighting — null
   * when nothing in it is dated yet. */
  expected: number | null;
  scheduleStatus: ScheduleStatus | null;
  budget: number | null;
  /** The four expense ledgers, the same "Actual Expense" the project's
   * own Overview tab shows. */
  spent: number;
  remaining: number | null;
};

export type RequestPriority = "routine" | "urgent" | "emergency";

/** A material or equipment request still waiting on approval. */
export type PendingRequest = {
  kind: "material" | "equipment";
  id: number;
  number: string;
  projectId: number;
  projectName: string;
  requestedByName: string | null;
  requestDate: string;
  priority: RequestPriority;
};

export type ActivityItem = {
  key: string;
  kind: "progress" | "material_request" | "equipment_request" | "project";
  actorName: string | null;
  /** What happened, after the actor's name. */
  action: string;
  projectId: number;
  projectName: string;
  /** Under the project's own page, e.g. "/materials/requests/7", or
   * "?progress=task-12" to open that row's Daily Progress Update. */
  path: string;
  at: string;
};

export type DashboardData = {
  stats: {
    ongoingProjects: number;
    completedProjects: number;
    pendingMaterialRequests: number;
    pendingEquipmentRequests: number;
  };
  activeProjects: DashboardProject[];
  pendingRequests: PendingRequest[];
  recentActivity: ActivityItem[];
  team: { total: number; available: number; assigned: number };
  equipment: { total: number; available: number; assigned: number; maintenance: number };
};

const LIST_SIZE = 6;
const ACTIVITY_SIZE = 8;

function profileName(profile: { first_name: string | null; last_name: string | null } | undefined) {
  if (!profile) return null;
  return `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim() || null;
}

/** The Gantt chart's overall progress, and where the schedule says it
 * should be by now — each task (or task-less phase) weighted by its share
 * of the project's cost. */
function projectProgress(categories: CostCategory[], project: ProjectRow, today: Date) {
  let actual = 0;
  let expected = 0;
  let dated = false;
  for (const category of categories) {
    const rows = category.tasks.length > 0 ? category.tasks : [category];
    for (const row of rows) {
      actual += (row.weight * row.percentComplete) / 100;
      const { timePercent } = computeExpectedProgress({
        plannedStartDate: row.plannedStartDate,
        plannedEndDate: row.plannedEndDate,
        workingDays: project.workingDays,
        holidays: project.holidays,
        today,
      });
      if (timePercent !== null) {
        expected += (row.weight * timePercent) / 100;
        dated = true;
      }
    }
  }
  return { actual, expected: dated ? expected : null };
}

async function summarizeProject(project: ProjectRow, today: Date): Promise<DashboardProject> {
  const [estimate, labor, material, equipment, other] = await Promise.all([
    getCostEstimate(project.id),
    listLaborExpenses(project.id),
    listMaterialExpenses(project.id),
    listEquipmentExpenses(project.id),
    listOtherExpenses(project.id),
  ]);
  const { actual, expected } = projectProgress(estimate.categories, project, today);
  const spent = [labor, material, equipment, other].reduce(
    (sum, groups) => sum + groups.reduce((s, group) => s + group.groupTotal, 0),
    0
  );
  return {
    id: project.id,
    name: project.name,
    status: project.status === "planning" ? "planning" : "ongoing",
    location: project.location,
    targetEndDate: project.targetEndDate,
    progress: actual,
    expected,
    scheduleStatus: expected === null ? null : scheduleStatusFor(actual, expected),
    budget: project.allocatedBudget,
    spent,
    remaining: project.allocatedBudget != null ? project.allocatedBudget - spent : null,
  };
}

/**
 * Everything the dashboard shows, for whoever's signed in — RLS scopes it
 * (an admin sees every project, a foreman their own).
 */
export async function getDashboardData(): Promise<DashboardData> {
  const supabase = await createClient();
  const today = new Date();

  const [
    projects,
    { data: materialRequests },
    { data: equipmentRequests },
    { data: taskEntries },
    { data: categoryEntries },
    workers,
    assignments,
    equipmentItems,
  ] = await Promise.all([
    listProjects(),
    supabase
      .from("material_requests")
      .select("id, mr_no, request_date, priority, status, requested_by, project_id, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("equipment_requisitions")
      .select("id, er_no, request_date, priority, status, requested_by, project_id, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("task_progress_entries")
      .select("task_id, recorded_by, created_at")
      .order("created_at", { ascending: false })
      .limit(ACTIVITY_SIZE),
    supabase
      .from("category_progress_entries")
      .select("category_id, recorded_by, created_at")
      .order("created_at", { ascending: false })
      .limit(ACTIVITY_SIZE),
    listWorkers(),
    listAssignments(),
    listEquipment(),
  ]);

  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const ongoing = projects.filter((p) => p.status === "ongoing");
  // Ongoing first, then the ones still being planned.
  const active = [...ongoing, ...projects.filter((p) => p.status === "planning")];

  // Names for the tasks/phases and people the activity mentions.
  const taskIds = Array.from(new Set((taskEntries ?? []).map((e) => e.task_id)));
  const categoryIds = Array.from(new Set((categoryEntries ?? []).map((e) => e.category_id)));
  const profileIds = Array.from(
    new Set(
      [
        ...(materialRequests ?? []).map((r) => r.requested_by),
        ...(equipmentRequests ?? []).map((r) => r.requested_by),
        ...(taskEntries ?? []).map((e) => e.recorded_by),
        ...(categoryEntries ?? []).map((e) => e.recorded_by),
      ].filter((id): id is string => Boolean(id))
    )
  );
  const [activeProjects, { data: tasks }, { data: categories }, { data: profiles }] =
    await Promise.all([
      Promise.all(active.map((project) => summarizeProject(project, today))),
      taskIds.length > 0
        ? supabase.from("estimate_tasks").select("id, task_name, project_id").in("id", taskIds)
        : Promise.resolve({ data: [] as never[] }),
      categoryIds.length > 0
        ? supabase
            .from("estimate_categories")
            .select("id, category_name, project_id")
            .in("id", categoryIds)
        : Promise.resolve({ data: [] as never[] }),
      profileIds.length > 0
        ? supabase.from("profiles").select("id, first_name, last_name").in("id", profileIds)
        : Promise.resolve({ data: [] as never[] }),
    ]);
  const nameOf = new Map((profiles ?? []).map((p) => [p.id, profileName(p)]));
  const taskById = new Map((tasks ?? []).map((t) => [t.id, t]));
  const categoryById = new Map((categories ?? []).map((c) => [c.id, c]));

  const pendingMaterial = (materialRequests ?? []).filter((r) => r.status === "submitted");
  const pendingEquipment = (equipmentRequests ?? []).filter((r) => r.status === "submitted");
  const pendingRequests: PendingRequest[] = [
    ...pendingMaterial.map((r) => ({
      kind: "material" as const,
      id: r.id,
      number: r.mr_no,
      projectId: r.project_id,
      projectName: projectName.get(r.project_id) ?? "—",
      requestedByName: nameOf.get(r.requested_by) ?? null,
      requestDate: r.request_date,
      priority: r.priority,
      createdAt: r.created_at,
    })),
    ...pendingEquipment.map((r) => ({
      kind: "equipment" as const,
      id: r.id,
      number: r.er_no,
      projectId: r.project_id,
      projectName: projectName.get(r.project_id) ?? "—",
      requestedByName: nameOf.get(r.requested_by) ?? null,
      requestDate: r.request_date,
      priority: r.priority,
      createdAt: r.created_at,
    })),
  ]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, LIST_SIZE)
    .map(({ createdAt: _createdAt, ...request }) => request);

  const activity: ActivityItem[] = [];
  for (const entry of taskEntries ?? []) {
    const task = taskById.get(entry.task_id);
    if (!task) continue;
    activity.push({
      key: `task-progress-${entry.task_id}-${entry.created_at}`,
      kind: "progress",
      actorName: entry.recorded_by ? (nameOf.get(entry.recorded_by) ?? null) : null,
      action: `updated the progress of ${task.task_name}`,
      projectId: task.project_id,
      projectName: projectName.get(task.project_id) ?? "—",
      path: `?progress=task-${entry.task_id}`,
      at: entry.created_at,
    });
  }
  for (const entry of categoryEntries ?? []) {
    const category = categoryById.get(entry.category_id);
    if (!category) continue;
    activity.push({
      key: `category-progress-${entry.category_id}-${entry.created_at}`,
      kind: "progress",
      actorName: entry.recorded_by ? (nameOf.get(entry.recorded_by) ?? null) : null,
      action: `updated the progress of ${category.category_name}`,
      projectId: category.project_id,
      projectName: projectName.get(category.project_id) ?? "—",
      path: `?progress=category-${entry.category_id}`,
      at: entry.created_at,
    });
  }
  for (const request of (materialRequests ?? []).slice(0, ACTIVITY_SIZE)) {
    activity.push({
      key: `material-request-${request.id}`,
      kind: "material_request",
      actorName: nameOf.get(request.requested_by) ?? null,
      action: `requested materials (${request.mr_no})`,
      projectId: request.project_id,
      projectName: projectName.get(request.project_id) ?? "—",
      path: `/materials/requests/${request.id}`,
      at: request.created_at,
    });
  }
  for (const request of (equipmentRequests ?? []).slice(0, ACTIVITY_SIZE)) {
    activity.push({
      key: `equipment-request-${request.id}`,
      kind: "equipment_request",
      actorName: nameOf.get(request.requested_by) ?? null,
      action: `requested equipment (${request.er_no})`,
      projectId: request.project_id,
      projectName: projectName.get(request.project_id) ?? "—",
      path: `/equipment/requests/${request.id}`,
      at: request.created_at,
    });
  }
  for (const project of projects) {
    if (!project.createdAt) continue;
    activity.push({
      key: `project-${project.id}`,
      kind: "project",
      actorName: null,
      action: "Project created",
      projectId: project.id,
      projectName: project.name,
      path: "",
      at: project.createdAt,
    });
  }
  activity.sort((a, b) => b.at.localeCompare(a.at));

  const openWorkerIds = new Set(assignments.filter((a) => a.open).map((a) => a.workerId));
  const assignedMembers = workers.filter((w) => openWorkerIds.has(w.id)).length;
  const inService = equipmentItems.filter((item) => item.status !== "retired");

  return {
    stats: {
      ongoingProjects: ongoing.length,
      completedProjects: projects.filter((p) => p.status === "completed").length,
      pendingMaterialRequests: pendingMaterial.length,
      pendingEquipmentRequests: pendingEquipment.length,
    },
    activeProjects,
    pendingRequests,
    recentActivity: activity.slice(0, ACTIVITY_SIZE),
    team: {
      total: workers.length,
      available: workers.length - assignedMembers,
      assigned: assignedMembers,
    },
    equipment: {
      total: inService.length,
      available: inService.filter((item) => item.status === "available").length,
      assigned: inService.filter((item) => item.status === "assigned").length,
      maintenance: inService.filter((item) => item.status === "maintenance").length,
    },
  };
}
