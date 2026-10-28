"use server";

import { revalidateProjectLists, revalidateProjectPaths } from "@/lib/projects/revalidate";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";
import { requireProjectAccess } from "@/lib/auth/project-access";
import { seedDefaultSurveyQuestions } from "@/lib/daily-logs/actions";
import { isAdminRole } from "@/lib/auth/roles";
import { getCostEstimate } from "@/lib/cost-estimate/data";
import { deriveProjectStatusFromProgress } from "./status";

export type ProjectActionState = {
  error?: string;
  success?: boolean;
};

function parseOptionalNumber(value: FormDataEntryValue | null) {
  const str = String(value ?? "").trim();
  if (!str) return null;
  const num = Number(str);
  return Number.isFinite(num) ? num : null;
}

function parseOptionalDate(value: FormDataEntryValue | null) {
  const str = String(value ?? "").trim();
  return str || null;
}

/** Reads the Edit Project form's own working-day checkboxes (ISO
 * weekday numbers, 1=Monday..7=Sunday) — see 0040_task_progress_
 * tracking.sql. An empty selection is allowed (a project with no
 * working days simply never advances Automatic Progress Completion on
 * its own, still correctable via a Progress Tracking Override), not
 * silently forced back to a default. */
function parseWorkingDays(formData: FormData): number[] {
  return formData
    .getAll("workingDays")
    .map((value) => Number(value))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
}

/**
 * A project manager or foreman is only ever on one project at a time —
 * the error for whichever of `people` already runs another project
 * (other than `projectId`, the one being saved) that isn't completed,
 * else null. lib/accounts/availability.ts holds the same rule in the
 * forms.
 */
async function assignmentClash(
  supabase: Awaited<ReturnType<typeof createClient>>,
  people: { id: string; role: string }[],
  projectId?: number
): Promise<string | null> {
  if (people.length === 0) return null;
  const { data, error } = await supabase
    .from("projects")
    .select("id, project_name, project_manager_id, foreman_id")
    .neq("status", "completed");
  if (error) {
    console.error("[assignmentClash] Supabase read failed:", error);
    return "Could not check who's free. Please try again.";
  }
  for (const person of people) {
    const clash = (data ?? []).find(
      (row) =>
        row.id !== projectId &&
        (row.project_manager_id === person.id || row.foreman_id === person.id)
    );
    if (clash) {
      return `That ${person.role} is already on ${clash.project_name} — they can be assigned to another project once it's completed.`;
    }
  }
  return null;
}

/** Prevents a crafted form submission from assigning an inactive account,
 * a pending invitation, or an account with the wrong project role. */
async function validateProjectLeads(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectManagerId: string,
  foremanId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, status, invitation_pending")
    .in("id", [projectManagerId, foremanId]);

  if (error) {
    console.error("[validateProjectLeads] Supabase read failed:", error);
    return "Could not verify the selected project team. Please try again.";
  }

  const projectManager = data?.find((account) => account.id === projectManagerId);
  const foreman = data?.find((account) => account.id === foremanId);
  const isEligible = (account: typeof projectManager, role: "project_manager" | "foreman") =>
    account?.role === role && account.status === "active" && !account.invitation_pending;

  if (!isEligible(projectManager, "project_manager")) {
    return "Select an active Project Manager who has accepted their invitation.";
  }
  if (!isEligible(foreman, "foreman")) {
    return "Select an active Foreman who has accepted their invitation.";
  }
  return null;
}

export async function createProject(
  _prevState: ProjectActionState,
  formData: FormData
): Promise<ProjectActionState> {
  const profile = await getSessionProfile();

  if (!profile || !isAdminRole(profile.role)) {
    return { error: "You are not authorized to create projects." };
  }

  const projectName = String(formData.get("projectName") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const projectManagerId = String(formData.get("projectManagerId") ?? "").trim();
  const foremanId = String(formData.get("foremanId") ?? "").trim();

  if (!projectName) {
    return { error: "Project name is required." };
  }
  if (!projectManagerId) {
    return { error: "Select a Project Manager." };
  }
  if (!foremanId) {
    return { error: "Select a Foreman." };
  }

  const supabase = await createClient();

  const leadError = await validateProjectLeads(supabase, projectManagerId, foremanId);
  if (leadError) {
    return { error: leadError };
  }

  const clash = await assignmentClash(supabase, [
    { id: projectManagerId, role: "Project Manager" },
    { id: foremanId, role: "Foreman" },
  ]);
  if (clash) {
    return { error: clash };
  }

  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      project_name: projectName,
      location: location || null,
      start_date: parseOptionalDate(formData.get("startDate")),
      target_end_date: parseOptionalDate(formData.get("targetEndDate")),
      allocated_budget: parseOptionalNumber(formData.get("allocatedBudget")),
      project_manager_id: projectManagerId,
      foreman_id: foremanId,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error || !project) {
    console.error("[createProject] Supabase insert failed:", error);
    return { error: "Could not create project. Please try again." };
  }

  // Every project starts with the same three Survey questions Daily
  // Logs have always asked — an admin can rename/reorder/delete them
  // afterward via the Survey Questions settings modal like any other
  // question (see seedDefaultSurveyQuestions's own doc comment).
  await seedDefaultSurveyQuestions(supabase, project.id);

  revalidateProjectLists();
  return { success: true };
}

export async function updateProject(
  projectId: number,
  _prevState: ProjectActionState,
  formData: FormData
): Promise<ProjectActionState> {
  const profile = await getSessionProfile();

  if (!profile || !isAdminRole(profile.role)) {
    return { error: "You are not authorized to edit projects." };
  }

  const projectName = String(formData.get("projectName") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const projectManagerId = String(
    formData.get("projectManagerId") ?? ""
  ).trim();
  const foremanId = String(formData.get("foremanId") ?? "").trim();

  if (!projectName) {
    return { error: "Project name is required." };
  }
  if (!projectManagerId) {
    return { error: "Select a Project Manager." };
  }
  if (!foremanId) {
    return { error: "Select a Foreman." };
  }

  const supabase = await createClient();

  // Only someone newly picked is checked — whoever's already on this
  // project stays on it, even if (from before this rule) they're on
  // another one too.
  const { data: current } = await supabase
    .from("projects")
    .select("project_manager_id, foreman_id")
    .eq("id", projectId)
    .single();
  const clash = await assignmentClash(
    supabase,
    [
      ...(current?.project_manager_id !== projectManagerId
        ? [{ id: projectManagerId, role: "Project Manager" }]
        : []),
      ...(current?.foreman_id !== foremanId ? [{ id: foremanId, role: "Foreman" }] : []),
    ],
    projectId
  );
  if (clash) {
    return { error: clash };
  }

  const confirmed = formData.get("confirmCompletion") === "on";
  const actualEndDate = confirmed ? parseOptionalDate(formData.get("actualEndDate")) : null;
  let lifecycle;
  try {
    lifecycle = (await getCostEstimate(projectId, true)).lifecycle;
  } catch {
    return { error: "Could not verify saved progress. Please try again." };
  }
  if (confirmed) {
    if (!lifecycle.allItemsComplete) {
      return { error: "Every task and standalone phase must be 100% complete from saved logs before confirming completion." };
    }
    const parsed = actualEndDate ? new Date(`${actualEndDate}T00:00:00Z`) : null;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    if (!actualEndDate || !/^\d{4}-\d{2}-\d{2}$/.test(actualEndDate) || !parsed ||
      Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== actualEndDate || actualEndDate > today) {
      return { error: "Enter a valid actual end date that is today or earlier." };
    }
    const startDate = parseOptionalDate(formData.get("startDate"));
    if (startDate && actualEndDate < startDate) {
      return { error: "Actual end date cannot be before the project start date." };
    }
  }
  const status = deriveProjectStatusFromProgress(lifecycle, actualEndDate);
  const { error } = await supabase
    .from("projects")
    .update({
      project_name: projectName,
      location: location || null,
      start_date: parseOptionalDate(formData.get("startDate")),
      target_end_date: parseOptionalDate(formData.get("targetEndDate")),
      actual_end_date: actualEndDate,
      status,
      allocated_budget: parseOptionalNumber(formData.get("allocatedBudget")),
      project_manager_id: projectManagerId,
      foreman_id: foremanId,
      working_days: parseWorkingDays(formData),
    })
    .eq("id", projectId);

  if (error) {
    console.error("[updateProject] Supabase update failed:", error);
    return { error: "Could not save changes. Please try again." };
  }

  revalidateProjectLists();
  revalidateProjectPaths(projectId);
  return { success: true };
}

/**
 * Its own dedicated action rather than a field in updateProject's form —
 * this used to be a field on the Add/Edit Project forms, moved into the
 * Labor Breakdown modal instead (see LaborBreakdownModalContent) so it
 * sits next to the labor costs it actually informs. A single-field
 * update, not routed through updateProject, since that action overwrites
 * every field from a full form submit — calling it from a modal that
 * only ever has this one value in scope would null out the rest.
 */
export async function updateProjectDefaultLaborCostPercent(
  projectId: number,
  percent: number | null
): Promise<ProjectActionState> {
  const profile = await requireProjectAccess(projectId);

  if (!profile) {
    return { error: "You are not authorized to edit this project's labor rate." };
  }

  if (percent != null && (!Number.isFinite(percent) || percent < 0 || percent > 100)) {
    return { error: "Enter a percentage between 0 and 100." };
  }

  // Through a column-scoped database function rather than a direct
  // update, so a foreman can set this without write access to the rest of
  // the project row — see 0051_foreman_project_access.sql.
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_project_default_labor_cost_percent", {
    p_project_id: projectId,
    p_percent: percent,
  });

  if (error) {
    console.error(
      "[updateProjectDefaultLaborCostPercent] Supabase update failed:",
      error
    );
    return { error: "Could not save changes. Please try again." };
  }

  revalidateProjectPaths(projectId);
  return { success: true };
}

export async function deleteProject(
  projectId: number,
  _prevState: ProjectActionState,
  _formData: FormData
): Promise<ProjectActionState> {
  const profile = await getSessionProfile();

  if (!profile || !isAdminRole(profile.role)) {
    return { error: "You are not authorized to delete projects." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId);

  if (error) {
    console.error("[deleteProject] Supabase delete failed:", error);
    return { error: "Could not delete project. Please try again." };
  }

  revalidateProjectLists();
  redirect("/admin/projects");
}
