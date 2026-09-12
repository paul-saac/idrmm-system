"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";
import { deriveEquipmentRequestStatus } from "@/lib/equipment-requests/status";
import type { EquipmentRequestPriority } from "@/lib/equipment-requests/data";

export type EquipmentRequestActionState = {
  error?: string;
  success?: boolean;
};

type RequestItemInput = {
  id: number | null;
  equipmentName: string;
  specification: string;
  quantityNeeded: number;
  uom: string;
  purpose: string;
  quantityFulfilled: number;
};

function parseNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

/**
 * The items list is submitted as one JSON-encoded form field, same
 * reasoning as lib/material-requests/actions.ts's readItems — a
 * variable-length list with rows added/removed client side doesn't fit a
 * plain FormData shape.
 */
function readItems(formData: FormData): RequestItemInput[] {
  const raw = String(formData.get("items") ?? "[]");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((item) => {
      const record = item as Record<string, unknown>;
      return {
        id:
          typeof record.id === "number"
            ? record.id
            : Number.isFinite(Number(record.id))
              ? Number(record.id)
              : null,
        equipmentName: String(record.equipmentName ?? "").trim(),
        specification: String(record.specification ?? "").trim(),
        quantityNeeded: parseNumber(record.quantityNeeded),
        uom: String(record.uom ?? "").trim(),
        purpose: String(record.purpose ?? "").trim(),
        quantityFulfilled: parseNumber(record.quantityFulfilled),
      };
    })
    .filter((item) => item.equipmentName.length > 0);
}

function parsePriority(value: FormDataEntryValue | null): EquipmentRequestPriority {
  const priority = String(value ?? "").trim();
  return priority === "urgent" || priority === "emergency" ? priority : "routine";
}

/**
 * ER-No is system-assigned, not typed on the request form — "ER-001",
 * "ER-002", … per project, same convention as MR-No (nextMrNo).
 */
async function nextErNo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: number
) {
  const { data } = await supabase
    .from("equipment_requisitions")
    .select("er_no")
    .eq("project_id", projectId);

  let maxSeq = 0;
  for (const row of data ?? []) {
    const match = /^ER-(\d+)$/.exec(row.er_no);
    if (match) {
      maxSeq = Math.max(maxSeq, Number(match[1]));
    }
  }
  return `ER-${String(maxSeq + 1).padStart(3, "0")}`;
}

export async function createEquipmentRequest(
  projectId: number,
  _prevState: EquipmentRequestActionState,
  formData: FormData
): Promise<EquipmentRequestActionState> {
  const profile = await getSessionProfile();
  if (!profile) {
    return { error: "You are not authorized to submit equipment requests." };
  }

  const items = readItems(formData);
  if (items.length === 0) {
    return { error: "Add at least one equipment item to the request." };
  }

  const dateRequiredRaw = String(formData.get("dateRequired") ?? "").trim();
  const priority = parsePriority(formData.get("priority"));
  const remarks = String(formData.get("remarks") ?? "").trim();

  const supabase = await createClient();
  const erNo = await nextErNo(supabase, projectId);

  const { data: request, error } = await supabase
    .from("equipment_requisitions")
    .insert({
      project_id: projectId,
      er_no: erNo,
      requested_by: profile.id,
      date_required: dateRequiredRaw || null,
      priority,
      remarks: remarks || null,
    })
    .select("id")
    .single();

  if (error || !request) {
    console.error("[createEquipmentRequest] Supabase insert failed:", error?.message);
    return { error: "Could not submit the equipment request. Please try again." };
  }

  const { error: itemsError } = await supabase.from("equipment_requisition_items").insert(
    items.map((item) => ({
      equipment_request_id: request.id,
      equipment_name: item.equipmentName,
      specification: item.specification || null,
      quantity_needed: item.quantityNeeded,
      uom: item.uom || null,
      purpose: item.purpose || null,
    }))
  );

  if (itemsError) {
    console.error(
      "[createEquipmentRequest] Supabase items insert failed:",
      itemsError.message
    );
    return { error: "Could not submit the equipment request. Please try again." };
  }

  revalidatePath(`/admin/projects/${projectId}`);
  return { success: true };
}

export async function updateEquipmentRequest(
  requestId: number,
  projectId: number,
  _prevState: EquipmentRequestActionState,
  formData: FormData
): Promise<EquipmentRequestActionState> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
    return { error: "You are not authorized to edit this equipment request." };
  }

  const items = readItems(formData);
  if (items.length === 0) {
    return { error: "An equipment request needs at least one item." };
  }

  const dateRequiredRaw = String(formData.get("dateRequired") ?? "").trim();
  const priority = parsePriority(formData.get("priority"));
  const remarks = String(formData.get("remarks") ?? "").trim();

  const supabase = await createClient();

  const { data: current } = await supabase
    .from("equipment_requisitions")
    .select("status")
    .eq("id", requestId)
    .single();

  if (!current) {
    return { error: "This equipment request no longer exists." };
  }

  const { data: existingItems } = await supabase
    .from("equipment_requisition_items")
    .select("id")
    .eq("equipment_request_id", requestId);

  const existingIds = new Set((existingItems ?? []).map((row) => row.id));
  const submittedIds = new Set(
    items.filter((item) => item.id !== null).map((item) => item.id as number)
  );

  const idsToDelete = [...existingIds].filter((id) => !submittedIds.has(id));
  const toInsert = items.filter((item) => item.id === null);
  const toUpdate = items.filter(
    (item) => item.id !== null && existingIds.has(item.id)
  );

  // PromiseLike rather than Promise — a PostgrestFilterBuilder is
  // thenable (awaitable, and safe to pass to Promise.all) but isn't
  // literally a Promise instance, so a stricter annotation here would
  // reject pushing the query builders directly below.
  const writes: PromiseLike<{ error: { message: string } | null }>[] = [];

  if (idsToDelete.length > 0) {
    writes.push(
      supabase.from("equipment_requisition_items").delete().in("id", idsToDelete)
    );
  }
  for (const item of toUpdate) {
    writes.push(
      supabase
        .from("equipment_requisition_items")
        .update({
          equipment_name: item.equipmentName,
          specification: item.specification || null,
          quantity_needed: item.quantityNeeded,
          uom: item.uom || null,
          purpose: item.purpose || null,
          quantity_fulfilled: item.quantityFulfilled,
        })
        .eq("id", item.id as number)
    );
  }
  if (toInsert.length > 0) {
    writes.push(
      supabase.from("equipment_requisition_items").insert(
        toInsert.map((item) => ({
          equipment_request_id: requestId,
          equipment_name: item.equipmentName,
          specification: item.specification || null,
          quantity_needed: item.quantityNeeded,
          uom: item.uom || null,
          purpose: item.purpose || null,
          quantity_fulfilled: item.quantityFulfilled,
        }))
      )
    );
  }

  const results = await Promise.all(writes);
  const writeError = results.find((r) => r.error);
  if (writeError?.error) {
    console.error(
      "[updateEquipmentRequest] Supabase item write failed:",
      writeError.error.message
    );
    return { error: "Could not update the equipment request. Please try again." };
  }

  const nextStatus = deriveEquipmentRequestStatus(current.status, items);

  const { error } = await supabase
    .from("equipment_requisitions")
    .update({
      date_required: dateRequiredRaw || null,
      priority,
      remarks: remarks || null,
      status: nextStatus,
    })
    .eq("id", requestId);

  if (error) {
    console.error("[updateEquipmentRequest] Supabase update failed:", error.message);
    return { error: "Could not update the equipment request. Please try again." };
  }

  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath(`/admin/projects/${projectId}/equipment/requests/${requestId}`);
  return { success: true };
}

export async function approveEquipmentRequest(
  requestId: number,
  projectId: number,
  _prevState: EquipmentRequestActionState,
  _formData: FormData
): Promise<EquipmentRequestActionState> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
    return { error: "You are not authorized to approve equipment requests." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("equipment_requisitions")
    .update({
      status: "approved",
      approved_by: profile.id,
      approved_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("status", "submitted");

  if (error) {
    console.error("[approveEquipmentRequest] Supabase update failed:", error.message);
    return { error: "Could not approve the equipment request. Please try again." };
  }

  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath(`/admin/projects/${projectId}/equipment/requests/${requestId}`);
  return { success: true };
}

export async function cancelEquipmentRequest(
  requestId: number,
  projectId: number,
  _prevState: EquipmentRequestActionState,
  _formData: FormData
): Promise<EquipmentRequestActionState> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
    return { error: "You are not authorized to cancel equipment requests." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("equipment_requisitions")
    .update({ status: "canceled" })
    .eq("id", requestId);

  if (error) {
    console.error("[cancelEquipmentRequest] Supabase update failed:", error.message);
    return { error: "Could not cancel the equipment request. Please try again." };
  }

  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath(`/admin/projects/${projectId}/equipment/requests/${requestId}`);
  return { success: true };
}
