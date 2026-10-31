import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;
type RawRow = Record<string, unknown> & { id: number };
export type GanttSnapshot = {
  categories: RawRow[];
  tasks: RawRow[];
  otherCosts: RawRow[];
  materialAssignments: RawRow[];
  categoryMaterialAssignments?: RawRow[];
};

/** One consistent database snapshot, rather than five independent HTTP reads. */
export async function captureGanttSnapshot(client: SupabaseClient, projectId: number): Promise<GanttSnapshot> {
  const { data, error } = await client.rpc("gantt_snapshot", { p_project_id: projectId });
  if (error || !data) throw new Error("Could not read the schedule history.");
  return data as unknown as GanttSnapshot;
}

/** The edit has already saved. History failures must not masquerade as edit failures.
 * A later Undo checks the live state against its checkpoint before writing anything.
 */
export async function recordGanttCheckpoint(client: SupabaseClient, projectId: number, _userId: string): Promise<void> {
  try {
    const { error } = await client.rpc("gantt_history", { p_project_id: projectId, p_action: "checkpoint" });
    if (error) console.error("[recordGanttCheckpoint] failed", error.code);
  } catch (error) {
    console.error("[recordGanttCheckpoint] failed", error);
  }
}

export async function getGanttUndoRedoState(
  projectId: number
): Promise<{ canUndo: boolean; canRedo: boolean }> {
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("gantt_undo_cursor_id")
    .eq("id", projectId)
    .single();

  const cursorId = project?.gantt_undo_cursor_id ?? null;

  // No checkpoint has ever been recorded for this project — cursor is
  // only ever set (never cleared) by recordGanttCheckpoint, so null here
  // means the log for this project is genuinely empty.
  if (cursorId === null) {
    return { canUndo: false, canRedo: false };
  }

  const [{ count: olderCount }, { count: newerCount }] = await Promise.all([
    supabase
      .from("gantt_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .lt("id", cursorId),
    supabase
      .from("gantt_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .gt("id", cursorId),
  ]);

  return {
    canUndo: (olderCount ?? 0) > 0,
    canRedo: (newerCount ?? 0) > 0,
  };
}
