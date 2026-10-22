import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/auth/roles";
import type { AccountEventAction } from "@/lib/supabase/types";

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
};

/** One project someone runs or ran, for their account's detail window. */
export type AccountProject = {
  id: number;
  name: string;
  status: "planning" | "ongoing" | "completed";
  as: "Project Manager" | "Foreman";
  startDate: string | null;
  endDate: string | null;
};

/** Something they did in the app — a progress update, a daily log, a
 * material request. */
export type AccountActivity = {
  kind: "progress" | "daily_log" | "material_request";
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

  const [assignedByAccount, signIns] = await Promise.all([
    mapAssignedProjects(supabase),
    lastSignIns(supabase),
  ]);

  return data.map((row) => ({
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
  }));
}
