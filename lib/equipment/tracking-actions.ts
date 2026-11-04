"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProjectAccess } from "@/lib/auth/project-access";
import { revalidateProjectPaths } from "@/lib/projects/revalidate";
import { equipmentAllocationError } from "./allocation-error";
import type { EquipmentConflict, EquipmentTracking } from "./tracking-types";

export async function loadEquipmentTracking(projectId: number): Promise<{ data?: EquipmentTracking; error?: string }> {
  if (!await requireProjectAccess(projectId, "view")) return { error: "You cannot access this project's equipment." };
  const db = await createClient();
  const { data, error } = await db.rpc("equipment_tracking_data", { p_project_id: projectId });
  if (error) return { error: "Could not load equipment planning. Please try again." };
  return { data: data as EquipmentTracking };
}

export async function saveEquipmentPlans(projectId: number, itemKey: string, selected: number[], previous: number[]): Promise<{ error?: string; conflict?: EquipmentConflict }> {
  if (!await requireProjectAccess(projectId)) return { error: "You cannot manage this project's equipment." };
  if (!/^(task|category)-[1-9]\d*$/.test(itemKey) || !Array.isArray(selected) || !Array.isArray(previous)
    || [...selected, ...previous].some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    return { error: "Select valid equipment and a task." };
  }
  const db = await createClient();
  const { error } = await db.rpc("save_equipment_task_plans", {
    p_project_id: projectId, p_item_key: itemKey, p_selected: selected, p_previous: previous,
  });
  if (error) return { conflict: equipmentAllocationError(error), error: ["P0001", "22023", "40001"].includes(error.code) ? error.message
    : error.code === "55000" ? "Saving is temporarily paused. Please try again later."
    : "Could not save equipment planning. Please try again." };
  revalidateProjectPaths(projectId);
  return {};
}
