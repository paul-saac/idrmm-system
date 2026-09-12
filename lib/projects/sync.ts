import { createClient } from "@/lib/supabase/server";
import { deriveProjectStatusFromProgress } from "@/lib/projects/status";
import type { ProjectStatus } from "@/lib/supabase/types";

/**
 * Recomputes what projects.status should be for a given progress % and
 * writes it if it's changed (see deriveProjectStatusFromProgress).
 * Returns the resolved status either way, so a caller that already has
 * a project row in hand can patch it in-memory instead of re-fetching.
 *
 * Called from two places, for two different reasons:
 *  - lib/daily-logs/actions.ts, right after the two events that can
 *    move progress going forward (approving a daily log, resolving a
 *    flag on a work_item entry) — keeps status fresh immediately.
 *  - app/admin/projects/[id]/page.tsx, on every page load — progress
 *    can also shift from something that isn't a daily-log event at all
 *    (editing the Cost Estimate Breakdown changes a task's weight/
 *    estimated_quantity, which changes overallPercent with the exact
 *    same logged quantities), and this is also what retroactively
 *    corrects any project whose status went stale before this feature
 *    existed — there's no migration that could "replay" those old
 *    approvals, so self-healing on the next view is the fix.
 */
export async function syncProjectStatusFromProgress(
  projectId: number,
  progressPercent: number
): Promise<ProjectStatus | null> {
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("status")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return null;

  const nextStatus = deriveProjectStatusFromProgress(
    project.status,
    progressPercent
  );
  if (nextStatus === project.status) return project.status;

  const { error } = await supabase
    .from("projects")
    .update({ status: nextStatus })
    .eq("id", projectId);

  if (error) {
    console.error(
      "[syncProjectStatusFromProgress] projects status sync failed:",
      error.message
    );
    return project.status;
  }

  return nextStatus;
}
