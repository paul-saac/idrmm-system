import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProjectAccess } from "@/lib/auth/project-access";
import { getCostEstimate } from "@/lib/cost-estimate/data";
import type { ProjectLifecycle } from "./lifecycle";
import { deriveProjectStatusFromProgress } from "@/lib/projects/status";
import type { ProjectStatus } from "@/lib/supabase/types";

/**
 * Reconciles status from saved work and every leaf item's completion.
 * Returns the resolved status either way, so a caller that already has
 * a project row in hand can patch it in-memory instead of re-fetching.
 *
 * Runs after saved progress changes and while reading projects, so old
 * automatic completion statuses and changed task scope are corrected.
 * Only trusted server callers may supply a freshly fetched lifecycle.
 */
export async function syncProjectStatusFromProgress(
  projectId: number,
  lifecycle?: ProjectLifecycle
): Promise<ProjectStatus | null> {
  if (!await requireProjectAccess(projectId)) return null;
  try {
    const supabase = await createClient();

    const { data: project, error: readError } = await supabase
      .from("projects")
      .select("status, archived_at")
      .eq("id", projectId)
      .maybeSingle();
    if (readError || !project) return null;
    if (project.archived_at) return project.status;

    const current = lifecycle ?? (await getCostEstimate(projectId, true)).lifecycle;
    const nextStatus = deriveProjectStatusFromProgress(current);
    if (nextStatus === project.status) return nextStatus;

    // Not a client-callable action: authorization and authoritative RLS reads
    // above precede this narrow derived-status write.
    const { error } = await createAdminClient().from("projects")
      .update({ status: nextStatus })
      .eq("id", projectId)
      .is("archived_at", null)
      .eq("status", project.status);

    if (error) {
      console.error("[syncProjectStatusFromProgress] projects status sync failed:", error.message);
    }

    return nextStatus;
  } catch (error) {
    console.error("[project-status] Could not verify current progress:", error);
    return null;
  }
}
