import type { createClient } from "@/lib/supabase/server";
import {
  groupPlannedMaterials,
  itemizedMaterialCost,
  materialKey,
} from "@/lib/task-progress/calculate";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const LINE_COLUMNS = "material_name, unit, planned_quantity, unit_cost, amount";

/**
 * Prices a day's materials used from the task's (or task-less phase's)
 * own Material Breakdown lines, at the estimate's unit costs — the
 * itemized part of that day's material cost, the same way the progress
 * window shows it (itemizedMaterialCost). Priced here on save rather than
 * trusted from the window, like labor from attendance.
 */
export async function priceMaterialsUsed(
  supabase: Supabase,
  item: { taskId: number } | { categoryId: number },
  used: { name: string; unit: string | null; quantity: number }[]
): Promise<{ cost: number } | { error: string }> {
  if (!used.some((material) => material.quantity > 0)) return { cost: 0 };

  const { data, error } =
    "taskId" in item
      ? await supabase
          .from("estimate_task_material_assignments")
          .select(LINE_COLUMNS)
          .eq("task_id", item.taskId)
      : await supabase
          .from("estimate_category_material_assignments")
          .select(LINE_COLUMNS)
          .eq("category_id", item.categoryId);

  if (error) {
    console.error("[material-cost] Material lines query failed:", error.message);
    return { error: "Could not price the materials used. Please try again." };
  }

  const planned = groupPlannedMaterials(
    (data ?? []).map((row) => ({
      materialName: row.material_name,
      unit: row.unit,
      plannedQuantity: Number(row.planned_quantity) || 0,
      unitCost: Number(row.unit_cost) || 0,
      amountOverride: row.amount === null ? null : Number(row.amount),
    }))
  );
  const usedByKey: Record<string, number> = {};
  for (const material of used) {
    const key = materialKey(material.name, material.unit);
    usedByKey[key] = (usedByKey[key] ?? 0) + material.quantity;
  }
  return { cost: itemizedMaterialCost(planned, usedByKey) };
}
