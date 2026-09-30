import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, type SessionProfile } from "@/lib/auth/session";

/**
 * The signed-in profile if they may work inside this project — any admin,
 * or the foreman assigned to it (projects.foreman_id) — otherwise null.
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
  if (profile.role === "admin") return profile;
  if (profile.role !== "foreman" || !Number.isFinite(projectId)) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("foreman_id", profile.id)
    .maybeSingle();

  return data ? profile : null;
}

/** Actions with no project context (e.g. document extraction) that both
 * portals may use. */
export async function requireAdminOrForeman(): Promise<SessionProfile | null> {
  const profile = await getSessionProfile();
  if (!profile) return null;
  return profile.role === "admin" || profile.role === "foreman" ? profile : null;
}
