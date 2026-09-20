"use server";

import { revalidatePath } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";

export type WorkerActionState = {
  error?: string;
  success?: boolean;
};

// Same logging/auth conventions as lib/cost-estimate/actions.ts (this
// feature's own closest sibling — the Manpower roster and its per-task
// assignments both hang off estimate_tasks) — kept as its own copy
// rather than a shared import, matching how every other actions.ts file
// in this app defines these locally too.
function logSupabaseError(label: string, error: PostgrestError) {
  console.error(label, {
    message: error.message,
    code: error.code,
    details: error.details,
    hint: error.hint,
  });
}

async function safely(
  run: () => Promise<WorkerActionState>
): Promise<WorkerActionState> {
  try {
    return await run();
  } catch (error) {
    console.error("[workers] Unexpected error:", error);
    return { error: "Something went wrong. Please try again." };
  }
}

async function requireAdmin() {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") return null;
  return profile;
}

export async function createWorker(
  projectId: number,
  _prevState: WorkerActionState,
  formData: FormData
): Promise<WorkerActionState> {
  return safely(async () => {
    const profile = await requireAdmin();
    if (!profile) {
      return { error: "You are not authorized to manage the manpower roster." };
    }

    const fullName = String(formData.get("fullName") ?? "").trim();
    if (!fullName) {
      return { error: "Name is required." };
    }
    const trade = String(formData.get("trade") ?? "").trim();

    const supabase = await createClient();
    const { error } = await supabase.from("workers").insert({
      project_id: projectId,
      full_name: fullName,
      trade: trade || null,
      created_by: profile.id,
    });

    if (error) {
      logSupabaseError("[createWorker] Supabase insert failed", error);
      return { error: "Could not add worker. Please try again." };
    }

    revalidatePath(`/admin/projects/${projectId}`);
    return { success: true };
  });
}

export async function updateWorker(
  workerId: number,
  projectId: number,
  _prevState: WorkerActionState,
  formData: FormData
): Promise<WorkerActionState> {
  return safely(async () => {
    const profile = await requireAdmin();
    if (!profile) {
      return { error: "You are not authorized to manage the manpower roster." };
    }

    const fullName = String(formData.get("fullName") ?? "").trim();
    if (!fullName) {
      return { error: "Name is required." };
    }
    const trade = String(formData.get("trade") ?? "").trim();

    const supabase = await createClient();
    const { error } = await supabase
      .from("workers")
      .update({ full_name: fullName, trade: trade || null })
      .eq("id", workerId)
      .eq("project_id", projectId);

    if (error) {
      logSupabaseError("[updateWorker] Supabase update failed", error);
      return { error: "Could not save changes. Please try again." };
    }

    revalidatePath(`/admin/projects/${projectId}`);
    return { success: true };
  });
}

export async function deleteWorker(
  workerId: number,
  projectId: number,
  _prevState: WorkerActionState,
  _formData: FormData
): Promise<WorkerActionState> {
  return safely(async () => {
    const profile = await requireAdmin();
    if (!profile) {
      return { error: "You are not authorized to manage the manpower roster." };
    }

    const supabase = await createClient();
    // task_worker_assignments.worker_id -> workers(id) on delete cascade
    // — removing a worker from the roster also removes them from
    // whatever tasks they were assigned to, deliberately (there's no
    // "orphaned assignment" state to reconcile).
    const { error } = await supabase
      .from("workers")
      .delete()
      .eq("id", workerId)
      .eq("project_id", projectId);

    if (error) {
      logSupabaseError("[deleteWorker] Supabase delete failed", error);
      return { error: "Could not remove worker. Please try again." };
    }

    revalidatePath(`/admin/projects/${projectId}`);
    return { success: true };
  });
}

/**
 * Replaces one task's entire set of assigned workers wholesale — same
 * "delete all for this id, reinsert the new set" convention
 * updateSubtask already uses for its own material/labor assignment rows
 * (lib/cost-estimate/actions.ts) — simpler than diffing individual
 * check/uncheck clicks from the assign picker, and nothing else
 * references a task_worker_assignments row by its own id.
 */
export async function setTaskWorkers(
  taskId: number,
  projectId: number,
  workerIds: number[]
): Promise<WorkerActionState> {
  return safely(async () => {
    const profile = await requireAdmin();
    if (!profile) {
      return { error: "You are not authorized to manage task assignments." };
    }

    const supabase = await createClient();

    const { error: deleteError } = await supabase
      .from("task_worker_assignments")
      .delete()
      .eq("task_id", taskId);

    if (deleteError) {
      logSupabaseError(
        "[setTaskWorkers] Supabase delete failed",
        deleteError
      );
      return { error: "Could not save assignment. Please try again." };
    }

    if (workerIds.length > 0) {
      const { error: insertError } = await supabase
        .from("task_worker_assignments")
        .insert(workerIds.map((workerId) => ({ task_id: taskId, worker_id: workerId })));

      if (insertError) {
        logSupabaseError(
          "[setTaskWorkers] Supabase insert failed",
          insertError
        );
        return { error: "Could not save assignment. Please try again." };
      }
    }

    revalidatePath(`/admin/projects/${projectId}`);
    return { success: true };
  });
}
