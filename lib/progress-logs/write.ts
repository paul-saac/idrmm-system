import type { createClient } from "@/lib/supabase/server";
import type { SessionProfile } from "@/lib/auth/session";
import type { OverrideLog, OverrideLogItem } from "@/lib/progress-logs/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Adds one row to a task's or phase's override history (0071), as the
 * signed-in user, once a save or a delete has gone through. Best effort:
 * a failure is logged rather than returned, so a database without 0071
 * yet still saves progress — just without the history.
 */
export async function logOverride(
  supabase: Supabase,
  profile: SessionProfile,
  projectId: number,
  item: OverrideLogItem,
  log: Omit<OverrideLog, "id" | "createdAt" | "savedByName" | "savedByRole">
) {
  const basePayload = {
    project_id: projectId,
    task_id: item.kind === "task" ? item.id : null,
    category_id: item.kind === "category" ? item.id : null,
    entry_date: log.entryDate,
    action: log.action,
    quantity_completed: log.quantityCompleted,
    labor_cost: log.costs.labor,
    material_cost: log.costs.material,
    equipment_cost: log.costs.equipment,
    other_cost: log.costs.other,
    materials_used: log.materialsUsed,
    attendance: log.attendance,
    saved_by: profile.id,
    saved_by_name: `${profile.firstName} ${profile.lastName}`.trim() || null,
  };

  let { error } = await supabase.from("progress_override_logs").insert({
    ...basePayload,
    ...(log.equipmentCosts ? { equipment_costs: log.equipmentCosts } : {}),
    ...(log.otherCosts ? { other_costs: log.otherCosts } : {}),
  } as typeof basePayload);

  if (error && (error.code === "PGRST204" || error.code === "42703")) {
    ({ error } = await supabase.from("progress_override_logs").insert({
      ...basePayload,
      ...(log.otherCosts ? { other_costs: log.otherCosts } : {}),
    } as typeof basePayload));
  }

  if (error && (error.code === "PGRST204" || error.code === "42703")) {
    ({ error } = await supabase.from("progress_override_logs").insert(basePayload));
  }

  if (error) {
    console.error("[progress-logs] Could not add to the override history:", error.message);
  }
}
