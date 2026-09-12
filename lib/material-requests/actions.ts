"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";
import { deriveMaterialRequestStatus } from "@/lib/material-requests/status";
import type { MaterialRequestPriority } from "@/lib/material-requests/data";

export type MaterialRequestActionState = {
  error?: string;
  success?: boolean;
};

type RequestItemInput = {
  id: number | null;
  materialName: string;
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
 * The items list is submitted as one JSON-encoded form field rather than
 * indexed form fields (item[0][materialName], item[1][materialName], …)
 * — the list is variable-length and can have rows added/removed client
 * side (the "+ Add Item Request" flow), which a plain FormData shape
 * would make error-prone to reassemble in order.
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
        materialName: String(record.materialName ?? "").trim(),
        specification: String(record.specification ?? "").trim(),
        quantityNeeded: parseNumber(record.quantityNeeded),
        uom: String(record.uom ?? "").trim(),
        purpose: String(record.purpose ?? "").trim(),
        quantityFulfilled: parseNumber(record.quantityFulfilled),
      };
    })
    .filter((item) => item.materialName.length > 0);
}

function parsePriority(value: FormDataEntryValue | null): MaterialRequestPriority {
  const priority = String(value ?? "").trim();
  return priority === "urgent" || priority === "emergency" ? priority : "routine";
}

/**
 * MR-No is system-assigned, not typed on the request form — "MR-001",
 * "MR-002", … per project. Based on the highest existing sequence number
 * rather than a plain row count, same convention as Material ID
 * (nextMaterialCode) and Asset Tag (nextAssetTag).
 */
async function nextMrNo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: number
) {
  const { data } = await supabase
    .from("material_requests")
    .select("mr_no")
    .eq("project_id", projectId);

  let maxSeq = 0;
  for (const row of data ?? []) {
    const match = /^MR-(\d+)$/.exec(row.mr_no);
    if (match) {
      maxSeq = Math.max(maxSeq, Number(match[1]));
    }
  }
  return `MR-${String(maxSeq + 1).padStart(3, "0")}`;
}

export async function createMaterialRequest(
  projectId: number,
  _prevState: MaterialRequestActionState,
  formData: FormData
): Promise<MaterialRequestActionState> {
  const profile = await getSessionProfile();
  if (!profile) {
    return { error: "You are not authorized to submit material requests." };
  }

  const items = readItems(formData);
  if (items.length === 0) {
    return { error: "Add at least one material item to the request." };
  }

  const dateRequiredRaw = String(formData.get("dateRequired") ?? "").trim();
  const priority = parsePriority(formData.get("priority"));
  const remarks = String(formData.get("remarks") ?? "").trim();

  const supabase = await createClient();
  const mrNo = await nextMrNo(supabase, projectId);

  const { data: request, error } = await supabase
    .from("material_requests")
    .insert({
      project_id: projectId,
      mr_no: mrNo,
      requested_by: profile.id,
      date_required: dateRequiredRaw || null,
      priority,
      remarks: remarks || null,
    })
    .select("id")
    .single();

  if (error || !request) {
    console.error("[createMaterialRequest] Supabase insert failed:", error?.message);
    return { error: "Could not submit the material request. Please try again." };
  }

  const { error: itemsError } = await supabase.from("material_request_items").insert(
    items.map((item) => ({
      material_request_id: request.id,
      material_name: item.materialName,
      specification: item.specification || null,
      quantity_needed: item.quantityNeeded,
      uom: item.uom || null,
      purpose: item.purpose || null,
    }))
  );

  if (itemsError) {
    console.error(
      "[createMaterialRequest] Supabase items insert failed:",
      itemsError.message
    );
    return { error: "Could not submit the material request. Please try again." };
  }

  revalidatePath(`/admin/projects/${projectId}`);
  return { success: true };
}

export async function updateMaterialRequest(
  requestId: number,
  projectId: number,
  _prevState: MaterialRequestActionState,
  formData: FormData
): Promise<MaterialRequestActionState> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
    return { error: "You are not authorized to edit this material request." };
  }

  const items = readItems(formData);
  if (items.length === 0) {
    return { error: "A material request needs at least one item." };
  }

  const dateRequiredRaw = String(formData.get("dateRequired") ?? "").trim();
  const priority = parsePriority(formData.get("priority"));
  const remarks = String(formData.get("remarks") ?? "").trim();

  const supabase = await createClient();

  const { data: current } = await supabase
    .from("material_requests")
    .select("status")
    .eq("id", requestId)
    .single();

  if (!current) {
    return { error: "This material request no longer exists." };
  }

  const { data: existingItems } = await supabase
    .from("material_request_items")
    .select("id")
    .eq("material_request_id", requestId);

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
      supabase.from("material_request_items").delete().in("id", idsToDelete)
    );
  }
  for (const item of toUpdate) {
    writes.push(
      supabase
        .from("material_request_items")
        .update({
          material_name: item.materialName,
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
      supabase.from("material_request_items").insert(
        toInsert.map((item) => ({
          material_request_id: requestId,
          material_name: item.materialName,
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
      "[updateMaterialRequest] Supabase item write failed:",
      writeError.error.message
    );
    return { error: "Could not update the material request. Please try again." };
  }

  const nextStatus = deriveMaterialRequestStatus(current.status, items);

  const { error } = await supabase
    .from("material_requests")
    .update({
      date_required: dateRequiredRaw || null,
      priority,
      remarks: remarks || null,
      status: nextStatus,
    })
    .eq("id", requestId);

  if (error) {
    console.error("[updateMaterialRequest] Supabase update failed:", error.message);
    return { error: "Could not update the material request. Please try again." };
  }

  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath(`/admin/projects/${projectId}/materials/requests/${requestId}`);
  return { success: true };
}

export async function approveMaterialRequest(
  requestId: number,
  projectId: number,
  _prevState: MaterialRequestActionState,
  _formData: FormData
): Promise<MaterialRequestActionState> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
    return { error: "You are not authorized to approve material requests." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("material_requests")
    .update({
      status: "approved",
      approved_by: profile.id,
      approved_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("status", "submitted");

  if (error) {
    console.error("[approveMaterialRequest] Supabase update failed:", error.message);
    return { error: "Could not approve the material request. Please try again." };
  }

  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath(`/admin/projects/${projectId}/materials/requests/${requestId}`);
  return { success: true };
}

export async function cancelMaterialRequest(
  requestId: number,
  projectId: number,
  _prevState: MaterialRequestActionState,
  _formData: FormData
): Promise<MaterialRequestActionState> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
    return { error: "You are not authorized to cancel material requests." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("material_requests")
    .update({ status: "canceled" })
    .eq("id", requestId);

  if (error) {
    console.error("[cancelMaterialRequest] Supabase update failed:", error.message);
    return { error: "Could not cancel the material request. Please try again." };
  }

  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath(`/admin/projects/${projectId}/materials/requests/${requestId}`);
  return { success: true };
}
