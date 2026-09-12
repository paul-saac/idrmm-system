import { createClient } from "@/lib/supabase/server";

export type EquipmentStatus = "available" | "assigned" | "maintenance" | "retired";

export type EquipmentRow = {
  id: number;
  assetTag: string;
  name: string;
  category: string | null;
  description: string | null;
  serialNumber: string | null;
  status: EquipmentStatus;
  currentProjectId: number | null;
  currentProjectName: string | null;
  lastAssignedAt: string | null;
  lastReturnedAt: string | null;
  createdAt: string;
};

const EQUIPMENT_COLUMNS =
  "id, asset_tag, name, category, description, serial_number, status, current_project_id, last_assigned_at, last_returned_at, created_at";

function toEquipmentRow(
  row: {
    id: number;
    asset_tag: string;
    name: string;
    category: string | null;
    description: string | null;
    serial_number: string | null;
    status: EquipmentStatus;
    current_project_id: number | null;
    last_assigned_at: string | null;
    last_returned_at: string | null;
    created_at: string;
  },
  projectNameById: Map<number, string>
): EquipmentRow {
  return {
    id: row.id,
    assetTag: row.asset_tag,
    name: row.name,
    category: row.category,
    description: row.description,
    serialNumber: row.serial_number,
    status: row.status,
    currentProjectId: row.current_project_id,
    currentProjectName:
      row.current_project_id != null
        ? (projectNameById.get(row.current_project_id) ?? null)
        : null,
    lastAssignedAt: row.last_assigned_at,
    lastReturnedAt: row.last_returned_at,
    createdAt: row.created_at,
  };
}

/**
 * The admin-side Inventory page's full company-wide equipment catalog —
 * every tool/machine regardless of which project (if any) currently has
 * it checked out.
 */
export async function listEquipment(): Promise<EquipmentRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("equipment")
    .select(EQUIPMENT_COLUMNS)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  const projectIds = Array.from(
    new Set(
      data
        .map((row) => row.current_project_id)
        .filter((id): id is number => id != null)
    )
  );
  const { data: projects } =
    projectIds.length > 0
      ? await supabase
          .from("projects")
          .select("id, project_name")
          .in("id", projectIds)
      : { data: [] as { id: number; project_name: string }[] };

  const projectNameById = new Map(
    (projects ?? []).map((p) => [p.id, p.project_name])
  );

  return data.map((row) => toEquipmentRow(row, projectNameById));
}

export type EquipmentAssignmentRow = {
  id: number;
  equipmentId: number;
  equipmentName: string;
  equipmentAssetTag: string;
  purpose: string | null;
  assignedAt: string;
  returnedAt: string | null;
};

/**
 * The Project Equipment tab's "Assigned Equipments" data — every
 * checkout this project has ever had, returned or not (unlike
 * Inventory's live current-state view, this is a history, the same way
 * Material Usage History is a history rather than a live snapshot).
 * Each row is one equipment_assignments record, set by assignEquipment
 * and closed out by returnEquipment/updateEquipmentAssignment (see
 * lib/equipment/actions.ts).
 */
export async function listProjectEquipmentAssignments(
  projectId: number
): Promise<EquipmentAssignmentRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("equipment_assignments")
    .select("id, equipment_id, notes, assigned_at, returned_at")
    .eq("project_id", projectId)
    .order("assigned_at", { ascending: false });

  if (error || !data) return [];

  const equipmentIds = Array.from(new Set(data.map((row) => row.equipment_id)));
  const { data: equipmentRows } =
    equipmentIds.length > 0
      ? await supabase
          .from("equipment")
          .select("id, name, asset_tag")
          .in("id", equipmentIds)
      : { data: [] as { id: number; name: string; asset_tag: string }[] };

  const equipmentById = new Map((equipmentRows ?? []).map((e) => [e.id, e]));

  return data.map((row) => {
    const equipment = equipmentById.get(row.equipment_id);
    return {
      id: row.id,
      equipmentId: row.equipment_id,
      equipmentName: equipment?.name ?? "—",
      equipmentAssetTag: equipment?.asset_tag ?? "—",
      purpose: row.notes,
      assignedAt: row.assigned_at,
      returnedAt: row.returned_at,
    };
  });
}
