import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * A raw estimate_categories/estimate_tasks/child-table row, captured via
 * `select("*")` — deliberately NOT typed against this app's own mapped
 * CostCategory/CostTask shapes (lib/cost-estimate/data.ts), which coalesce
 * and transform fields (null->0, invalid priority->"medium", ...) in ways
 * that would lose fidelity on restore. A snapshot has to round-trip back
 * into the DB byte-for-byte, so it stays at the raw-column level, and
 * loosely typed (Supabase's own generated Row types are a hand-maintained
 * subset — see lib/supabase/types.ts's own comment — not a perfect mirror
 * of every column, so trying to force a stricter type here would just be
 * fighting that gap, not adding real safety).
 */
type RawRow = Record<string, unknown> & { id: number };

export type GanttSnapshot = {
  categories: RawRow[];
  tasks: RawRow[];
  otherCosts: RawRow[];
  materialAssignments: RawRow[];
  laborAssignments: RawRow[];
};

/**
 * Every checkpoint recorded for a project beyond this many (oldest first)
 * is trimmed on the next write — keeps gantt_snapshots from growing
 * unbounded. 50 undo/redo steps is already generous for a single Gantt
 * editing session; this app has no "browse full history" UI, just
 * Undo/Redo one step at a time.
 */
const MAX_GANTT_HISTORY_PER_PROJECT = 50;

/**
 * Captures the full current state of a project's schedule/cost data —
 * every estimate_categories/estimate_tasks row plus their 3 child tables
 * — as one JSON-serializable snapshot. Used both to record a checkpoint
 * after a mutation and, inside restoreGanttSnapshot, to diff against the
 * checkpoint being restored to.
 */
export async function captureGanttSnapshot(
  supabase: SupabaseClient,
  projectId: number
): Promise<GanttSnapshot> {
  const [{ data: categories }, { data: tasks }] = await Promise.all([
    supabase.from("estimate_categories").select("*").eq("project_id", projectId),
    supabase.from("estimate_tasks").select("*").eq("project_id", projectId),
  ]);

  const taskIds = (tasks ?? []).map((row) => row.id);

  const [{ data: otherCosts }, { data: materialAssignments }, { data: laborAssignments }] =
    taskIds.length > 0
      ? await Promise.all([
          supabase.from("estimate_task_other_costs").select("*").in("task_id", taskIds),
          supabase
            .from("estimate_task_material_assignments")
            .select("*")
            .in("task_id", taskIds),
          supabase.from("estimate_task_labor_assignments").select("*").in("task_id", taskIds),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }];

  return {
    categories: (categories ?? []) as unknown as RawRow[],
    tasks: (tasks ?? []) as unknown as RawRow[],
    otherCosts: (otherCosts ?? []) as unknown as RawRow[],
    materialAssignments: (materialAssignments ?? []) as unknown as RawRow[],
    laborAssignments: (laborAssignments ?? []) as unknown as RawRow[],
  };
}

/**
 * Call this at the end of every mutating action in actions.ts, right
 * before its success `return` (including a "partial failure" path that
 * still left some rows committed — see e.g. createTask, which can fail
 * to save its material/labor assignments after the task row itself
 * already saved; that's a real DB-state change too, and belongs in the
 * history the same as a full success would).
 *
 * Deliberately best-effort: undo/redo history is a safety net on top of
 * the action the user actually asked for, not the thing itself — a
 * failure recording a checkpoint is logged and swallowed here rather
 * than turned into an error the caller has to handle, so it can never
 * make an otherwise-successful edit look like it failed.
 *
 * No "baseline" snapshot of the state before a project's very first
 * tracked edit — the first checkpoint recorded for a project simply
 * isn't itself undoable (nothing earlier to compare it to). Accepted
 * trade-off for keeping every one of the 10 call sites a single line
 * with no other change to that action's own control flow.
 */
export async function recordGanttCheckpoint(
  supabase: SupabaseClient,
  projectId: number,
  userId: string
): Promise<void> {
  try {
    const snapshot = await captureGanttSnapshot(supabase, projectId);

    const { data: project } = await supabase
      .from("projects")
      .select("gantt_undo_cursor_id")
      .eq("id", projectId)
      .single();
    const cursorId = project?.gantt_undo_cursor_id ?? null;

    // A fresh edit invalidates any "redo" entries left over from an
    // earlier undo (the usual "a new action clears the redo stack"
    // rule). When cursorId is null there's nothing after "nothing" to
    // keep either way, so clearing everything for this project is still
    // correct (and cheap insurance against an inconsistent state).
    if (cursorId === null) {
      await supabase.from("gantt_snapshots").delete().eq("project_id", projectId);
    } else {
      await supabase
        .from("gantt_snapshots")
        .delete()
        .eq("project_id", projectId)
        .gt("id", cursorId);
    }

    const { data: inserted, error } = await supabase
      .from("gantt_snapshots")
      .insert({
        project_id: projectId,
        snapshot: snapshot as never,
        created_by: userId,
      })
      .select("id")
      .single();

    if (error || !inserted) {
      console.error("[recordGanttCheckpoint] insert failed", error);
      return;
    }

    const { data: excess } = await supabase
      .from("gantt_snapshots")
      .select("id")
      .eq("project_id", projectId)
      .order("id", { ascending: false })
      .range(MAX_GANTT_HISTORY_PER_PROJECT, MAX_GANTT_HISTORY_PER_PROJECT + 9999);
    if (excess && excess.length > 0) {
      await supabase
        .from("gantt_snapshots")
        .delete()
        .in("id", excess.map((row) => row.id));
    }

    await supabase
      .from("projects")
      .update({ gantt_undo_cursor_id: inserted.id })
      .eq("id", projectId);
  } catch (error) {
    console.error("[recordGanttCheckpoint] unexpected error", error);
  }
}

function diffRows(current: RawRow[], target: RawRow[]) {
  const targetIds = new Set(target.map((row) => row.id));
  const currentIds = new Set(current.map((row) => row.id));
  return {
    toDeleteIds: current.filter((row) => !targetIds.has(row.id)).map((row) => row.id),
    toInsert: target.filter((row) => !currentIds.has(row.id)),
    toUpdate: target.filter((row) => currentIds.has(row.id)),
  };
}

/**
 * Reconciles the live DB to exactly match `snapshot` — the one generic
 * restore function shared by both undo and redo (they only differ in
 * which snapshot they pass in). Correct by construction: whatever isn't
 * in the snapshot gets deleted, whatever's missing gets (re-)inserted
 * with its *original* id (see 0037_gantt_undo_redo.sql's own comment for
 * why that's possible now), whatever's common gets updated to match.
 *
 * Order matters for FK integrity: tasks before categories on delete
 * (leaf-most first); categories before tasks on insert/update (a task's
 * category_id must already exist); tasks themselves in two passes so
 * predecessor_task_id is never set before every task row exists to be
 * pointed at.
 */
export async function restoreGanttSnapshot(
  supabase: SupabaseClient,
  projectId: number,
  snapshot: GanttSnapshot
): Promise<void> {
  const current = await captureGanttSnapshot(supabase, projectId);

  const tasksDiff = diffRows(current.tasks, snapshot.tasks);
  if (tasksDiff.toDeleteIds.length > 0) {
    await supabase.from("estimate_tasks").delete().in("id", tasksDiff.toDeleteIds);
  }

  // A category is deleted here before any task's own category_id is
  // updated below (that happens later, in the task upsert passes) —
  // safe only because deleteCategory (actions.ts) already refuses to
  // delete a category that still has any task rows, and no single
  // action ever both deletes a category *and* reassigns a task away
  // from it (that's two separate actions, hence two separate adjacent
  // checkpoints, and undo/redo here only ever moves one checkpoint at a
  // time). If that ever changes — e.g. a bulk "delete phase and move its
  // tasks elsewhere" action — this ordering would need to move the task
  // reassignment before this delete, or the FK's ON DELETE CASCADE would
  // take a still-wanted, merely-reassigned task down with it.
  const categoriesDiff = diffRows(current.categories, snapshot.categories);
  if (categoriesDiff.toDeleteIds.length > 0) {
    await supabase.from("estimate_categories").delete().in("id", categoriesDiff.toDeleteIds);
  }

  for (const category of categoriesDiff.toInsert) {
    await supabase.from("estimate_categories").insert(category as never);
  }
  for (const category of categoriesDiff.toUpdate) {
    const { id, ...rest } = category;
    await supabase.from("estimate_categories").update(rest as never).eq("id", id);
  }

  // Pass 1: every task row, predecessor_task_id forced null so no
  // insert/update can reference a task id that doesn't exist yet.
  for (const task of tasksDiff.toInsert) {
    await supabase
      .from("estimate_tasks")
      .insert({ ...task, predecessor_task_id: null } as never);
  }
  for (const task of tasksDiff.toUpdate) {
    const { id, ...rest } = task;
    await supabase
      .from("estimate_tasks")
      .update({ ...rest, predecessor_task_id: null } as never)
      .eq("id", id);
  }
  // Pass 2: now that every task in the snapshot exists as a row, set the
  // real predecessor links.
  for (const task of snapshot.tasks) {
    if (task.predecessor_task_id !== null && task.predecessor_task_id !== undefined) {
      await supabase
        .from("estimate_tasks")
        .update({ predecessor_task_id: task.predecessor_task_id } as never)
        .eq("id", task.id);
    }
  }

  for (const [table, currentRows, targetRows] of [
    ["estimate_task_other_costs", current.otherCosts, snapshot.otherCosts],
    [
      "estimate_task_material_assignments",
      current.materialAssignments,
      snapshot.materialAssignments,
    ],
    ["estimate_task_labor_assignments", current.laborAssignments, snapshot.laborAssignments],
  ] as const) {
    const diff = diffRows(currentRows, targetRows);
    if (diff.toDeleteIds.length > 0) {
      await supabase.from(table).delete().in("id", diff.toDeleteIds);
    }
    for (const row of diff.toInsert) {
      await supabase.from(table).insert(row as never);
    }
    for (const row of diff.toUpdate) {
      const { id, ...rest } = row;
      await supabase.from(table).update(rest as never).eq("id", id);
    }
  }
}

/**
 * Read-only: whether there's a checkpoint before/after the project's
 * current cursor position — drives the Undo/Redo buttons' disabled
 * state. Called alongside this project's other data fetches (see
 * app/admin/projects/[id]/page.tsx), so it refreshes for free through
 * the same revalidatePath/router.refresh() flow every other Gantt
 * mutation already relies on.
 */
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
