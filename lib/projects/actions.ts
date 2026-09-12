"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";
import type { ProjectStatus } from "@/lib/supabase/types";
import { PROJECT_STATUSES } from "@/lib/projects/status";

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

function parseProgressPercent(value: FormDataEntryValue | null) {
  const num = Number(String(value ?? "0").trim());
  if (!Number.isFinite(num)) return 0;
  return Math.min(100, Math.max(0, Math.round(num)));
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
  const description = String(formData.get("description") ?? "").trim();
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

  const { error } = await supabase.from("projects").insert({
    project_name: projectName,
    location: location || null,
    description: description || null,
    start_date: parseOptionalDate(formData.get("startDate")),
    target_end_date: parseOptionalDate(formData.get("targetEndDate")),
    allocated_budget: parseOptionalNumber(formData.get("allocatedBudget")),
    selling_price: parseOptionalNumber(formData.get("sellingPrice")),
    project_manager_id: projectManagerId,
    foreman_id: foremanId,
    created_by: profile.id,
  });

  if (error) {
    console.error("[createProject] Supabase insert failed:", error);
    return { error: "Could not create project. Please try again." };
  }

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
  const description = String(formData.get("description") ?? "").trim();
  const projectManagerId = String(
    formData.get("projectManagerId") ?? ""
  ).trim();
  const foremanId = String(formData.get("foremanId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim() as ProjectStatus;

  if (!projectName) {
    return { error: "Project name is required." };
  }
  if (!projectManagerId) {
    return { error: "Select a Project Manager." };
  }
  if (!foremanId) {
    return { error: "Select a Foreman." };
  }
  if (!PROJECT_STATUSES.includes(status)) {
    return { error: "Select a valid status." };
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("projects")
    .update({
      project_name: projectName,
      location: location || null,
      description: description || null,
      status,
      start_date: parseOptionalDate(formData.get("startDate")),
      target_end_date: parseOptionalDate(formData.get("targetEndDate")),
      actual_end_date: parseOptionalDate(formData.get("actualEndDate")),
      allocated_budget: parseOptionalNumber(formData.get("allocatedBudget")),
      selling_price: parseOptionalNumber(formData.get("sellingPrice")),
      estimated_cost: parseOptionalNumber(formData.get("estimatedCost")),
      actual_expense: parseOptionalNumber(formData.get("actualExpense")),
      progress_percent: parseProgressPercent(formData.get("progressPercent")),
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
