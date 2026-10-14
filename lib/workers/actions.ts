"use server";

import { revalidatePath } from "next/cache";
import { revalidateProjectPaths } from "@/lib/projects/revalidate";
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireProjectAccess } from "@/lib/auth/project-access";
import { getSessionProfile } from "@/lib/auth/session";
import { isMemberCategory } from "@/lib/workers/presets";
import { isAdminRole } from "@/lib/auth/roles";

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

// A member's own fields from the Team page's form — First/Last Name are
// stored as one full_name, Title as trade. An error message instead when
// something can't be saved as typed.
function readMemberFields(formData: FormData) {
  const text = (key: string) => String(formData.get(key) ?? "").trim();
  const fullName = [text("firstName"), text("lastName")].filter(Boolean).join(" ");
  if (!fullName) return { error: "Name is required." };
  const contactNumber = text("contactNumber");
  if (contactNumber && !/^[0-9+()\-\s]{7,20}$/.test(contactNumber)) {
    return { error: "Enter a valid contact number." };
  }
  const dateHired = text("dateHired");
  if (dateHired && !/^\d{4}-\d{2}-\d{2}$/.test(dateHired)) {
    return { error: "Enter a valid date hired." };
  }
  const category = text("category");
  if (!isMemberCategory(category)) return { error: "Pick a category." };
  const subcontractor = text("employmentType") === "subcontractor";
  const company = text("subcontractorCompany");
  if (subcontractor && !company) return { error: "Enter the subcontractor's company." };
  return {
    fields: {
      full_name: fullName,
      trade: text("title") || null,
      contact_number: contactNumber || null,
      date_hired: dateHired || null,
      category,
      employment_type: subcontractor ? ("subcontractor" as const) : ("employee" as const),
      subcontractor_company: subcontractor ? company : null,
      profile_id: text("profileId") || null,
    },
  };
}

// The one login account per member rule (0063's unique index).
function linkConflict(error: PostgrestError) {
  return error.code === "23505" && error.message.includes("profile_id");
}

// The Team itself is the admin's to manage (its own page); foremen only
// assign members to tasks on their projects.
async function requireAdmin() {
  const profile = await getSessionProfile();
  return profile && isAdminRole(profile.role) ? profile : null;
}

// A member's name shows on every project's Gantt chart (both portals),
// and their availability on the Team page.
function revalidateTeam() {
  revalidatePath("/admin", "layout");
  revalidatePath("/foreman", "layout");
}

export async function createWorker(
  _prevState: WorkerActionState,
  formData: FormData
): Promise<WorkerActionState> {
  return safely(async () => {
    const profile = await requireAdmin();
    if (!profile) {
      return { error: "You are not authorized to manage the team." };
    }

    const member = readMemberFields(formData);
    if (!member.fields) {
      return { error: member.error };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("workers")
      .insert({ ...member.fields, created_by: profile.id });

    if (error) {
      logSupabaseError("[createWorker] Supabase insert failed", error);
      if (linkConflict(error)) {
        return { error: "That login account is already linked to another team member." };
      }
      return { error: "Could not add the member. Please try again." };
    }

    revalidateTeam();
    return { success: true };
  });
}

export async function updateWorker(
  workerId: number,
  _prevState: WorkerActionState,
  formData: FormData
): Promise<WorkerActionState> {
  return safely(async () => {
    const profile = await requireAdmin();
    if (!profile) {
      return { error: "You are not authorized to manage the team." };
    }

    const member = readMemberFields(formData);
    if (!member.fields) {
      return { error: member.error };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("workers")
      .update(member.fields)
      .eq("id", workerId);

    if (error) {
      logSupabaseError("[updateWorker] Supabase update failed", error);
      if (linkConflict(error)) {
        return { error: "That login account is already linked to another team member." };
      }
      return { error: "Could not save changes. Please try again." };
    }

    revalidateTeam();
    return { success: true };
  });
}

/** Removes one member or several (the Team table's checked rows). */
export async function deleteWorkers(workerIds: number[]): Promise<WorkerActionState> {
  return safely(async () => {
    const profile = await requireAdmin();
    if (!profile) {
      return { error: "You are not authorized to manage the team." };
    }

    const ids = Array.isArray(workerIds)
      ? workerIds.filter((id) => Number.isInteger(id) && id > 0)
      : [];
    if (ids.length === 0) {
      return { error: "Select at least one member." };
    }

    const supabase = await createClient();

    // Someone with a login account (a project manager or foreman) is
    // managed in Accounts, never removed from the Team here. "*" so this
    // still reads before 0063 has added profile_id.
    const { data: rows } = await supabase.from("workers").select("*").in("id", ids);
    if ((rows ?? []).some((row) => row.profile_id)) {
      return {
        error: "Project managers and foremen are managed in Accounts — they can't be removed here.",
      };
    }

    // task/category_worker_assignments.worker_id -> workers(id) on delete
    // cascade — removing a member also takes them off every task and
    // phase they were on, deliberately (no orphaned assignment to clean).
    const { error } = await supabase.from("workers").delete().in("id", ids);

    if (error) {
      logSupabaseError("[deleteWorkers] Supabase delete failed", error);
      return {
        error: `Could not remove the member${ids.length === 1 ? "" : "s"}. Please try again.`,
      };
    }

    revalidateTeam();
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
    const profile = await requireProjectAccess(projectId);
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

    revalidateProjectPaths(projectId);
    revalidatePath("/admin/team");
    return { success: true };
  });
}

/**
 * Same idea as setTaskWorkers above, one level up — a category's own
 * assigned workers (see CategoryWorkerAssignments's own doc comment).
 */
export async function setCategoryWorkers(
  categoryId: number,
  projectId: number,
  workerIds: number[]
): Promise<WorkerActionState> {
  return safely(async () => {
    const profile = await requireProjectAccess(projectId);
    if (!profile) {
      return { error: "You are not authorized to manage task assignments." };
    }

    const supabase = await createClient();

    const { error: deleteError } = await supabase
      .from("category_worker_assignments")
      .delete()
      .eq("category_id", categoryId);

    if (deleteError) {
      logSupabaseError(
        "[setCategoryWorkers] Supabase delete failed",
        deleteError
      );
      return { error: "Could not save assignment. Please try again." };
    }

    if (workerIds.length > 0) {
      const { error: insertError } = await supabase
        .from("category_worker_assignments")
        .insert(
          workerIds.map((workerId) => ({
            category_id: categoryId,
            worker_id: workerId,
          }))
        );

      if (insertError) {
        logSupabaseError(
          "[setCategoryWorkers] Supabase insert failed",
          insertError
        );
        return { error: "Could not save assignment. Please try again." };
      }
    }

    revalidateProjectPaths(projectId);
    revalidatePath("/admin/team");
    return { success: true };
  });
}
