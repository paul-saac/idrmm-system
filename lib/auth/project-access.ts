import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, type SessionProfile } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/roles";

export type ProjectAccessLevel = "none" | "view" | "edit";

export async function getProjectAccessLevel(projectId: number): Promise<ProjectAccessLevel> {
  const profile = await getSessionProfile();
  if (!profile || !Number.isSafeInteger(projectId) || projectId <= 0) return "none";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("project_access_level", { p_project_id: projectId });
  if (!error) return data === "edit" || data === "view" ? data : "none";
  // Preserve existing assignments only while migration 0101 is not installed.
  if (!["PGRST202", "42883"].includes(error.code)) return "none";
  let query = supabase.from("projects").select("*").eq("id", projectId);
  if (!isAdminRole(profile.role)) {
    query = query.eq(profile.role === "project_manager" ? "project_manager_id" : "foreman_id", profile.id);
  }
  const { data: project } = await query.maybeSingle();
  return project ? project.archived_at ? "view" : "edit" : "none";
}

/**
 * The signed-in profile if they may work inside this project — any admin,
 * or its assigned foreman or project manager — otherwise null.
 *
 * Row-level security (0051_foreman_project_access.sql) is the real
 * boundary; this is the server-action-level check that gives a clear
 * error instead of a silently empty write, and it's what stops a foreman
 * from passing some other project's id.
 */
export async function requireProjectAccess(
  projectId: number,
  mode: "view" | "edit" = "edit"
): Promise<SessionProfile | null> {
  const profile = await getSessionProfile();
  if (!profile) return null;
  if ((!isAdminRole(profile.role) && !["foreman", "project_manager"].includes(profile.role)) || !Number.isSafeInteger(projectId) || projectId <= 0) return null;

  const level = await getProjectAccessLevel(projectId);
  return level === "edit" || (mode === "view" && level === "view") ? profile : null;
}

/** Actions with no project context (e.g. document extraction) that both
 * portals may use. */
export async function requireAdminOrForeman(): Promise<SessionProfile | null> {
  const profile = await getSessionProfile();
  if (!profile) return null;
  return isAdminRole(profile.role) || profile.role === "foreman" || profile.role === "project_manager" ? profile : null;
}
