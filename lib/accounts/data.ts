import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/auth/roles";
import type { AccountEventAction } from "@/lib/supabase/types";
import type { AccessLevel, ProjectAccessSettings } from "./project-access";

export type AssignedProject = {
  id: number;
  name: string;
  /** Done — so its PM and foreman are free for another project (see
   * lib/accounts/availability.ts). */
  completed: boolean;
};

export type AccountRow = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  status: "active" | "inactive";
  invitationPending?: boolean;
  createdAt: string;
  assignedProjects: AssignedProject[];
  /** Null before their first sign-in (or before 0066 has run). */
  lastSignInAt: string | null;
  /** Projects and recent activity loaded with the table so the detail
   * panel does not open with an empty/loading delay. */
  detailPreview: Pick<AccountDetail, "projects" | "activity">;
  /** Preloaded project access settings so the Access section renders immediately. */
  accessPreview?: ProjectAccessSettings;
};

/** One project someone runs or ran, for their account's detail window. */
export type AccountProject = {
  id: number;
  name: string;
  location: string | null;
  status: "planning" | "ongoing" | "completed";
  as: "Project Manager" | "Foreman";
  startDate: string | null;
  endDate: string | null;
};

/** Something they did in the app — a progress update, a daily log, a
 * material request. */
export type AccountActivity = {
  kind: "progress" | "material_request";
  label: string;
  projectName: string | null;
  at: string;
};

/** One entry of the account change log (super admins only). */
export type AccountLogEntry = {
  id: number;
  actorName: string;
  action: AccountEventAction;
  details: string | null;
  createdAt: string;
};

/** Everything the detail window shows past the row itself. */
export type AccountDetail = {
  projects: AccountProject[];
  activity: AccountActivity[];
  /** Empty for anyone but a super admin. */
  log: AccountLogEntry[];
  /** Anything in the app points at them — so no deleting for good. */
  hasHistory: boolean;
};

/** When each account last signed in — empty before 0066 has run. */
async function lastSignIns(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data, error } = await supabase.rpc("account_last_sign_ins");
  if (error) return new Map<string, string | null>();
  return new Map((data ?? []).map((row) => [row.profile_id, row.last_sign_in_at]));
}

/**
 * Maps each profile id to the projects that reference them as either
 * project_manager_id or foreman_id. Projects has no single FK to profiles
 * to embed through, so this just fetches both columns (plus the name) for
 * every project and groups in JS — same "fetch and merge" approach as
 * lib/projects/data.ts.
 */
async function mapAssignedProjects(
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  const { data } = await supabase
    .from("projects")
    .select("id, project_name, project_manager_id, foreman_id, status");

  const byAccount = new Map<string, AssignedProject[]>();
  for (const row of data ?? []) {
    const project = {
      id: row.id,
      name: row.project_name,
      completed: row.status === "completed",
    };
    for (const accountId of [row.project_manager_id, row.foreman_id]) {
      const existing = byAccount.get(accountId) ?? [];
      existing.push(project);
      byAccount.set(accountId, existing);
    }
  }
  return byAccount;
}

/** Loads the account-detail sections visible at first paint in bulk. The
 * slower, privileged change-log/history checks remain in getAccountDetail. */
async function accountDetailPreviews(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accounts: {
    id: string;
    role: UserRole;
    status: "active" | "inactive";
    invitation_pending: boolean;
  }[]
) {
  const accountIds = accounts.map((a) => a.id);
  const previews = new Map<
    string,
    Pick<AccountDetail, "projects" | "activity"> & { access: ProjectAccessSettings }
  >(
    accounts.map((a) => [
      a.id,
      {
        projects: [],
        activity: [],
        access: { eligible: a.status === "active" && !a.invitation_pending, projects: [] },
      },
    ])
  );
  if (accountIds.length === 0) return previews;

  const [projectRows, accessRows, taskEntries, categoryEntries, materialRequests] =
    await Promise.all([
      supabase
        .from("projects")
        .select("id, project_name, location, status, start_date, target_end_date, actual_end_date, project_manager_id, foreman_id"),
      supabase
        .from("project_account_access")
        .select("project_id, profile_id, access_level")
        .in("profile_id", accountIds),
      supabase
        .from("task_progress_entries")
        .select("task_id, recorded_by, created_at")
        .in("recorded_by", accountIds)
        .order("created_at", { ascending: false })
        .limit(250),
      supabase
        .from("category_progress_entries")
        .select("category_id, recorded_by, created_at")
        .in("recorded_by", accountIds)
        .order("created_at", { ascending: false })
        .limit(250),
      supabase
        .from("material_requests")
        .select("project_id, mr_no, requested_by, created_at")
        .in("requested_by", accountIds)
        .order("created_at", { ascending: false })
        .limit(250),
    ]);

  const explicitAccess = new Map<string, AccessLevel>();
  for (const row of accessRows.data ?? []) {
    if (row.access_level === "none" || row.access_level === "view" || row.access_level === "edit") {
      explicitAccess.set(`${row.profile_id}:${row.project_id}`, row.access_level);
    }
  }
  const sortedProjects = [...(projectRows.data ?? [])].sort(
    (a, b) => a.project_name.localeCompare(b.project_name) || a.id - b.id
  );
  for (const account of accounts) {
    const preview = previews.get(account.id);
    if (!preview) continue;
    const eligible = account.status === "active" && !account.invitation_pending;
    preview.access = {
      eligible,
      projects: sortedProjects.map((project) => {
        const assigned =
          project.project_manager_id === account.id || project.foreman_id === account.id;
        let level: AccessLevel = "none";
        if (eligible) {
          if (account.role === "admin" || account.role === "super_admin") {
            level = "edit";
          } else if (account.role === "project_manager" || account.role === "foreman") {
            const saved = explicitAccess.get(`${account.id}:${project.id}`);
            if (saved) {
              level = saved;
            } else if (
              (account.role === "project_manager" && project.project_manager_id === account.id) ||
              (account.role === "foreman" && project.foreman_id === account.id)
            ) {
              level = "edit";
            }
          }
        }
        return {
          id: project.id,
          name: project.project_name,
          location: project.location,
          level,
          assigned,
        };
      }),
    };
  }

  const projectName = new Map((projectRows.data ?? []).map((row) => [row.id, row.project_name]));
  for (const row of projectRows.data ?? []) {
    for (const [accountId, assignment] of [
      [row.project_manager_id, "Project Manager"],
      [row.foreman_id, "Foreman"],
    ] as const) {
      const preview = previews.get(accountId);
      if (!preview) continue;
      preview.projects.push({
        id: row.id,
        name: row.project_name,
        location: row.location,
        status: row.status,
        as: assignment,
        startDate: row.start_date,
        endDate: row.actual_end_date ?? row.target_end_date,
      });
    }
  }
  for (const preview of previews.values()) {
    preview.projects.sort(
      (a, b) =>
        Number(a.status === "completed") - Number(b.status === "completed") ||
        (b.startDate ?? "").localeCompare(a.startDate ?? "")
    );
  }

  const taskIds = [...new Set((taskEntries.data ?? []).map((entry) => entry.task_id))];
  const categoryIds = [...new Set((categoryEntries.data ?? []).map((entry) => entry.category_id))];
  const [tasks, categories] = await Promise.all([
    taskIds.length
      ? supabase.from("estimate_tasks").select("id, task_name, project_id").in("id", taskIds)
      : Promise.resolve({ data: [] as { id: number; task_name: string; project_id: number }[] }),
    categoryIds.length
      ? supabase.from("estimate_categories").select("id, category_name, project_id").in("id", categoryIds)
      : Promise.resolve({ data: [] as { id: number; category_name: string; project_id: number }[] }),
  ]);
  const taskById = new Map((tasks.data ?? []).map((row) => [row.id, row]));
  const categoryById = new Map((categories.data ?? []).map((row) => [row.id, row]));

  for (const entry of taskEntries.data ?? []) {
    if (!entry.recorded_by) continue;
    const task = taskById.get(entry.task_id);
    previews.get(entry.recorded_by)?.activity.push({
      kind: "progress",
      label: `Updated progress on ${task?.task_name ?? "a task"}`,
      projectName: task ? (projectName.get(task.project_id) ?? null) : null,
      at: entry.created_at,
    });
  }
  for (const entry of categoryEntries.data ?? []) {
    if (!entry.recorded_by) continue;
    const category = categoryById.get(entry.category_id);
    previews.get(entry.recorded_by)?.activity.push({
      kind: "progress",
      label: `Updated progress on ${category?.category_name ?? "a phase"}`,
      projectName: category ? (projectName.get(category.project_id) ?? null) : null,
      at: entry.created_at,
    });
  }
  for (const request of materialRequests.data ?? []) {
    previews.get(request.requested_by)?.activity.push({
      kind: "material_request",
      label: `Requested materials (${request.mr_no})`,
      projectName: projectName.get(request.project_id) ?? null,
      at: request.created_at,
    });
  }
  for (const preview of previews.values()) {
    preview.activity.sort((a, b) => b.at.localeCompare(a.at));
    preview.activity.splice(12);
  }
  return previews;
}

/**
 * Lists profiles for the given roles. Relies on the "Admins can view all
 * profiles" RLS policy — only callable with an authenticated admin/super
 * admin session, which the calling page already enforces.
 */
export async function listAccountsByRole(
  roles: UserRole[]
): Promise<AccountRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, first_name, last_name, role, status, created_at, invitation_pending")
    .in("role", roles)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  const [assignedByAccount, signIns, previews] = await Promise.all([
    mapAssignedProjects(supabase),
    lastSignIns(supabase),
    accountDetailPreviews(supabase, data),
  ]);

  return data.map((row) => {
    const preview = previews.get(row.id);
    return {
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      role: row.role,
      status: row.status,
      invitationPending: row.invitation_pending,
      createdAt: row.created_at,
      assignedProjects: assignedByAccount.get(row.id) ?? [],
      lastSignInAt: signIns.get(row.id) ?? null,
      detailPreview: preview
        ? { projects: preview.projects, activity: preview.activity }
        : { projects: [], activity: [] },
      accessPreview: preview?.access,
    };
  });
}
