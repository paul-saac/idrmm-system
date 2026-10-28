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
      .select("status, actual_end_date")
      .eq("id", projectId)
      .maybeSingle();
    if (readError || !project) return null;

    const current = lifecycle ?? (await getCostEstimate(projectId, true)).lifecycle;
    const nextStatus = deriveProjectStatusFromProgress(current, project.actual_end_date);
    const actualEndDate = nextStatus === "completed" ? project.actual_end_date : null;
    if (nextStatus === project.status && actualEndDate === project.actual_end_date) return nextStatus;

    // Not a client-callable action: authorization and authoritative RLS reads
    // above precede this narrow derived-status write. Foremen cannot confirm
    // completion here; only an admin can set its date in updateProject.
    let update = createAdminClient().from("projects")
      .update({ status: nextStatus, actual_end_date: actualEndDate })
      .eq("id", projectId)
      .eq("status", project.status);
    // Do not overwrite a confirmation changed since this project was read.
    update = project.actual_end_date === null
      ? update.is("actual_end_date", null)
      : update.eq("actual_end_date", project.actual_end_date);
    const { error } = await update;

    if (error) {
      console.error("[syncProjectStatusFromProgress] projects status sync failed:", error.message);
    }

    return nextStatus;
  } catch (error) {
    console.error("[project-status] Could not verify current progress:", error);
    return null;
  }
}
