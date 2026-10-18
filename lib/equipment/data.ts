import { createClient } from "@/lib/supabase/server";
import type { ProgressExpense } from "@/lib/expenses/progress";

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

/** One day's equipment cost as typed in a Daily Progress Update. */
export type ProgressEquipmentCost = {
  id: string;
  entryDate: string;
  /** The task, or task-less phase, it was logged on — a task under its
   * phase: "PAINTING WORKS - Wall & Ceiling Painting". */
  itemName: string;
  /** Which: task-<id> or category-<id>. */
  itemKey: string;
  amount: number;
  /** Who saved it — their name, else their email's name part; null when
   * unknown. */
  savedByName: string | null;
};

/** Load all pages so long projects do not silently lose expenses at the API row limit. */
async function readExpensePages<T>(fetchPage: (from: number, to: number) => PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(`Unable to load progress expenses: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

/** Current saved costs in all four categories, shared by Expenses and Equipment.
 * Never sum the append-only audit history: re-saving a day replaces its expense.
 * material_cost already includes the priced material usage on that entry.
 */
export async function listProgressExpenses(
  projectId: number
): Promise<ProgressExpense[]> {
  const supabase = await createClient();

  const [tasks, categories] = await Promise.all([
    readExpensePages((from, to) => supabase.from("estimate_tasks").select("id, task_name, category_id").eq("project_id", projectId).order("id").range(from, to)),
    readExpensePages((from, to) => supabase.from("estimate_categories").select("id, category_name").eq("project_id", projectId).order("id").range(from, to)),
  ]);
  const categoryName = new Map((categories ?? []).map((row) => [row.id, row.category_name]));
  const taskName = new Map(
    (tasks ?? []).map((row) => {
      const phase = categoryName.get(row.category_id);
      return [row.id, phase ? `${phase} - ${row.task_name}` : row.task_name];
    })
  );

  // "*" so a DB missing a newer column still loads.
  const [taskEntries, categoryEntries] = await Promise.all([
    taskName.size > 0
      ? readExpensePages((from, to) => supabase.from("task_progress_entries").select("*").in("task_id", [...taskName.keys()]).order("id").range(from, to))
      : Promise.resolve([]),
    categoryName.size > 0
      ? readExpensePages((from, to) => supabase
          .from("category_progress_entries")
          .select("*")
          .in("category_id", [...categoryName.keys()]).order("id").range(from, to))
      : Promise.resolve([]),
  ]);

  const costs: (ProgressExpense & { createdAt: string; recordedBy: string | null })[] = [];
  for (const row of taskEntries ?? []) {
    const amounts = { material: Number(row.material_cost) || 0, equipment: Number(row.equipment_cost) || 0, labor: Number(row.labor_cost) || 0, other: Number(row.other_cost) || 0 };
    if (!Object.values(amounts).some((amount) => amount > 0)) continue;
    costs.push({
      id: `task-${row.id}`,
      entryDate: row.entry_date,
      itemName: taskName.get(row.task_id) ?? "",
      itemKey: `task-${row.task_id}`,
      costs: amounts,
      savedByName: null,
      createdAt: row.created_at,
      recordedBy: row.recorded_by ?? null,
    });
  }
  for (const row of categoryEntries ?? []) {
    const amounts = { material: Number(row.material_cost) || 0, equipment: Number(row.equipment_cost) || 0, labor: Number(row.labor_cost) || 0, other: Number(row.other_cost) || 0 };
    if (!Object.values(amounts).some((amount) => amount > 0)) continue;
    costs.push({
      id: `category-${row.id}`,
      entryDate: row.entry_date,
      itemName: categoryName.get(row.category_id) ?? "",
      itemKey: `category-${row.category_id}`,
      costs: amounts,
      savedByName: null,
      createdAt: row.created_at,
      recordedBy: row.recorded_by ?? null,
    });
  }

  // Who saved each — a name, else the email's name part.
  const savers = Array.from(
    new Set(costs.map((cost) => cost.recordedBy).filter((id): id is string => Boolean(id)))
  );
  const { data: profiles } =
    savers.length > 0
      ? await supabase.from("profiles").select("id, first_name, last_name, email").in("id", savers)
      : { data: [] };
  const nameOf = new Map(
    (profiles ?? []).map((profile) => [
      profile.id,
      `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim() ||
        profile.email?.split("@")[0] ||
        null,
    ])
  );

  return costs
    .sort(
      (a, b) =>
        b.entryDate.localeCompare(a.entryDate) || b.createdAt.localeCompare(a.createdAt)
    )
    .map(({ createdAt: _createdAt, recordedBy, ...rest }) => ({
      ...rest,
      savedByName: recordedBy ? (nameOf.get(recordedBy) ?? null) : null,
    }));
}
