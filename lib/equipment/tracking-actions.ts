"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProjectAccess } from "@/lib/auth/project-access";
import { revalidateInventory, revalidateProjectPaths } from "@/lib/projects/revalidate";
import type { EquipmentOperation, EquipmentTracking } from "./tracking-types";

export async function loadEquipmentTracking(projectId: number): Promise<{ data?: EquipmentTracking; error?: string }> {
  if (!await requireProjectAccess(projectId)) return { error: "You cannot access this project's equipment." };
  const db = await createClient();
  const { data, error } = await db.rpc("equipment_tracking_data", { p_project_id: projectId });
  if (error) return { error: "Could not load equipment tracking. Check that migration 0087 has been applied." };
  return { data: data as EquipmentTracking };
}

export async function saveEquipmentOperation(projectId: number, input: EquipmentOperation): Promise<{ error?: string }> {
  if (!await requireProjectAccess(projectId)) return { error: "You cannot manage this project's equipment." };
  if (!input || !Number.isSafeInteger(input.equipmentId) || input.equipmentId <= 0 || !/^(task|category)-[1-9]\d*$/.test(input.itemKey)) {
    return { error: "Select valid equipment and a task." };
  }
  const db = await createClient();
  const { error } = await db.rpc("record_equipment_operation", { p_project_id: projectId, p_input: input });
  if (error) {
    console.error("[equipment movement]", error.code, error.message);
    return { error: error.code === "P0001" ? error.message : "Could not save the equipment record. Refresh and retry; check migration 0087 if this persists." };
  }
  revalidateInventory();
  revalidateProjectPaths(projectId);
  return {};
}

export async function saveEquipmentPlans(projectId: number, itemKey: string, selected: number[], previous: number[]): Promise<{ error?: string }> {
  if (!await requireProjectAccess(projectId)) return { error: "You cannot manage this project's equipment." };
  if (!/^(task|category)-[1-9]\d*$/.test(itemKey) || !Array.isArray(selected) || !Array.isArray(previous)
    || [...selected, ...previous].some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    return { error: "Select valid equipment and a task." };
  }
  const db = await createClient();
  const { error } = await db.rpc("save_equipment_task_plans", {
    p_project_id: projectId, p_item_key: itemKey, p_selected: selected, p_previous: previous,
  });
  if (error) return { error: error.code === "P0001" ? error.message : "Could not save assignments. Check migration 0088 and retry." };
  revalidateProjectPaths(projectId);
  return {};
}
