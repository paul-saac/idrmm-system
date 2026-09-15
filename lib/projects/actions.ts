"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";
import { seedDefaultSurveyQuestions } from "@/lib/daily-logs/actions";

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

export async function createProject(
  _prevState: ProjectActionState,
  formData: FormData
): Promise<ProjectActionState> {
  const profile = await getSessionProfile();

  if (!profile || profile.role !== "admin") {
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

  revalidatePath("/admin/projects");
  return { success: true };
}

export async function updateProject(
  projectId: number,
  _prevState: ProjectActionState,
  formData: FormData
): Promise<ProjectActionState> {
  const profile = await getSessionProfile();

  if (!profile || profile.role !== "admin") {
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

  // status is deliberately not editable here — it's kept in sync with
  // actual logged progress by lib/projects/status.ts's
  // deriveProjectStatusFromProgress, called from lib/daily-logs/
  // actions.ts whenever progress can change (approving a daily log,
  // resolving a work_item flag).
  const { error } = await supabase
    .from("projects")
    .update({
      project_name: projectName,
      location: location || null,
      start_date: parseOptionalDate(formData.get("startDate")),
      target_end_date: parseOptionalDate(formData.get("targetEndDate")),
      actual_end_date: parseOptionalDate(formData.get("actualEndDate")),
      allocated_budget: parseOptionalNumber(formData.get("allocatedBudget")),
      project_manager_id: projectManagerId,
      foreman_id: foremanId,
    })
    .eq("id", projectId);

  if (error) {
    console.error("[updateProject] Supabase update failed:", error);
    return { error: "Could not save changes. Please try again." };
  }

  revalidatePath("/admin/projects");
  revalidatePath(`/admin/projects/${projectId}`);
  return { success: true };
}

export async function deleteProject(
  projectId: number,
  _prevState: ProjectActionState,
  _formData: FormData
): Promise<ProjectActionState> {
  const profile = await getSessionProfile();

  if (!profile || profile.role !== "admin") {
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

  revalidatePath("/admin/projects");
  redirect("/admin/projects");
}
