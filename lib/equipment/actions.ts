"use server";

import { revalidateInventory, revalidateProjectPaths } from "@/lib/projects/revalidate";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";
import { requireProjectAccess } from "@/lib/auth/project-access";
import type { EquipmentStatus } from "@/lib/equipment/data";
import { equipmentAllocationError } from "./allocation-error";
import type { EquipmentConflict } from "./tracking-types";
import { isAdminRole } from "@/lib/auth/roles";

export type EquipmentActionState = {
  error?: string;
  success?: boolean;
  conflict?: EquipmentConflict;
};

/** Assigns checked-out equipment to its first task or moves it between tasks.
 * The database function closes and opens the task periods atomically. */
export async function moveEquipmentToTask(
  assignmentId: number,
  projectId: number,
  _prevState: EquipmentActionState,
  formData: FormData
): Promise<EquipmentActionState> {
  const profile = await requireProjectAccess(projectId);
  if (!profile) return { error: "You are not authorized to assign this equipment." };

  const taskId = Number(formData.get("taskId"));
  const notes = String(formData.get("notes") ?? "").trim();
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return { error: "Select a task for this equipment." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("move_equipment_to_task", {
    p_equipment_assignment_id: assignmentId,
    p_project_id: projectId,
    p_task_id: taskId,
    p_notes: notes || null,
  });
  if (error) {
    console.error("[moveEquipmentToTask] Supabase rpc failed:", error.message);
    return { conflict: equipmentAllocationError(error), error: error.message.includes("already assigned") ? error.message : "Could not assign the equipment to that task." };
  }

  revalidateProjectPaths(projectId);
  return { success: true };
}

/**
 * Asset Tag is system-assigned, not typed in the Add Equipment form —
 * "EQ-001", "EQ-002", ... Based on the highest existing sequence number
 * rather than a plain row count, so a deleted item's tag never gets
 * reused by a later insert. Same convention as project_materials'
 * Material ID (see lib/materials/actions.ts).
 */
async function nextAssetTag(
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  const { data } = await supabase.from("equipment").select("asset_tag");

  let maxSeq = 0;
  for (const row of data ?? []) {
    const match = /^EQ-(\d+)$/.exec(row.asset_tag);
    if (match) {
      maxSeq = Math.max(maxSeq, Number(match[1]));
    }
  }
  return `EQ-${String(maxSeq + 1).padStart(3, "0")}`;
}

function readEquipmentFields(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    category: String(formData.get("category") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
    serialNumber: String(formData.get("serialNumber") ?? "").trim(),
  };
}

export async function createEquipment(
  _prevState: EquipmentActionState,
  formData: FormData
): Promise<EquipmentActionState> {
  const profile = await getSessionProfile();
  if (!profile || !isAdminRole(profile.role)) {
    return { error: "You are not authorized to add equipment." };
  }

  const fields = readEquipmentFields(formData);
  if (!fields.name) {
    return { error: "Equipment name is required." };
  }

  const supabase = await createClient();
  const assetTag = await nextAssetTag(supabase);

  const { error } = await supabase.from("equipment").insert({
    asset_tag: assetTag,
    name: fields.name,
    category: fields.category || null,
    description: fields.description || null,
    serial_number: fields.serialNumber || null,
    status: "available",
    created_by: profile.id,
  });

  if (error) {
    console.error("[createEquipment] Supabase insert failed:", error.message);
    return { error: "Could not add the equipment. Please try again." };
  }

  revalidateInventory();
  return { success: true };
}

export async function updateEquipment(
  equipmentId: number,
  _prevState: EquipmentActionState,
  formData: FormData
): Promise<EquipmentActionState> {
  const profile = await getSessionProfile();
  if (!profile || !isAdminRole(profile.role)) {
    return { error: "You are not authorized to edit equipment." };
  }

  const fields = readEquipmentFields(formData);
  if (!fields.name) {
    return { error: "Equipment name is required." };
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("equipment")
    .update({
      name: fields.name,
      category: fields.category || null,
      description: fields.description || null,
      ...(formData.has("serialNumber") ? { serial_number: fields.serialNumber || null } : {}),
    })
    .eq("id", equipmentId);

  if (error) {
    console.error("[updateEquipment] Supabase update failed:", error.message);
    return { error: "Could not update the equipment. Please try again." };
  }

  revalidateInventory();
  return { success: true };
}

export async function setEquipmentServiceStatus(
  equipmentId: number, expectedStatus: EquipmentStatus, status: "maintenance" | "available",
): Promise<EquipmentActionState> {
  const profile = await getSessionProfile();
  if (!profile || !isAdminRole(profile.role)) return { error: "You are not authorized to change equipment maintenance status." };
  if (!Number.isSafeInteger(equipmentId) || equipmentId <= 0 || !(
    (status === "maintenance" && (expectedStatus === "available" || expectedStatus === "assigned")) ||
    (status === "available" && expectedStatus === "maintenance")
  )) return { error: "Choose a valid equipment status change." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_equipment_service_status", {
    p_equipment_id: equipmentId, p_expected_status: expectedStatus, p_status: status,
  });
  if (error) return { error: error.code === "40001" ? "This equipment has changed. Refresh and try again."
    : error.code === "55000" ? "Saving is temporarily paused. Please try again later."
    : "Could not change equipment maintenance status. Please try again." };
  revalidateInventory();
  for (const projectId of data?.projectIds ?? []) revalidateProjectPaths(projectId);
  return { success: true };
}

export async function deleteEquipment(
  equipmentId: number,
  _prevState: EquipmentActionState,
  _formData: FormData
): Promise<EquipmentActionState> {
  const profile = await getSessionProfile();
  if (!profile || !isAdminRole(profile.role)) {
    return { error: "You are not authorized to delete equipment." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("equipment").delete().eq("id", equipmentId);

  if (error) {
    console.error("[deleteEquipment] Supabase delete failed:", error.message);
    return { error: "Could not delete the equipment. Please try again." };
  }

  revalidateInventory();
  return { success: true };
}

/** deleteEquipment for several items at once (the inventory table's
 * checked rows). */
export async function deleteEquipmentItems(
  equipmentIds: number[]
): Promise<EquipmentActionState> {
  const profile = await getSessionProfile();
  if (!profile || !isAdminRole(profile.role)) {
    return { error: "You are not authorized to delete equipment." };
  }

  const ids = Array.isArray(equipmentIds)
    ? equipmentIds.filter((id) => Number.isInteger(id) && id > 0)
    : [];
  if (ids.length === 0) {
    return { error: "Select at least one item." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("equipment").delete().in("id", ids);

  if (error) {
    console.error("[deleteEquipmentItems] Supabase delete failed:", error.message);
    return {
      error: `Could not delete the item${ids.length === 1 ? "" : "s"}. Please try again.`,
    };
  }

  revalidateInventory();
  return { success: true };
}

/**
 * Checks equipment out to a project — this is the assignment the
 * project's Equipment tab reflects (listProjectEquipment filters by
 * current_project_id, set here).
 */
export async function assignEquipment(
  equipmentId: number,
  _prevState: EquipmentActionState,
  formData: FormData
): Promise<EquipmentActionState> {
  const profile = await getSessionProfile();
  if (!profile || !isAdminRole(profile.role)) {
    return { error: "You are not authorized to assign equipment." };
  }

  const projectId = Number(formData.get("projectId"));
  const notes = String(formData.get("notes") ?? "").trim();
  if (!Number.isSafeInteger(equipmentId) || equipmentId <= 0 || !Number.isSafeInteger(projectId) || projectId <= 0) {
    return { error: "Select a project to assign this equipment to." };
  }
  if (!await requireProjectAccess(projectId)) {
    return { error: "This project is archived or you do not have edit access." };
  }

  const supabase = await createClient();

  // The UI only offers "Assign" when status is "available", but a
  // crafted request could skip that — re-check server-side.
  const { data: current, error: statusError } = await supabase
    .from("equipment")
    .select("status")
    .eq("id", equipmentId)
    .single();
  if (current?.status === "assigned") {
    return { error: "This equipment is assigned to unfinished work. Review its task assignments." };
  }
  if (statusError || !current) return { error: "Could not check this equipment. Refresh and try again." };
  if (current.status !== "available") return { error: "Only available equipment can be assigned. Complete maintenance before assigning it." };

  const { error: assignmentError } = await supabase.rpc("assign_available_equipment", {
    p_equipment_id: equipmentId,p_project_id: projectId,p_notes: notes || null,
  });
  if (assignmentError) return { error: assignmentError.code === "40001"
    ? "Only available equipment can be assigned. Refresh and check its status."
    : "Could not assign the equipment. Please try again." };

  revalidateInventory();
  revalidateProjectPaths(projectId);
  return { success: true };
}

/** Reconcile availability with unfinished task allocations after assignment edits. */
async function syncEquipmentStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  equipmentId: number
): Promise<string | null> {
  // Done in the database (sync_equipment_status, see
  // 0051_foreman_project_access.sql) so a foreman working from their own
  // project's Equipment tab can keep the inventory row in sync without
  // having write access to the inventory itself.
  const { error } = await supabase.rpc("sync_equipment_status", {
    p_equipment_id: equipmentId,
  });
  if (error) {
    console.error("[syncEquipmentStatus] Supabase rpc failed:", error.message);
    return error.message;
  }

  return null;
}

/** Edit assignment details without manually releasing or reopening equipment. */
export async function updateEquipmentAssignment(
  assignmentId: number,
  equipmentId: number,
  projectId: number,
  _prevState: EquipmentActionState,
  formData: FormData
): Promise<EquipmentActionState> {
  const profile = await requireProjectAccess(projectId);
  if (!profile) {
    return { error: "You are not authorized to edit this assignment." };
  }

  const purpose = String(formData.get("purpose") ?? "").trim();
  const assignedAtRaw = String(formData.get("assignedAt") ?? "").trim();

  if (!assignedAtRaw) {
    return { error: "Assigned date is required." };
  }

  const assignedAt = new Date(assignedAtRaw);
  if (Number.isNaN(assignedAt.getTime())) {
    return { error: "Enter a valid assigned date." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("equipment_assignments")
    .update({
      notes: purpose || null,
      assigned_at: assignedAt.toISOString(),
    })
    .eq("id", assignmentId);

  if (error) {
    console.error(
      "[updateEquipmentAssignment] Supabase update failed:",
      error.message
    );
    return { error: "Could not update the assignment. Please try again." };
  }

  await syncEquipmentStatus(supabase, equipmentId);

  revalidateInventory();
  revalidateProjectPaths(projectId);
  return { success: true };
}

/** Delete an incorrect assignment record; normal completion releases equipment automatically. */
export async function deleteEquipmentAssignment(
  assignmentId: number,
  equipmentId: number,
  projectId: number,
  _prevState: EquipmentActionState,
  _formData: FormData
): Promise<EquipmentActionState> {
  const profile = await requireProjectAccess(projectId);
  if (!profile) {
    return { error: "You are not authorized to delete this assignment." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("equipment_assignments")
    .delete()
    .eq("id", assignmentId);

  if (error) {
    console.error(
      "[deleteEquipmentAssignment] Supabase delete failed:",
      error.message
    );
    return { error: "Could not delete the assignment. Please try again." };
  }

  await syncEquipmentStatus(supabase, equipmentId);

  revalidateInventory();
  revalidateProjectPaths(projectId);
  return { success: true };
}
