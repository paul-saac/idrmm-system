import { createClient } from "@/lib/supabase/server";

export type EquipmentRequestStatus =
  | "submitted"
  | "approved"
  | "partially_fulfilled"
  | "fulfilled"
  | "canceled";

export type EquipmentRequestPriority = "routine" | "urgent" | "emergency";

export type EquipmentRequestItemFulfilment =
  | "not_fulfilled"
  | "partially_fulfilled"
  | "fulfilled";

export type EquipmentRequestListItem = {
  id: number;
  erNo: string;
  requestDate: string;
  requestedByName: string;
  status: EquipmentRequestStatus;
  priority: EquipmentRequestPriority;
};

export type EquipmentRequestItem = {
  id: number;
  equipmentName: string;
  specification: string | null;
  quantityNeeded: number;
  uom: string | null;
  purpose: string | null;
  quantityFulfilled: number;
  quantityRemaining: number;
  fulfilment: EquipmentRequestItemFulfilment;
};

export type EquipmentRequestDetail = {
  id: number;
  projectId: number;
  erNo: string;
  requestDate: string;
  dateRequired: string | null;
  priority: EquipmentRequestPriority;
  remarks: string | null;
  status: EquipmentRequestStatus;
  requestedByName: string;
  approvedByName: string | null;
  approvedAt: string | null;
  items: EquipmentRequestItem[];
};

function itemFulfilment(
  quantityNeeded: number,
  quantityFulfilled: number
): EquipmentRequestItemFulfilment {
  if (quantityFulfilled <= 0) return "not_fulfilled";
  if (quantityFulfilled >= quantityNeeded) return "fulfilled";
  return "partially_fulfilled";
}

function formatProfileName(
  profile: { first_name: string; last_name: string } | null | undefined
) {
  if (!profile) return "—";
  return `${profile.first_name} ${profile.last_name}`.trim();
}

/**
 * The Equipment tab's "Requests" sub-tab — every request submitted for
 * this project, newest-requested first.
 */
export async function listEquipmentRequests(
  projectId: number
): Promise<EquipmentRequestListItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("equipment_requisitions")
    .select("id, er_no, request_date, priority, status, requested_by")
    .eq("project_id", projectId)
    .order("request_date", { ascending: false });

  if (error || !data || data.length === 0) return [];

  const requesterIds = Array.from(new Set(data.map((row) => row.requested_by)));
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, first_name, last_name")
    .in("id", requesterIds);
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  return data.map((row) => ({
    id: row.id,
    erNo: row.er_no,
    requestDate: row.request_date,
    requestedByName: formatProfileName(profileById.get(row.requested_by)),
    status: row.status,
    priority: row.priority,
  }));
}

/**
 * The Add Daily Log modal's "Select Equipment Request" / "Select
 * Equipment Request Item" pickers (Equipment Acquisition Log) — every
 * request on this project that can still receive an acquisition against
 * it, with their items. "Can still receive one" means approved or
 * already partially fulfilled; submitted (not yet reviewed), canceled,
 * and fully fulfilled requests have nothing left to pick.
 */
export async function listFulfillableEquipmentRequests(
  projectId: number
): Promise<EquipmentRequestDetail[]> {
  const supabase = await createClient();

  const { data: requests, error } = await supabase
    .from("equipment_requisitions")
    .select(
      "id, project_id, er_no, request_date, date_required, priority, remarks, status, requested_by, approved_by, approved_at"
    )
    .eq("project_id", projectId)
    .in("status", ["approved", "partially_fulfilled"])
    .order("request_date", { ascending: false });

  if (error || !requests || requests.length === 0) return [];

  const requestIds = requests.map((r) => r.id);
  const profileIds = Array.from(
    new Set(
      requests.flatMap((r) => [r.requested_by, r.approved_by]).filter(
        (id): id is string => Boolean(id)
      )
    )
  );

  const [{ data: profiles }, { data: itemRows }] = await Promise.all([
    supabase.from("profiles").select("id, first_name, last_name").in("id", profileIds),
    supabase
      .from("equipment_requisition_items")
      .select(
        "id, equipment_request_id, equipment_name, specification, quantity_needed, uom, purpose, quantity_fulfilled"
      )
      .in("equipment_request_id", requestIds)
      .order("id", { ascending: true }),
  ]);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const itemsByRequestId = new Map<number, EquipmentRequestItem[]>();
  for (const item of itemRows ?? []) {
    const quantityNeeded = item.quantity_needed ?? 0;
    const quantityFulfilled = item.quantity_fulfilled ?? 0;
    const list = itemsByRequestId.get(item.equipment_request_id) ?? [];
    list.push({
      id: item.id,
      equipmentName: item.equipment_name,
      specification: item.specification,
      quantityNeeded,
      uom: item.uom,
      purpose: item.purpose,
      quantityFulfilled,
      quantityRemaining: Math.max(quantityNeeded - quantityFulfilled, 0),
      fulfilment: itemFulfilment(quantityNeeded, quantityFulfilled),
    });
    itemsByRequestId.set(item.equipment_request_id, list);
  }

  return requests.map((request) => ({
    id: request.id,
    projectId: request.project_id,
    erNo: request.er_no,
    requestDate: request.request_date,
    dateRequired: request.date_required,
    priority: request.priority,
    remarks: request.remarks,
    status: request.status,
    requestedByName: formatProfileName(profileById.get(request.requested_by)),
    approvedByName: request.approved_by
      ? formatProfileName(profileById.get(request.approved_by))
      : null,
    approvedAt: request.approved_at,
    items: itemsByRequestId.get(request.id) ?? [],
  }));
}

/**
 * The "Equipment Requests / ER-xxx" detail page — the request header plus
 * every requested item, with a per-item Quantity Remaining/Fulfilment
 * derived from quantity_needed vs. quantity_fulfilled (see
 * itemFulfilment above) rather than stored, so an edit to either number
 * can never leave the two out of sync.
 */
export async function getEquipmentRequestDetail(
  requestId: number
): Promise<EquipmentRequestDetail | null> {
  const supabase = await createClient();

  const { data: request, error } = await supabase
    .from("equipment_requisitions")
    .select(
      "id, project_id, er_no, request_date, date_required, priority, remarks, status, requested_by, approved_by, approved_at"
    )
    .eq("id", requestId)
    .single();

  if (error || !request) return null;

  const profileIds = [request.requested_by, request.approved_by].filter(
    (id): id is string => Boolean(id)
  );

  const [{ data: profiles }, { data: itemRows }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", profileIds),
    supabase
      .from("equipment_requisition_items")
      .select(
        "id, equipment_name, specification, quantity_needed, uom, purpose, quantity_fulfilled"
      )
      .eq("equipment_request_id", requestId)
      .order("id", { ascending: true }),
  ]);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  const items: EquipmentRequestItem[] = (itemRows ?? []).map((item) => {
    const quantityNeeded = item.quantity_needed ?? 0;
    const quantityFulfilled = item.quantity_fulfilled ?? 0;
    return {
      id: item.id,
      equipmentName: item.equipment_name,
      specification: item.specification,
      quantityNeeded,
      uom: item.uom,
      purpose: item.purpose,
      quantityFulfilled,
      quantityRemaining: Math.max(quantityNeeded - quantityFulfilled, 0),
      fulfilment: itemFulfilment(quantityNeeded, quantityFulfilled),
    };
  });

  return {
    id: request.id,
    projectId: request.project_id,
    erNo: request.er_no,
    requestDate: request.request_date,
    dateRequired: request.date_required,
    priority: request.priority,
    remarks: request.remarks,
    status: request.status,
    requestedByName: formatProfileName(profileById.get(request.requested_by)),
    approvedByName: request.approved_by
      ? formatProfileName(profileById.get(request.approved_by))
      : null,
    approvedAt: request.approved_at,
    items,
  };
}
