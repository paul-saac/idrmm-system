"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";
import { nextMaterialCode } from "@/lib/materials/codes";
import type { MaterialStatus } from "@/lib/materials/data";

export type MaterialActionState = {
  error?: string;
  success?: boolean;
};

function parseNumber(value: FormDataEntryValue | null) {
  const num = Number(String(value ?? "0").trim());
  return Number.isFinite(num) ? num : 0;
}

function parseStatus(value: FormDataEntryValue | null): MaterialStatus {
  const status = String(value ?? "").trim();
  return status === "low_stock" || status === "fully_consumed"
    ? status
    : "available";
}

function readMaterialFields(formData: FormData) {
  return {
    materialName: String(formData.get("materialName") ?? "").trim(),
    specification: String(formData.get("specification") ?? "").trim(),
    quantity: parseNumber(formData.get("quantity")),
    unit: String(formData.get("unit") ?? "").trim(),
    status: parseStatus(formData.get("status")),
  };
}

export async function createProjectMaterial(
  projectId: number,
  _prevState: MaterialActionState,
  formData: FormData
): Promise<MaterialActionState> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
    return { error: "You are not authorized to add materials." };
  }

  const fields = readMaterialFields(formData);
  if (!fields.materialName) {
    return { error: "Material Name is required." };
  }

  const supabase = await createClient();
  const materialCode = await nextMaterialCode(supabase, projectId);

  const { error } = await supabase.from("project_materials").insert({
    project_id: projectId,
    material_code: materialCode,
    material_name: fields.materialName,
    specification: fields.specification || null,
    quantity: fields.quantity,
    unit: fields.unit || null,
    status: fields.status,
    recorded_by: profile.id,
  });

  if (error) {
    console.error("[createProjectMaterial] Supabase insert failed:", error.message);
    return { error: "Could not add the material. Please try again." };
  }

  revalidatePath(`/admin/projects/${projectId}`);
  return { success: true };
}

export async function updateProjectMaterial(
  materialId: number,
  projectId: number,
  _prevState: MaterialActionState,
  formData: FormData
): Promise<MaterialActionState> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
    return { error: "You are not authorized to edit materials." };
  }

  const fields = readMaterialFields(formData);
  if (!fields.materialName) {
    return { error: "Material Name is required." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("project_materials")
    .update({
      material_name: fields.materialName,
      specification: fields.specification || null,
      quantity: fields.quantity,
      unit: fields.unit || null,
      status: fields.status,
    })
    .eq("id", materialId);

  if (error) {
    console.error("[updateProjectMaterial] Supabase update failed:", error.message);
    return { error: "Could not update the material. Please try again." };
  }

  revalidatePath(`/admin/projects/${projectId}`);
  return { success: true };
}

export async function deleteProjectMaterial(
  materialId: number,
  projectId: number,
  _prevState: MaterialActionState,
  _formData: FormData
): Promise<MaterialActionState> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
    return { error: "You are not authorized to delete materials." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("project_materials")
    .delete()
    .eq("id", materialId);

  if (error) {
    console.error("[deleteProjectMaterial] Supabase delete failed:", error.message);
    return { error: "Could not delete the material. Please try again." };
  }

  revalidatePath(`/admin/projects/${projectId}`);
  return { success: true };
}
