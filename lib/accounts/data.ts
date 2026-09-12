import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/auth/roles";

export type AssignedProject = {
  id: number;
  name: string;
};

export type AccountRow = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  status: "active" | "inactive";
  createdAt: string;
  assignedProjects: AssignedProject[];
};

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
    .select("id, project_name, project_manager_id, foreman_id");

  const byAccount = new Map<string, AssignedProject[]>();
  for (const row of data ?? []) {
    const project = { id: row.id, name: row.project_name };
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
    .select("id, email, first_name, last_name, role, status, created_at")
    .in("role", roles)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  const assignedByAccount = await mapAssignedProjects(supabase);

  return data.map((row) => ({
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    assignedProjects: assignedByAccount.get(row.id) ?? [],
  }));
}
