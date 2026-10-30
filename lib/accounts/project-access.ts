"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/roles";
import { revalidatePath } from "next/cache";
import type { AccountRow } from "./data";

export type AccessLevel = "none" | "view" | "edit";
export type ProjectAccessOption = {
  id: number; name: string; location: string | null; level: AccessLevel; assigned: boolean;
};
export type ProjectAccessSettings = { eligible: boolean; projects: ProjectAccessOption[] };

async function managerClient() {
  const profile = await getSessionProfile();
  if (!profile || (!isAdminRole(profile.role) && profile.role !== "project_manager")) return null;
  return { profile, client: await createClient() };
}

export async function loadProjectAccess(accountId: string): Promise<{ settings?: ProjectAccessSettings; error?: string }> {
  const manager = await managerClient();
  if (!manager) return { error: "You cannot manage project access." };
  const { data, error } = await manager.client.rpc("project_account_access_editor", { p_profile_id: accountId });
  if (error) return { error: ["PGRST202", "42883"].includes(error.code)
    ? "Apply migration 0101 to enable customized project access."
    : "Could not load project access. Please retry." };
  return { settings: data as ProjectAccessSettings };
}

export async function saveProjectAccess(accountId: string, changes: { id: number; level: AccessLevel; previous: AccessLevel }[]) {
  const manager = await managerClient();
  if (!manager) return { error: "You cannot manage project access." };
  if (!Array.isArray(changes) || !changes.length || changes.length > 500 || changes.some(change =>
    !Number.isSafeInteger(change.id) || change.id <= 0 ||
    !["none", "view", "edit"].includes(change.level) || !["none", "view", "edit"].includes(change.previous))) {
    return { error: "Choose valid project access settings." };
  }
  const { error } = await manager.client.rpc("save_project_account_access", {
    p_profile_id: accountId, p_changes: changes,
  });
  if (error) return { error: ["P0001", "42501", "40001", "22023"].includes(error.code)
    ? error.message : "Could not save project access. Check migration 0101 and retry." };
  for (const base of ["/admin", "/project-manager", "/foreman"]) revalidatePath(base, "layout");
  return { success: "Project access saved." };
}

/** PMs see an access editor, never credentials or account-management actions. */
export async function listProjectAccessAccounts(): Promise<AccountRow[]> {
  const manager = await managerClient();
  if (!manager) return [];
  const { data, error } = await manager.client.from("profiles")
    .select("id,email,first_name,last_name,role,status,invitation_pending,created_at")
    .in("role", ["project_manager", "foreman"]).neq("id", manager.profile.id)
    .order("first_name");
  if (error) return [];
  return (data ?? []).map(row => ({
    id: row.id, email: row.email, firstName: row.first_name, lastName: row.last_name,
    role: row.role, status: row.status, invitationPending: row.invitation_pending,
    createdAt: row.created_at, assignedProjects: [], lastSignInAt: null,
    detailPreview: { projects: [], activity: [] },
  }));
}
