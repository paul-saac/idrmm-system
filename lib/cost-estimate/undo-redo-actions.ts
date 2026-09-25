"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";
import {
  restoreGanttSnapshot,
  getGanttUndoRedoState,
  captureGanttSnapshot,
  type GanttSnapshot,
} from "@/lib/cost-estimate/undo-redo";
import { getCostEstimate } from "@/lib/cost-estimate/data";
import type { CostEstimateActionState } from "@/lib/cost-estimate/actions";

async function requireAdmin() {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") return null;
  return profile;
}

/**
 * Shared by undoGanttAction/redoGanttAction below — they only differ in
 * which direction they look for a target checkpoint. Neither one records
 * a new checkpoint of its own (recordGanttCheckpoint is only called by
 * the 10 mutating actions in actions.ts) — doing so here would
 * immediately wipe out the very "redo" entries an undo just moved past.
 */
async function moveGanttHistory(
  projectId: number,
  direction: "undo" | "redo"
): Promise<CostEstimateActionState> {
  const profile = await requireAdmin();
  if (!profile) {
    return { error: "You are not authorized to manage cost estimates." };
  }

  const supabase = await createClient();

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, gantt_undo_cursor_id")
    .eq("id", projectId)
    .single();

  if (projectError || !project) {
    return { error: "Project not found." };
  }

  const cursorId = project.gantt_undo_cursor_id;
  if (cursorId === null) {
    return { error: direction === "undo" ? "Nothing to undo." : "Nothing to redo." };
  }

  const { data: target } =
    direction === "undo"
      ? await supabase
          .from("gantt_snapshots")
          .select("id, snapshot")
          .eq("project_id", projectId)
          .lt("id", cursorId)
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle()
      : await supabase
          .from("gantt_snapshots")
          .select("id, snapshot")
          .eq("project_id", projectId)
          .gt("id", cursorId)
          .order("id", { ascending: true })
          .limit(1)
          .maybeSingle();

  if (!target) {
    return { error: direction === "undo" ? "Nothing to undo." : "Nothing to redo." };
  }

  try {
    await restoreGanttSnapshot(supabase, projectId, target.snapshot as GanttSnapshot);
  } catch (error) {
    console.error(`[${direction}GanttAction] restore failed`, error);
    return { error: "Could not restore the previous state. Please try again." };
  }

  await supabase
    .from("projects")
    .update({ gantt_undo_cursor_id: target.id })
    .eq("id", projectId);

  revalidatePath(`/admin/projects/${projectId}`);

  // Fetched here, in the same round trip, so the Gantt Chart can show
  // the actual restored schedule the instant this action resolves —
  // see CostEstimateActionState's own doc comment on `categories` for
  // why that matters (revalidatePath above still triggers a full
  // router.refresh() on the client, which stays the source of truth
  // once it lands, this just means the UI doesn't have to sit idle
  // waiting for that much bigger, ~23-query round trip first). A
  // failure here isn't the undo/redo itself failing — the restore above
  // already committed — so it's logged and swallowed rather than
  // turned into an error the caller has to unwind a real state change
  // over; the client falls back to waiting for router.refresh() same as
  // before this existed.
  // Same reasoning for canUndo/canRedo as for `categories` just above —
  // confirmed directly this was the actual cause of a real bug report:
  // without this, the buttons kept showing their *pre*-undo enabled
  // state (stale canUndo/canRedo props) for however long router.refresh()
  // below took to land, meaning Undo stayed clickable — and a second
  // click during that window fired a second real undo — for that whole
  // window right after the first undo had already succeeded, not just a
  // cosmetic flash.
  let categories: CostEstimateActionState["categories"];
  let canUndo: CostEstimateActionState["canUndo"];
  let canRedo: CostEstimateActionState["canRedo"];
  try {
    const [costEstimate, historyState] = await Promise.all([
      getCostEstimate(projectId),
      getGanttUndoRedoState(projectId),
    ]);
    categories = costEstimate.categories;
    canUndo = historyState.canUndo;
    canRedo = historyState.canRedo;
  } catch (error) {
    console.error(`[${direction}GanttAction] post-restore refetch failed`, error);
  }

  return { success: true, categories, canUndo, canRedo };
}

export async function undoGanttAction(
  projectId: number
): Promise<CostEstimateActionState> {
  return moveGanttHistory(projectId, "undo");
}

export async function redoGanttAction(
  projectId: number
): Promise<CostEstimateActionState> {
  return moveGanttHistory(projectId, "redo");
}

/**
 * Wipes this project's entire Undo/Redo history — called once by
 * GanttChartView the instant it mounts (see its own useEffect), per an
 * explicit request that Undo/Redo should only ever track actions taken
 * in the *current* Gantt Chart session: reloading the page or
 * navigating away from it (the Overview tab, the only place this
 * component renders — see project-detail-view.tsx's own tab switch,
 * which unmounts it like any other tab) and coming back should always
 * start both buttons with nothing to undo or redo, never carrying
 * history over from an earlier visit.
 *
 * Deletes every existing gantt_snapshots row for this project, then
 * immediately seeds a fresh *baseline* one — the state exactly as it
 * stands right now, before this session's first edit — and points the
 * cursor at it, rather than leaving the cursor null.
 *
 * That baseline isn't optional bookkeeping — confirmed directly this
 * was the actual cause of a real bug report ("I add a task, Undo still
 * isn't clickable until I do a *second* thing"). recordGanttCheckpoint
 * itself only ever records a snapshot of the state *after* an action —
 * its own doc comment already calls out that a project's very first-
 * ever tracked edit has nothing older to undo back to, and explicitly
 * accepts that as a rare one-time edge case. Wiping the history on
 * every single session start turns that rare edge case into the
 * *common* one: with a null cursor, the first action of every session
 * would insert one snapshot with nothing before it — genuinely nothing
 * to undo to — and only a *second* action would finally give Undo
 * something (the first action's own snapshot) to revert to. Seeding
 * this baseline first closes that gap: the first real action now has
 * this baseline to undo back to, same as every action after it.
 *
 * Best-effort and silent like recordGanttCheckpoint's own doc comment
 * describes for the same reason — this is app-level housekeeping, not
 * something the admin asked for directly, so a failure here shouldn't
 * surface as an error interrupting their work. Worst case on failure:
 * falls back to a null cursor (the old behavior, before this baseline
 * existed) rather than leaving the project in a half-reset state.
 */
export async function resetGanttHistory(projectId: number): Promise<void> {
  try {
    const profile = await requireAdmin();
    if (!profile) return;

    const supabase = await createClient();
    await supabase.from("gantt_snapshots").delete().eq("project_id", projectId);

    let cursorId: number | null = null;
    try {
      const baseline = await captureGanttSnapshot(supabase, projectId);
      const { data: inserted, error } = await supabase
        .from("gantt_snapshots")
        .insert({
          project_id: projectId,
          snapshot: baseline as never,
          created_by: profile.id,
        })
        .select("id")
        .single();
      if (error || !inserted) {
        console.error("[resetGanttHistory] baseline insert failed", error);
      } else {
        cursorId = inserted.id;
      }
    } catch (error) {
      console.error("[resetGanttHistory] baseline capture failed", error);
    }

    await supabase
      .from("projects")
      .update({ gantt_undo_cursor_id: cursorId })
      .eq("id", projectId);

    revalidatePath(`/admin/projects/${projectId}`);
  } catch (error) {
    console.error("[resetGanttHistory] unexpected error", error);
  }
}
