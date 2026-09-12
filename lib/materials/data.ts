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

export type MaterialUsageHistoryEntry = {
  id: number;
  dailyLogId: number;
  logDate: string;
  materialCode: string;
  materialName: string;
  specification: string | null;
  quantity: number;
  unit: string | null;
  status: MaterialStatus;
  activity: string | null;
  remarks: string | null;
};

/**
 * The Materials tab's "Usage logs" sub-tab — every Material Usage Log
 * item ever submitted on any of the project's Daily Logs (regardless of
 * that daily log's review status; this is a raw history, not "what's
 * actually reflected in stock" — that's project_materials.status, kept
 * current by *approved* logs only, see updateDailyLogStatus). Quantity/
 * Unit are read live off project_materials rather than stored per item,
 * same as everywhere else this app shows a material's quantity — the
 * Add Usage Log form doesn't collect one.
 */
export async function listMaterialUsageHistory(
  projectId: number
): Promise<MaterialUsageHistoryEntry[]> {
  const supabase = await createClient();

  const { data: logs } = await supabase
    .from("daily_logs")
    .select("id, log_date")
    .eq("project_id", projectId);

  const logIds = (logs ?? []).map((log) => log.id);
  if (logIds.length === 0) return [];

  const logById = new Map((logs ?? []).map((log) => [log.id, log]));

  const { data: items } = await supabase
    .from("daily_log_material_usage_items")
    .select("id, daily_log_id, project_material_id, status, activity, remarks")
    .in("daily_log_id", logIds);

  const materialIds = Array.from(
    new Set((items ?? []).map((item) => item.project_material_id))
  );
  const { data: materials } =
    materialIds.length > 0
      ? await supabase
          .from("project_materials")
          .select("id, material_code, material_name, specification, quantity, unit")
          .in("id", materialIds)
      : { data: [] as { id: number; material_code: string; material_name: string; specification: string | null; quantity: number; unit: string | null }[] };

  const materialById = new Map((materials ?? []).map((m) => [m.id, m]));

  const entries: MaterialUsageHistoryEntry[] = (items ?? []).map((item) => {
    const log = logById.get(item.daily_log_id);
    const material = materialById.get(item.project_material_id);
    return {
      id: item.id,
      dailyLogId: item.daily_log_id,
      logDate: log?.log_date ?? "",
      materialCode: material?.material_code ?? "—",
      materialName: material?.material_name ?? "—",
      specification: material?.specification ?? null,
      quantity: material?.quantity ?? 0,
      unit: material?.unit ?? null,
      status: item.status,
      activity: item.activity,
      remarks: item.remarks,
    };
  });

  return entries.sort(
    (a, b) => b.logDate.localeCompare(a.logDate) || b.id - a.id
  );
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
