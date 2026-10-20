import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, type SessionProfile } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/roles";

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
  projectId: number
): Promise<SessionProfile | null> {
  const profile = await getSessionProfile();
  if (!profile) return null;
  if (isAdminRole(profile.role)) return profile;
  if (!["foreman", "project_manager"].includes(profile.role) || !Number.isSafeInteger(projectId) || projectId <= 0) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq(profile.role === "project_manager" ? "project_manager_id" : "foreman_id", profile.id)
    .maybeSingle();

  return data ? profile : null;
}

/** Actions with no project context (e.g. document extraction) that both
 * portals may use. */
export async function requireAdminOrForeman(): Promise<SessionProfile | null> {
  const profile = await getSessionProfile();
  if (!profile) return null;
  return isAdminRole(profile.role) || profile.role === "foreman" || profile.role === "project_manager" ? profile : null;
}
