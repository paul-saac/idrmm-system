import { createClient } from "@/lib/supabase/server";

export type MaterialStatus = "available" | "low_stock" | "fully_consumed";

export type ProjectMaterial = {
  id: number;
  materialCode: string;
  materialName: string;
  specification: string | null;
  quantity: number;
  unit: string | null;
  status: MaterialStatus;
  lastUpdated: string;
};

export type MaterialsOverviewCounts = {
  totalMaterials: number;
  availableMaterials: number;
  lowStockMaterials: number;
  consumedMaterials: number;
};

/**
 * The Materials Monitoring tab's "Material Record Table" — every stock
 * line item a project is tracking, newest-updated first.
 */
export async function listProjectMaterials(
  projectId: number
): Promise<ProjectMaterial[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("project_materials")
    .select(
      "id, material_code, material_name, specification, quantity, unit, status, updated_at"
    )
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false });

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    materialCode: row.material_code,
    materialName: row.material_name,
    specification: row.specification,
    quantity: row.quantity ?? 0,
    unit: row.unit,
    status: row.status,
    lastUpdated: row.updated_at,
  }));
}

/**
 * Powers the Materials Overview cards (Total/Available/Low Stock/
 * Consumed) — derived from the same rows as listProjectMaterials rather
 * than a separate query, since the whole table is cheap to hold in
 * memory (one project's material records, not a global table).
 */
export function summarizeMaterials(
  materials: ProjectMaterial[]
): MaterialsOverviewCounts {
  return {
    totalMaterials: materials.length,
    availableMaterials: materials.filter((m) => m.status === "available")
      .length,
    lowStockMaterials: materials.filter((m) => m.status === "low_stock")
      .length,
    consumedMaterials: materials.filter((m) => m.status === "fully_consumed")
      .length,
  };
}

export type MaterialBreakdownEntry = {
  id: number;
  /** Unique across both line tables — a task's and a category's own
   * line can share an id. */
  key: string;
  materialName: string;
  specification: string | null;
  plannedQuantity: number;
  unit: string | null;
  unitCost: number;
  /** amountOverride if one was typed directly, otherwise plannedQuantity
   * * unitCost — the same effective-amount formula the Material
   * Breakdown modal's own live "Amount" column uses (see
   * material-breakdown-modal-content.tsx's own lineAmount). */
  amount: number;
  /** Null for a standalone category's own line (0058). */
  taskName: string | null;
  categoryName: string;
  /** The task (task-<id>) or task-less phase (category-<id>) it's on. */
  itemKey: string;
};

/**
 * Every material line item entered in the Cost Estimate Breakdown's own
 * Material Breakdown modal (estimate_task_material_assignments) — a
 * read-only reflection for the Materials Monitoring sub-tab, purely for
 * visibility. Deliberately NOT linked to project_materials (the actual
 * stock roster listProjectMaterials above reads): these are free-text
 * cost-planning lines, entered either by typing directly into Material
 * Breakdown or (eventually) via the Import Bill of Materials flow — see
 * ImportBomModalContent's own doc comment, which is currently a UI-only
 * preview that never actually writes a row. Whichever way a line gets
 * created, it lands in the same table, so this reads it back the same
 * way either time with nothing extra to distinguish the two.
 *
 * A standalone category's own itemized lines (estimate_category_material_
 * assignments, 0058) are listed too. Its direct material line
 * (material_direct_quantity/unit/unit_cost on estimate_categories itself,
 * see 0042_category_direct_cost.sql) is deliberately excluded — it has no
 * material_name column at all, just a lump-sum quantity/cost, so there's
 * no material identity to list here.
 */
export async function listMaterialBreakdownEntries(
  projectId: number
): Promise<MaterialBreakdownEntry[]> {
  const supabase = await createClient();

  const { data: categoryRows } = await supabase
    .from("estimate_categories")
    .select("id, category_name")
    .eq("project_id", projectId);

  const categoryIds = (categoryRows ?? []).map((row) => row.id);
  if (categoryIds.length === 0) return [];
  const categoryById = new Map((categoryRows ?? []).map((c) => [c.id, c]));

  const { data: taskRows } = await supabase
    .from("estimate_tasks")
    .select("id, task_name, category_id")
    .in("category_id", categoryIds);

  const taskIds = (taskRows ?? []).map((row) => row.id);
  const taskById = new Map((taskRows ?? []).map((t) => [t.id, t]));

  const lineColumns =
    "id, material_name, specification, planned_quantity, unit, unit_cost, amount";
  const [{ data: assignmentRows }, { data: categoryLineRows }] = await Promise.all([
    taskIds.length > 0
      ? supabase
          .from("estimate_task_material_assignments")
          .select(`task_id, ${lineColumns}`)
          .in("task_id", taskIds)
          .order("id", { ascending: true })
      : Promise.resolve({ data: [] as never[] }),
    // Empty (null data), not an error, until 0058 has run.
    supabase
      .from("estimate_category_material_assignments")
      .select(`category_id, ${lineColumns}`)
      .in("category_id", categoryIds)
      .order("id", { ascending: true }),
  ]);

  function toEntry(
    row: {
      id: number;
      material_name: string;
      specification: string | null;
      planned_quantity: number | null;
      unit: string | null;
      unit_cost: number | null;
      amount: number | null;
    },
    key: string,
    categoryId: number | undefined,
    taskName: string | null,
    itemKey: string
  ): MaterialBreakdownEntry {
    const plannedQuantity = row.planned_quantity ?? 0;
    const unitCost = row.unit_cost ?? 0;
    return {
      id: row.id,
      key,
      materialName: row.material_name,
      specification: row.specification,
      plannedQuantity,
      unit: row.unit,
      unitCost,
      amount: row.amount ?? plannedQuantity * unitCost,
      taskName,
      categoryName:
        (categoryId !== undefined && categoryById.get(categoryId)?.category_name) || "—",
      itemKey,
    };
  }

  const entries: MaterialBreakdownEntry[] = [];
  for (const row of categoryLineRows ?? []) {
    entries.push(
      toEntry(row, `category-${row.id}`, row.category_id, null, `category-${row.category_id}`)
    );
  }
  for (const row of assignmentRows ?? []) {
    const task = taskById.get(row.task_id);
    if (!task) continue;
    entries.push(
      toEntry(row, `task-${row.id}`, task.category_id, task.task_name, `task-${task.id}`)
    );
  }
  return entries;
}

/** One material used on a day's progress override — the Materials tab's
 * recent activity. */
export type ProgressMaterialUsage = {
  id: string;
  entryDate: string;
  /** The task, or task-less phase, it was used on. */
  itemName: string;
  /** Which: task-<id> or category-<id>. */
  itemKey: string;
  materialName: string;
  unit: string | null;
  quantity: number;
  /** Set for a material that isn't on the task's own planned lines — the
   * unit cost typed for it (0073); null for a planned one. */
  unitCost: number | null;
};

/**
 * Every material used, as logged in the progress window's Materials used
 * today (task_progress_material_entries, and a task-less phase's
 * category_progress_material_entries) — newest day first, then newest
 * save. The Materials tab's recent activity is the first few.
 */
export async function listProgressMaterialUsage(
  projectId: number
): Promise<ProgressMaterialUsage[]> {
  const supabase = await createClient();

  const [{ data: tasks }, { data: categories }] = await Promise.all([
    supabase.from("estimate_tasks").select("id, task_name").eq("project_id", projectId),
    supabase.from("estimate_categories").select("id, category_name").eq("project_id", projectId),
  ]);
  const taskName = new Map((tasks ?? []).map((row) => [row.id, row.task_name]));
  const categoryName = new Map((categories ?? []).map((row) => [row.id, row.category_name]));

  const [{ data: taskEntries }, { data: categoryEntries }] = await Promise.all([
    taskName.size > 0
      ? supabase
          .from("task_progress_entries")
          .select("id, task_id, entry_date")
          .in("task_id", [...taskName.keys()])
      : Promise.resolve({ data: [] as { id: number; task_id: number; entry_date: string }[] }),
    categoryName.size > 0
      ? supabase
          .from("category_progress_entries")
          .select("id, category_id, entry_date")
          .in("category_id", [...categoryName.keys()])
      : Promise.resolve({ data: [] as { id: number; category_id: number; entry_date: string }[] }),
  ]);
  const taskEntry = new Map((taskEntries ?? []).map((row) => [row.id, row]));
  const categoryEntry = new Map((categoryEntries ?? []).map((row) => [row.id, row]));

  // "*" so a DB without 0073's unit_cost yet still loads.
  const [{ data: taskUsage }, { data: categoryUsage }] = await Promise.all([
    taskEntry.size > 0
      ? supabase
          .from("task_progress_material_entries")
          .select("*")
          .in("progress_entry_id", [...taskEntry.keys()])
      : Promise.resolve({ data: [] }),
    categoryEntry.size > 0
      ? supabase
          .from("category_progress_material_entries")
          .select("*")
          .in("progress_entry_id", [...categoryEntry.keys()])
      : Promise.resolve({ data: [] }),
  ]);
  const unitCostOf = (value: number | null | undefined) =>
    value === null || value === undefined ? null : Number(value) || 0;

  const usage: (ProgressMaterialUsage & { createdAt: string })[] = [];
  for (const row of taskUsage ?? []) {
    const entry = taskEntry.get(row.progress_entry_id);
    if (!entry) continue;
    usage.push({
      id: `task-${row.id}`,
      entryDate: entry.entry_date,
      itemName: taskName.get(entry.task_id) ?? "",
      itemKey: `task-${entry.task_id}`,
      materialName: row.material_name,
      unit: row.unit,
      quantity: Number(row.quantity_used) || 0,
      unitCost: unitCostOf(row.unit_cost),
      createdAt: row.created_at,
    });
  }
  for (const row of categoryUsage ?? []) {
    const entry = categoryEntry.get(row.progress_entry_id);
    if (!entry) continue;
    usage.push({
      id: `category-${row.id}`,
      entryDate: entry.entry_date,
      itemName: categoryName.get(entry.category_id) ?? "",
      itemKey: `category-${entry.category_id}`,
      materialName: row.material_name,
      unit: row.unit,
      quantity: Number(row.quantity_used) || 0,
      unitCost: unitCostOf(row.unit_cost),
      createdAt: row.created_at,
    });
  }

  return usage
    .sort(
      (a, b) =>
        b.entryDate.localeCompare(a.entryDate) || b.createdAt.localeCompare(a.createdAt)
    )
    .map(({ createdAt: _createdAt, ...rest }) => rest);
}
