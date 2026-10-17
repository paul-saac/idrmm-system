import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

export type MaterialRequestStatus =
  | "submitted"
  | "approved"
  | "partially_fulfilled"
  | "fulfilled"
  | "canceled";

export type MaterialRequestPriority = "routine" | "urgent" | "emergency";

export type MaterialRequestItemFulfilment =
  | "not_fulfilled"
  | "partially_fulfilled"
  | "fulfilled";

export type MaterialRequestListItem = {
  id: number;
  mrNo: string;
  requestDate: string;
  requestedByName: string;
  status: MaterialRequestStatus;
  priority: MaterialRequestPriority;
};

export type MaterialRequestItem = {
  id: number;
  materialName: string;
  specification: string | null;
  quantityNeeded: number;
  uom: string | null;
  purpose: string | null;
  quantityFulfilled: number;
  quantityRemaining: number;
  fulfilment: MaterialRequestItemFulfilment;
};

export type MaterialRequestDetail = {
  id: number;
  projectId: number;
  mrNo: string;
  requestDate: string;
  dateRequired: string | null;
  priority: MaterialRequestPriority;
  remarks: string | null;
  status: MaterialRequestStatus;
  requestedByName: string;
  approvedByName: string | null;
  approvedAt: string | null;
  items: MaterialRequestItem[];
};

function itemFulfilment(
  quantityNeeded: number,
  quantityFulfilled: number
): MaterialRequestItemFulfilment {
  if (quantityFulfilled <= 0) return "not_fulfilled";
  if (quantityFulfilled >= quantityNeeded) return "fulfilled";
  return "partially_fulfilled";
}

function formatProfileName(
  profile:
    | { first_name: string; last_name: string; email?: string | null }
    | null
    | undefined
) {
  if (!profile) return "—";
  // Without a name, its email's name part — never blank.
  return (
    `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim() ||
    profile.email?.split("@")[0] ||
    "—"
  );
}

// A request's own columns — who asked for and approved it, and its items,
// are read after (withDetails).
const REQUEST_COLUMNS =
  "id, project_id, mr_no, request_date, date_required, priority, remarks, status, requested_by, approved_by, approved_at";

type MaterialRequestRow = Omit<
  Database["public"]["Tables"]["material_requests"]["Row"],
  "created_at" | "updated_at"
>;

/**
 * Requests in full — who asked for and approved each, and every item,
 * with a per-item Quantity Remaining/Fulfilment derived from
 * quantity_needed vs. quantity_fulfilled (see itemFulfilment above)
 * rather than stored, so an edit to either number can never leave the
 * two out of sync.
 */
async function withDetails(
  supabase: Awaited<ReturnType<typeof createClient>>,
  requests: MaterialRequestRow[]
): Promise<MaterialRequestDetail[]> {
  if (requests.length === 0) return [];

  const requestIds = requests.map((r) => r.id);
  const profileIds = Array.from(
    new Set(
      requests.flatMap((r) => [r.requested_by, r.approved_by]).filter(
        (id): id is string => Boolean(id)
      )
    )
  );

  const [{ data: profiles }, { data: itemRows }] = await Promise.all([
    supabase.from("profiles").select("id, first_name, last_name, email").in("id", profileIds),
    supabase
      .from("material_request_items")
      .select(
        "id, material_request_id, material_name, specification, quantity_needed, uom, purpose, quantity_fulfilled"
      )
      .in("material_request_id", requestIds)
      .order("id", { ascending: true }),
  ]);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const itemsByRequestId = new Map<number, MaterialRequestItem[]>();
  for (const item of itemRows ?? []) {
    const quantityNeeded = item.quantity_needed ?? 0;
    const quantityFulfilled = item.quantity_fulfilled ?? 0;
    const list = itemsByRequestId.get(item.material_request_id) ?? [];
    list.push({
      id: item.id,
      materialName: item.material_name,
      specification: item.specification,
      quantityNeeded,
      uom: item.uom,
      purpose: item.purpose,
      quantityFulfilled,
      quantityRemaining: Math.max(quantityNeeded - quantityFulfilled, 0),
      fulfilment: itemFulfilment(quantityNeeded, quantityFulfilled),
    });
    itemsByRequestId.set(item.material_request_id, list);
  }

  return requests.map((request) => ({
    id: request.id,
    projectId: request.project_id,
    mrNo: request.mr_no,
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
 * Every material request on the project, newest-requested first, in full
 * — the Materials tab's request tables, where each one opens in its row.
 */
export async function listMaterialRequests(
  projectId: number
): Promise<MaterialRequestDetail[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("material_requests")
    .select(REQUEST_COLUMNS)
    .eq("project_id", projectId)
    .order("request_date", { ascending: false });

  if (error || !data) return [];
  return withDetails(supabase, data);
}

/**
 * The Add Daily Log modal's "Select Material Request" / "Select Material
 * Request Item" pickers (Material Procurement Log) — every request on
 * this project that can still receive a delivery against it, with their
 * items. "Can still receive a delivery" means approved or already
 * partially fulfilled; submitted (not yet reviewed), canceled, and fully
 * fulfilled requests have nothing left to pick.
 */
export async function listFulfillableMaterialRequests(
  projectId: number
): Promise<MaterialRequestDetail[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("material_requests")
    .select(REQUEST_COLUMNS)
    .eq("project_id", projectId)
    .in("status", ["approved", "partially_fulfilled"])
    .order("request_date", { ascending: false });

  if (error || !data) return [];
  return withDetails(supabase, data);
}
