import { createClient } from "@/lib/supabase/server";
import type { ProgressExpense } from "@/lib/expenses/progress";
import { listMaterialPurchases } from "@/lib/materials/purchases";

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
  currentTaskId: number | null;
  currentTaskName: string | null;
  taskAssignedAt: string | null;
};

export type EquipmentTaskMovementRow = {
  id: number;
  equipmentAssignmentId: number;
  equipmentName: string;
  equipmentAssetTag: string;
  taskName: string;
  assignedAt: string;
  releasedAt: string | null;
  releaseReason: "moved" | "returned" | null;
  assignedByName: string | null;
  notes: string | null;
};

export type EquipmentTaskOption = {
  id: number;
  name: string;
  phaseName: string;
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

  const assignmentIds = data.map((row) => row.id);
  const { data: activeTaskRows } = assignmentIds.length
    ? await supabase
        .from("equipment_task_assignments")
        .select("equipment_assignment_id, task_id, task_name, assigned_at")
        .in("equipment_assignment_id", assignmentIds)
        .is("released_at", null)
    : { data: [] };
  const activeTaskByAssignment = new Map(
    (activeTaskRows ?? []).map((row) => [row.equipment_assignment_id, row])
  );

  return data.map((row) => {
    const equipment = equipmentById.get(row.equipment_id);
    const taskPlacement = activeTaskByAssignment.get(row.id);
    return {
      id: row.id,
      equipmentId: row.equipment_id,
      equipmentName: equipment?.name ?? "—",
      equipmentAssetTag: equipment?.asset_tag ?? "—",
      purpose: row.notes,
      assignedAt: row.assigned_at,
      returnedAt: row.returned_at,
      currentTaskId: taskPlacement?.task_id ?? null,
      currentTaskName: taskPlacement?.task_name ?? null,
      taskAssignedAt: taskPlacement?.assigned_at ?? null,
    };
  });
}

/** Every task period for checked-out equipment, newest first. Together the
 * periods form the equipment movement history inside one project. */
export async function listProjectEquipmentTaskMovements(
  projectId: number
): Promise<EquipmentTaskMovementRow[]> {
  const supabase = await createClient();
  const { data: movements, error } = await supabase
    .from("equipment_task_assignments")
    .select("id, equipment_assignment_id, task_name, assigned_by, assigned_at, released_at, release_reason, notes")
    .eq("project_id", projectId)
    .order("assigned_at", { ascending: false });
  if (error || !movements) return [];

  const assignmentIds = [...new Set(movements.map((row) => row.equipment_assignment_id))];
  const { data: assignmentRows } = assignmentIds.length
    ? await supabase
        .from("equipment_assignments")
        .select("id, equipment_id")
        .in("id", assignmentIds)
    : { data: [] };
  const equipmentIdByAssignment = new Map(
    (assignmentRows ?? []).map((row) => [row.id, row.equipment_id])
  );
  const equipmentIds = [...new Set((assignmentRows ?? []).map((row) => row.equipment_id))];
  const { data: equipmentRows } = equipmentIds.length
    ? await supabase.from("equipment").select("id, name, asset_tag").in("id", equipmentIds)
    : { data: [] };
  const equipmentById = new Map((equipmentRows ?? []).map((row) => [row.id, row]));

  const profileIds = [...new Set(movements.map((row) => row.assigned_by).filter((id): id is string => Boolean(id)))];
  const { data: profiles } = profileIds.length
    ? await supabase.from("profiles").select("id, first_name, last_name, email").in("id", profileIds)
    : { data: [] };
  const profileName = new Map(
    (profiles ?? []).map((profile) => [
      profile.id,
      `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim() || profile.email?.split("@")[0] || null,
    ])
  );

  return movements.map((row) => {
    const equipmentId = equipmentIdByAssignment.get(row.equipment_assignment_id);
    const equipment = equipmentId == null ? null : equipmentById.get(equipmentId);
    return {
      id: row.id,
      equipmentAssignmentId: row.equipment_assignment_id,
      equipmentName: equipment?.name ?? "—",
      equipmentAssetTag: equipment?.asset_tag ?? "—",
      taskName: row.task_name,
      assignedAt: row.assigned_at,
      releasedAt: row.released_at,
      releaseReason: row.release_reason,
      assignedByName: row.assigned_by ? (profileName.get(row.assigned_by) ?? null) : null,
      notes: row.notes,
    };
  });
}

export type ProgressEquipmentCostItem = {
  name: string;
  amount: number;
  unplanned: boolean;
};

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
  /** Itemized equipment lines saved in the update (0089). */
  equipmentItems?: ProgressEquipmentCostItem[];
  /** Whether this is a standalone "not on the list" (unplanned) record. */
  isUnplanned?: boolean;
  /** Specific equipment name if this is a standalone record. */
  equipmentName?: string;
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

async function fetchCostEntries(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tableName:
    | "task_progress_equipment_cost_entries"
    | "category_progress_equipment_cost_entries"
    | "task_progress_other_cost_entries"
    | "category_progress_other_cost_entries",
  entryIds: number[]
) {
  if (entryIds.length === 0) return [];
  const chunkSize = 200;
  const allRows: { progress_entry_id: number; cost_name: string; amount: number; unplanned?: boolean }[] = [];
  for (let i = 0; i < entryIds.length; i += chunkSize) {
    const chunk = entryIds.slice(i, i + chunkSize);
    const { data, error } = await (
      supabase as unknown as {
        from: (table: string) => {
          select: (cols: string) => {
            in: (col: string, vals: number[]) => PromiseLike<{
              data: { progress_entry_id: number; cost_name: string; amount: number; unplanned?: boolean }[] | null;
              error: { code?: string; message: string } | null;
            }>;
          };
        };
      }
    )
      .from(tableName)
      .select("progress_entry_id, cost_name, amount, unplanned")
      .in("progress_entry_id", chunk);

    if (error && error.code !== "PGRST205" && error.code !== "42P01") {
      console.error(`[listProgressExpenses] ${tableName} query failed:`, error.message);
    }
    if (data) {
      allRows.push(...data);
    }
  }
  return allRows;
}

async function fetchAttendanceEntries(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tableName: "task_progress_attendance" | "category_progress_attendance",
  entryIds: number[]
) {
  if (entryIds.length === 0) return [];
  const chunkSize = 200;
  const allRows: { progress_entry_id: number; worker_name: string; hours: number; hourly_rate: number }[] = [];
  for (let i = 0; i < entryIds.length; i += chunkSize) {
    const chunk = entryIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from(tableName)
      .select("progress_entry_id, worker_name, hours, hourly_rate")
      .in("progress_entry_id", chunk);
    if (error && error.code !== "PGRST205" && error.code !== "42P01") {
      console.error(`[listProgressExpenses] ${tableName} query failed:`, error.message);
    }
    if (data) allRows.push(...data);
  }
  return allRows;
}

/** Current saved costs in all four categories, shared by Expenses and Equipment.
 * Never sum the append-only audit history: re-saving a day replaces its expense.
 * Material expenses come only from recorded purchases, never usage valuations.
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

  const taskEntryIds = (taskEntries ?? []).map((row) => row.id);
  const categoryEntryIds = (categoryEntries ?? []).map((row) => row.id);

  const [taskEquipmentRows, categoryEquipmentRows, taskOtherRows, categoryOtherRows, taskAttendanceRows, categoryAttendanceRows] = await Promise.all([
    fetchCostEntries(supabase, "task_progress_equipment_cost_entries", taskEntryIds),
    fetchCostEntries(supabase, "category_progress_equipment_cost_entries", categoryEntryIds),
    fetchCostEntries(supabase, "task_progress_other_cost_entries", taskEntryIds),
    fetchCostEntries(supabase, "category_progress_other_cost_entries", categoryEntryIds),
    fetchAttendanceEntries(supabase, "task_progress_attendance", taskEntryIds),
    fetchAttendanceEntries(supabase, "category_progress_attendance", categoryEntryIds),
  ]);

  const taskEquipmentMap = new Map<number, ProgressEquipmentCostItem[]>();
  for (const row of taskEquipmentRows) {
    const list = taskEquipmentMap.get(row.progress_entry_id) ?? [];
    list.push({
      name: row.cost_name,
      amount: Number(row.amount) || 0,
      unplanned: Boolean(row.unplanned),
    });
    taskEquipmentMap.set(row.progress_entry_id, list);
  }

  const categoryEquipmentMap = new Map<number, ProgressEquipmentCostItem[]>();
  for (const row of categoryEquipmentRows) {
    const list = categoryEquipmentMap.get(row.progress_entry_id) ?? [];
    list.push({
      name: row.cost_name,
      amount: Number(row.amount) || 0,
      unplanned: Boolean(row.unplanned),
    });
    categoryEquipmentMap.set(row.progress_entry_id, list);
  }

  const makeCostMap = (rows: typeof taskOtherRows) => {
    const map = new Map<number, ProgressEquipmentCostItem[]>();
    for (const row of rows) {
      const list = map.get(row.progress_entry_id) ?? [];
      list.push({ name: row.cost_name, amount: Number(row.amount) || 0, unplanned: Boolean(row.unplanned) });
      map.set(row.progress_entry_id, list);
    }
    return map;
  };
  const taskOtherMap = makeCostMap(taskOtherRows);
  const categoryOtherMap = makeCostMap(categoryOtherRows);

  const makeAttendanceMap = (rows: typeof taskAttendanceRows) => {
    const map = new Map<number, { name: string; hours: number; rate: number }[]>();
    for (const row of rows) {
      const list = map.get(row.progress_entry_id) ?? [];
      list.push({ name: row.worker_name, hours: Number(row.hours) || 0, rate: Number(row.hourly_rate) || 0 });
      map.set(row.progress_entry_id, list);
    }
    return map;
  };
  const taskAttendanceMap = makeAttendanceMap(taskAttendanceRows);
  const categoryAttendanceMap = makeAttendanceMap(categoryAttendanceRows);

  const costs: (ProgressExpense & { createdAt: string; recordedBy: string | null })[] = [];
  for (const purchase of await listMaterialPurchases(projectId)) {
    costs.push({id:`purchase-${purchase.id}`,entryDate:purchase.purchase_date,
      itemName:purchase.material_name,itemKey:`purchase-${purchase.id}`,
      supplier:purchase.supplier,invoiceNumber:purchase.invoice_number,
      materialPurchase:{quantity:Number(purchase.quantity)||0,unit:purchase.unit,unitPrice:Number(purchase.unit_price)||0},
      costs:{material:Number(purchase.amount),equipment:0,labor:0,other:0},
      savedByName:null,createdAt:purchase.created_at,recordedBy:purchase.recorded_by});
  }
  for (const row of taskEntries ?? []) {
    const amounts = { material: 0, equipment: Number(row.equipment_cost) || 0, labor: Number(row.labor_cost) || 0, other: Number(row.other_cost) || 0 };
    if (!Object.values(amounts).some((amount) => amount > 0)) continue;
    costs.push({
      id: `task-${row.id}`,
      entryDate: row.entry_date,
      itemName: taskName.get(row.task_id) ?? "",
      itemKey: `task-${row.task_id}`,
      costs: amounts,
      savedByName: null,
      equipmentItems: taskEquipmentMap.get(row.id),
      otherItems: taskOtherMap.get(row.id),
      attendance: taskAttendanceMap.get(row.id),
      createdAt: row.created_at,
      recordedBy: row.recorded_by ?? null,
    });
  }
  for (const row of categoryEntries ?? []) {
    const amounts = { material: 0, equipment: Number(row.equipment_cost) || 0, labor: Number(row.labor_cost) || 0, other: Number(row.other_cost) || 0 };
    if (!Object.values(amounts).some((amount) => amount > 0)) continue;
    costs.push({
      id: `category-${row.id}`,
      entryDate: row.entry_date,
      itemName: categoryName.get(row.category_id) ?? "",
      itemKey: `category-${row.category_id}`,
      costs: amounts,
      savedByName: null,
      equipmentItems: categoryEquipmentMap.get(row.id),
      otherItems: categoryOtherMap.get(row.id),
      attendance: categoryAttendanceMap.get(row.id),
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
