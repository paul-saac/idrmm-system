"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";
import type { EquipmentStatus } from "@/lib/equipment/data";

export type EquipmentActionState = {
  error?: string;
  success?: boolean;
};

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

function readNonAssignedStatus(
  formData: FormData
): Exclude<EquipmentStatus, "assigned"> | null {
  const status = String(formData.get("status") ?? "").trim();
  return status === "available" || status === "maintenance" || status === "retired"
    ? status
    : null;
}

export async function createEquipment(
  _prevState: EquipmentActionState,
  formData: FormData
): Promise<EquipmentActionState> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
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

  revalidatePath("/admin/inventory");
  return { success: true };
}

export async function updateEquipment(
  equipmentId: number,
  _prevState: EquipmentActionState,
  formData: FormData
): Promise<EquipmentActionState> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
    return { error: "You are not authorized to edit equipment." };
  }

  const fields = readEquipmentFields(formData);
  if (!fields.name) {
    return { error: "Equipment name is required." };
  }

  const supabase = await createClient();

  // The Edit form only offers a Status field (Available/Maintenance/
  // Retired — never "Assigned") when the equipment isn't currently
  // assigned to a project, so formData won't carry one in that case —
  // nothing here touches status/current_project_id then. When it does,
  // and the equipment *was* assigned (only reachable by a crafted
  // request, since the form hides the field while assigned), close out
  // the active assignment the same way returnEquipment does so
  // current_project_id never goes stale.
  const nextStatus = readNonAssignedStatus(formData);
  let statusUpdate: {
    status?: Exclude<EquipmentStatus, "assigned">;
    current_project_id?: null;
    last_returned_at?: string;
  } = {};

  if (nextStatus) {
    const { data: current } = await supabase
      .from("equipment")
      .select("status")
      .eq("id", equipmentId)
      .single();

    if (current?.status === "assigned") {
      const now = new Date().toISOString();
      const { data: activeAssignment } = await supabase
        .from("equipment_assignments")
        .select("id")
        .eq("equipment_id", equipmentId)
        .is("returned_at", null)
        .order("assigned_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activeAssignment) {
        await supabase
          .from("equipment_assignments")
          .update({ returned_at: now })
          .eq("id", activeAssignment.id);
      }
      statusUpdate = {
        status: nextStatus,
        current_project_id: null,
        last_returned_at: now,
      };
    } else {
      statusUpdate = { status: nextStatus };
    }
  }

  const { error } = await supabase
    .from("equipment")
    .update({
      name: fields.name,
      category: fields.category || null,
      description: fields.description || null,
      serial_number: fields.serialNumber || null,
      ...statusUpdate,
    })
    .eq("id", equipmentId);

  if (error) {
    console.error("[updateEquipment] Supabase update failed:", error.message);
    return { error: "Could not update the equipment. Please try again." };
  }

  revalidatePath("/admin/inventory");
  return { success: true };
}

export async function deleteEquipment(
  equipmentId: number,
  _prevState: EquipmentActionState,
  _formData: FormData
): Promise<EquipmentActionState> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
    return { error: "You are not authorized to delete equipment." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("equipment").delete().eq("id", equipmentId);

  if (error) {
    console.error("[deleteEquipment] Supabase delete failed:", error.message);
    return { error: "Could not delete the equipment. Please try again." };
  }

  revalidatePath("/admin/inventory");
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
  if (!profile || profile.role !== "admin") {
    return { error: "You are not authorized to assign equipment." };
  }

  const projectId = Number(formData.get("projectId"));
  const notes = String(formData.get("notes") ?? "").trim();
  if (!projectId) {
    return { error: "Select a project to assign this equipment to." };
  }

  const supabase = await createClient();

  // The UI only offers "Assign" when status is "available", but a
  // crafted request could skip that — re-check server-side.
  const { data: current } = await supabase
    .from("equipment")
    .select("status")
    .eq("id", equipmentId)
    .single();
  if (current?.status === "assigned") {
    return { error: "This equipment is already assigned — return it first." };
  }

  const now = new Date().toISOString();

  const { error: assignmentError } = await supabase
    .from("equipment_assignments")
    .insert({
      equipment_id: equipmentId,
      project_id: projectId,
      assigned_by: profile.id,
      assigned_at: now,
      notes: notes || null,
    });

  if (assignmentError) {
    console.error(
      "[assignEquipment] Supabase equipment_assignments insert failed:",
      assignmentError.message
    );
    return { error: "Could not assign the equipment. Please try again." };
  }

  const { error: equipmentError } = await supabase
    .from("equipment")
    .update({
      status: "assigned",
      current_project_id: projectId,
      last_assigned_at: now,
    })
    .eq("id", equipmentId);

  if (equipmentError) {
    console.error(
      "[assignEquipment] Supabase equipment update failed:",
      equipmentError.message
    );
    return { error: "Could not assign the equipment. Please try again." };
  }

  revalidatePath("/admin/inventory");
  revalidatePath(`/admin/projects/${projectId}`);
  return { success: true };
}

/**
 * Checks equipment back in from whichever project currently has it —
 * closes out the active equipment_assignments row and clears the
 * equipment's current_project_id, which is what makes it disappear from
 * that project's Equipment tab.
 */
export async function returnEquipment(
  equipmentId: number,
  projectId: number,
  _prevState: EquipmentActionState,
  _formData: FormData
): Promise<EquipmentActionState> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
    return { error: "You are not authorized to return equipment." };
  }

  const supabase = await createClient();
  const now = new Date().toISOString();

  const { data: activeAssignment } = await supabase
    .from("equipment_assignments")
    .select("id")
    .eq("equipment_id", equipmentId)
    .is("returned_at", null)
    .order("assigned_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeAssignment) {
    await supabase
      .from("equipment_assignments")
      .update({ returned_at: now })
      .eq("id", activeAssignment.id);
  }

  const { error } = await supabase
    .from("equipment")
    .update({
      status: "available",
      current_project_id: null,
      last_returned_at: now,
    })
    .eq("id", equipmentId);

  if (error) {
    console.error("[returnEquipment] Supabase update failed:", error.message);
    return { error: "Could not mark the equipment as returned. Please try again." };
  }

  revalidatePath("/admin/inventory");
  revalidatePath(`/admin/projects/${projectId}`);
  return { success: true };
}

/**
 * Recomputes an equipment item's live status/current_project_id from
 * its equipment_assignments history — the source of truth after an edit
 * or delete on the Project Equipment tab, where (unlike assignEquipment/
 * returnEquipment, which each know exactly what just happened) the
 * resulting state isn't obvious from the one row that changed. Leaves
 * "maintenance"/"retired" alone — those are only ever set explicitly via
 * updateEquipment, not implied by assignment history.
 */
async function syncEquipmentStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  equipmentId: number
) {
  const { data: current } = await supabase
    .from("equipment")
    .select("status")
    .eq("id", equipmentId)
    .single();

  if (current?.status === "maintenance" || current?.status === "retired") {
    return;
  }

  const { data: activeAssignment } = await supabase
    .from("equipment_assignments")
    .select("project_id, assigned_at")
    .eq("equipment_id", equipmentId)
    .is("returned_at", null)
    .order("assigned_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeAssignment) {
    await supabase
      .from("equipment")
      .update({
        status: "assigned",
        current_project_id: activeAssignment.project_id,
        last_assigned_at: activeAssignment.assigned_at,
      })
      .eq("id", equipmentId);
    return;
  }

  const { data: lastReturned } = await supabase
    .from("equipment_assignments")
    .select("returned_at")
    .eq("equipment_id", equipmentId)
    .not("returned_at", "is", null)
    .order("returned_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  await supabase
    .from("equipment")
    .update({
      status: "available",
      current_project_id: null,
      last_returned_at: lastReturned?.returned_at ?? null,
    })
    .eq("id", equipmentId);
}

/**
 * Edits one assignment record from the Project Equipment tab — Purpose,
 * Assigned Date, and Return Date (clearing Return Date reopens it as
 * "not returned"). Since this can change which assignment (if any)
 * counts as "active", the equipment's live status is recomputed from
 * scratch afterward rather than patched in place.
 */
export async function updateEquipmentAssignment(
  assignmentId: number,
  equipmentId: number,
  projectId: number,
  _prevState: EquipmentActionState,
  formData: FormData
): Promise<EquipmentActionState> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
    return { error: "You are not authorized to edit this assignment." };
  }

  const purpose = String(formData.get("purpose") ?? "").trim();
  const assignedAtRaw = String(formData.get("assignedAt") ?? "").trim();
  const returnedAtRaw = String(formData.get("returnedAt") ?? "").trim();

  if (!assignedAtRaw) {
    return { error: "Assigned date is required." };
  }

  const assignedAt = new Date(assignedAtRaw);
  if (Number.isNaN(assignedAt.getTime())) {
    return { error: "Enter a valid assigned date." };
  }

  let returnedAt: Date | null = null;
  if (returnedAtRaw) {
    returnedAt = new Date(returnedAtRaw);
    if (Number.isNaN(returnedAt.getTime())) {
      return { error: "Enter a valid return date." };
    }
    if (returnedAt.getTime() < assignedAt.getTime()) {
      return { error: "Return date can't be before the assigned date." };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("equipment_assignments")
    .update({
      notes: purpose || null,
      assigned_at: assignedAt.toISOString(),
      returned_at: returnedAt ? returnedAt.toISOString() : null,
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

  revalidatePath("/admin/inventory");
  revalidatePath(`/admin/projects/${projectId}`);
  return { success: true };
}

/**
 * Deletes one assignment record entirely (not the equipment itself) —
 * for a mistaken assignment, not a normal return (use returnEquipment,
 * or clear Return Date via updateEquipmentAssignment, for that).
 */
export async function deleteEquipmentAssignment(
  assignmentId: number,
  equipmentId: number,
  projectId: number,
  _prevState: EquipmentActionState,
  _formData: FormData
): Promise<EquipmentActionState> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
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

  revalidatePath("/admin/inventory");
  revalidatePath(`/admin/projects/${projectId}`);
  return { success: true };
}
