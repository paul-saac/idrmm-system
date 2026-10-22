"use server";

import { revalidateProjectPaths } from "@/lib/projects/revalidate";
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireProjectAccess } from "@/lib/auth/project-access";
import { isAdminRole } from "@/lib/auth/roles";
import { logOverride } from "@/lib/progress-logs/write";
import { entryCosts } from "@/lib/task-progress/data";
import { priceMaterialsUsed, readUnplannedMaterials } from "@/lib/task-progress/material-cost";
import {
  COST_COMPONENTS,
  type CostAmounts,
  type UnplannedMaterial,
  type UnplannedOtherCost,
} from "@/lib/task-progress/calculate";
import {
  replaceAttendance,
  resolveAttendance,
  type AttendanceInput,
} from "@/lib/task-progress/attendance";

export type TaskProgressActionState = {
  error?: string;
  success?: boolean;
};

function logSupabaseError(label: string, error: PostgrestError) {
  console.error(label, {
    message: error.message,
    code: error.code,
    details: error.details,
    hint: error.hint,
  });
}

async function safely(
  run: () => Promise<TaskProgressActionState>
): Promise<TaskProgressActionState> {
  try {
    return await run();
  } catch (error) {
    console.error("[task-progress] Unexpected error:", error);
    return { error: "Something went wrong. Please try again." };
  }
}

function todayIso() {
  return new Date().toLocaleDateString("en-CA");
}

/**
 * Saves one task's Progress Tracking Override for *today* — the Gantt
 * Chart bar-click modal's own Save action. Always writes to today's own
 * date (see todayIso above; there's no date picker in the modal, this
 * isn't a historical backfill tool) — reopening the modal later the
 * same day and saving again corrects today's entry in place rather than
 * creating a second one, via the DB's own unique(task_id, entry_date)
 * constraint.
 *
 * Materials used are logged against the task's own planned material
 * lines (task_progress_material_entries, see 0050_task_progress_
 * material_entries.sql) — replaced wholesale for this day on every
 * save, so correcting today's numbers never double-counts. Never touches
 * project_materials stock.
 *
 * The day's spend per cost component (0057_progress_entry_costs.sql) is
 * what the task's % complete is measured from — saving a day overrides
 * its automatic planned share (see computeProgressBreakdown). Its labor
 * is priced from who worked (hours × each one's Default Rate) when anyone's
 * listed, else typed like equipment and other cost.
 */
export async function recordTaskProgress(
  taskId: number,
  projectId: number,
  input: {
    quantityCompletedToday: number;
    /** Material is just typed only for a task without Material Breakdown
     * lines — what's used is priced here. */
    costs: CostAmounts;
    materialsUsed: { name: string; unit: string | null; quantity: number }[];
    /** Materials used that aren't on the task's own lines (0073), each at
     * the unit cost typed for it — priced here as quantity × unit cost. */
    unplannedMaterials?: UnplannedMaterial[];
    /** Spend against planned Equipment Cost items today (0089). */
    equipmentCostsUsed?: { name: string; amount: number }[];
    /** Additional Equipment Cost items added on the spot today (0089). */
    unplannedEquipmentCosts?: UnplannedOtherCost[];
    /** Spend against planned Other Cost items today (0084). */
    otherCostsUsed?: { name: string; amount: number }[];
    /** Additional Other Cost items added on the spot today (0084). */
    unplannedOtherCosts?: UnplannedOtherCost[];
    /** Who worked and their hours — when anyone's listed, the day's labor
     * is priced from it (hours × Default Rate) instead of costs.labor. */
    attendance?: AttendanceInput;
  }
): Promise<TaskProgressActionState> {
  return safely(async () => {
    const profile = await requireProjectAccess(projectId);
    if (!profile) {
      return { error: "You are not authorized to record task progress." };
    }
    if (
      !Number.isFinite(input.quantityCompletedToday) ||
      input.quantityCompletedToday < 0
    ) {
      return { error: "Quantity completed can't be negative." };
    }
    for (const material of input.materialsUsed) {
      if (!Number.isFinite(material.quantity) || material.quantity < 0) {
        return { error: "Material quantity used can't be negative." };
      }
    }
    const unplanned = readUnplannedMaterials(input.unplannedMaterials);
    if ("error" in unplanned) {
      return { error: unplanned.error };
    }
    const equipmentCostsUsed = input.equipmentCostsUsed ?? [];
    for (const item of equipmentCostsUsed) {
      if (!Number.isFinite(item.amount) || item.amount < 0) {
        return { error: "Equipment cost amount can't be negative." };
      }
    }
    const unplannedEquipment: UnplannedOtherCost[] = [];
    for (const item of input.unplannedEquipmentCosts ?? []) {
      const name = item.name.trim();
      if (!Number.isFinite(item.amount) || item.amount < 0) {
        return { error: "Equipment cost amount can't be negative." };
      }
      if (!name && item.amount === 0) continue;
      if (!name) {
        return { error: "Enter a description for each added equipment cost." };
      }
      unplannedEquipment.push({ name, amount: item.amount });
    }
    const otherCostsUsed = input.otherCostsUsed ?? [];
    for (const item of otherCostsUsed) {
      if (!Number.isFinite(item.amount) || item.amount < 0) {
        return { error: "Other cost amount can't be negative." };
      }
    }
    const unplannedOther: UnplannedOtherCost[] = [];
    for (const item of input.unplannedOtherCosts ?? []) {
      const name = item.name.trim();
      if (!Number.isFinite(item.amount) || item.amount < 0) {
        return { error: "Other cost amount can't be negative." };
      }
      if (!name && item.amount === 0) continue;
      if (!name) {
        return { error: "Enter a name for each added other cost." };
      }
      unplannedOther.push({ name, amount: item.amount });
    }
    if (
      COST_COMPONENTS.some(
        (component) =>
          !Number.isFinite(input.costs[component]) || input.costs[component] < 0
      )
    ) {
      return { error: "Costs must be 0 or more." };
    }

    const supabase = await createClient();
    const entryDate = todayIso();

    const crew = await resolveAttendance(supabase, input.attendance ?? [], entryDate, { taskId });
    if ("error" in crew) {
      return { error: crew.error };
    }
    // Labor: with anyone's hours logged, each person's hours × their own
    // Default Rate, priced here (never the browser's figure); otherwise
    // typed.
    const laborCost = crew.rows.length > 0 ? crew.laborCost : input.costs.labor;

    // Material cost: what was used, priced from the task's own Material
    // Breakdown — or, without any lines, typed — plus any materials not
    // on its lines, each at its own unit cost.
    const priced = await priceMaterialsUsed(supabase, { taskId }, input.materialsUsed);
    if ("error" in priced) {
      return { error: priced.error };
    }
    // Material usage affects stock only. Purchases are recorded separately.
    const materialCost = 0;

    const itemizedEquipment =
      equipmentCostsUsed.reduce((sum, item) => sum + item.amount, 0) +
      unplannedEquipment.reduce((sum, item) => sum + item.amount, 0);
    const equipmentCost = Math.round((itemizedEquipment + input.costs.equipment) * 100) / 100;

    const itemizedOther =
      otherCostsUsed.reduce((sum, item) => sum + item.amount, 0) +
      unplannedOther.reduce((sum, item) => sum + item.amount, 0);
    const otherCost = Math.round((itemizedOther + input.costs.other) * 100) / 100;

    const { data: savedEntry, error: upsertError } = await supabase
      .from("task_progress_entries")
      .upsert(
        {
          task_id: taskId,
          entry_date: entryDate,
          quantity_completed: input.quantityCompletedToday,
          labor_cost: laborCost,
          material_cost: materialCost,
          equipment_cost: equipmentCost,
          other_cost: otherCost,
          recorded_by: profile.id,
        },
        { onConflict: "task_id,entry_date" }
      )
      .select("id")
      .single();

    if (upsertError || !savedEntry) {
      if (upsertError) {
        logSupabaseError(
          "[recordTaskProgress] Supabase entry upsert failed",
          upsertError
        );
      }
      return { error: "Could not save progress. Please try again." };
    }

    const attendanceError = await replaceAttendance(supabase, "task", savedEntry.id, crew.rows);
    if (attendanceError) {
      return { error: attendanceError };
    }

    const { error: deleteError } = await supabase
      .from("task_progress_material_entries")
      .delete()
      .eq("progress_entry_id", savedEntry.id);

    if (deleteError) {
      logSupabaseError(
        "[recordTaskProgress] Supabase old material entries delete failed",
        deleteError
      );
      return { error: "Could not save materials used. Please try again." };
    }

    const plannedRows = input.materialsUsed
      .filter((material) => material.quantity > 0 && material.name.trim())
      .map((material) => ({
        progress_entry_id: savedEntry.id,
        material_name: material.name.trim(),
        unit: material.unit?.trim() || null,
        quantity_used: material.quantity,
      }));
    // Its own unit cost marks one not on the lines — only sent when
    // there is one, so a DB without 0073 yet still saves the rest.
    const unplannedRows = unplanned.materials.map((material) => ({
      progress_entry_id: savedEntry.id,
      material_name: material.name,
      unit: material.unit,
      quantity_used: material.quantity,
      unit_cost: material.unitCost,
    }));
    const materialRows = [...plannedRows, ...unplannedRows];

    if (materialRows.length > 0) {
      const { error: insertError } = await supabase
        .from("task_progress_material_entries")
        .insert(materialRows);

      if (insertError) {
        logSupabaseError(
          "[recordTaskProgress] Supabase material entries insert failed",
          insertError
        );
        return { error: "Could not save materials used. Please try again." };
      }
    }

    const plannedOtherRows = otherCostsUsed
      .filter((item) => item.amount > 0 && item.name.trim())
      .map((item) => ({
        progress_entry_id: savedEntry.id,
        cost_name: item.name.trim(),
        amount: item.amount,
        unplanned: false,
      }));
    const unplannedOtherRows = unplannedOther
      .filter((item) => item.amount > 0)
      .map((item) => ({
        progress_entry_id: savedEntry.id,
        cost_name: item.name,
        amount: item.amount,
        unplanned: true,
      }));
    const otherCostRows = [...plannedOtherRows, ...unplannedOtherRows];

    const otherCostTable = (
      supabase as unknown as {
        from: (table: string) => {
          delete: () => {
            eq: (col: string, val: number) => Promise<{ error: PostgrestError | null }>;
          };
          insert: (rows: unknown[]) => Promise<{ error: PostgrestError | null }>;
        };
      }
    ).from("task_progress_other_cost_entries");

    const { error: deleteOtherError } = await otherCostTable
      .delete()
      .eq("progress_entry_id", savedEntry.id);

    if (
      deleteOtherError &&
      deleteOtherError.code !== "PGRST205" &&
      deleteOtherError.code !== "42P01"
    ) {
      logSupabaseError(
        "[recordTaskProgress] Supabase old other cost entries delete failed",
        deleteOtherError
      );
      return { error: "Could not save other costs. Please try again." };
    }

    if (!deleteOtherError && otherCostRows.length > 0) {
      const { error: insertOtherError } = await otherCostTable.insert(otherCostRows);
      if (
        insertOtherError &&
        insertOtherError.code !== "PGRST205" &&
        insertOtherError.code !== "42P01"
      ) {
        logSupabaseError(
          "[recordTaskProgress] Supabase other cost entries insert failed",
          insertOtherError
        );
        return { error: "Could not save other costs. Please try again." };
      }
    }

    const plannedEquipmentRows = equipmentCostsUsed
      .filter((item) => item.amount > 0 && item.name.trim())
      .map((item) => ({
        progress_entry_id: savedEntry.id,
        cost_name: item.name.trim(),
        amount: item.amount,
        unplanned: false,
      }));
    const unplannedEquipmentRows = unplannedEquipment
      .filter((item) => item.amount > 0)
      .map((item) => ({
        progress_entry_id: savedEntry.id,
        cost_name: item.name,
        amount: item.amount,
        unplanned: true,
      }));
    const equipmentCostRows = [...plannedEquipmentRows, ...unplannedEquipmentRows];

    const equipmentCostTable = (
      supabase as unknown as {
        from: (table: string) => {
          delete: () => {
            eq: (col: string, val: number) => Promise<{ error: PostgrestError | null }>;
          };
          insert: (rows: unknown[]) => Promise<{ error: PostgrestError | null }>;
        };
      }
    ).from("task_progress_equipment_cost_entries");

    const { error: deleteEquipmentError } = await equipmentCostTable
      .delete()
      .eq("progress_entry_id", savedEntry.id);

    if (
      deleteEquipmentError &&
      deleteEquipmentError.code !== "PGRST205" &&
      deleteEquipmentError.code !== "42P01"
    ) {
      logSupabaseError(
        "[recordTaskProgress] Supabase old equipment cost entries delete failed",
        deleteEquipmentError
      );
      return { error: "Could not save equipment costs. Please try again." };
    }

    if (!deleteEquipmentError && equipmentCostRows.length > 0) {
      const { error: insertEquipmentError } = await equipmentCostTable.insert(equipmentCostRows);
      if (
        insertEquipmentError &&
        insertEquipmentError.code !== "PGRST205" &&
        insertEquipmentError.code !== "42P01"
      ) {
        logSupabaseError(
          "[recordTaskProgress] Supabase equipment cost entries insert failed",
          insertEquipmentError
        );
        return { error: "Could not save equipment costs. Please try again." };
      }
    }

    // Kept in the override history too — every save, not just the day's
    // latest (0071).
    await logOverride(supabase, profile, projectId, { kind: "task", id: taskId }, {
      action: "saved",
      entryDate,
      quantityCompleted: input.quantityCompletedToday,
      costs: {
        labor: laborCost,
        material: materialCost,
        equipment: equipmentCost,
        other: otherCost,
      },
      materialsUsed: [
        ...plannedRows.map((row) => ({
          name: row.material_name,
          unit: row.unit,
          quantity: row.quantity_used,
        })),
        ...unplanned.materials,
      ],
      equipmentCosts: equipmentCostRows.map((row) => ({
        name: row.cost_name,
        amount: row.amount,
        unplanned: row.unplanned,
      })),
      otherCosts: otherCostRows.map((row) => ({
        name: row.cost_name,
        amount: row.amount,
        unplanned: row.unplanned,
      })),
      attendance: crew.rows.map((row) => ({
        name: row.worker_name,
        hours: row.hours,
        rate: row.hourly_rate,
      })),
    });

    revalidateProjectPaths(projectId);
    return { success: true };
  });
}

/**
 * Deletes one day's saved Daily Progress Update (an override) for a
 * task — admins and super admins only (the Last override box's Delete).
 * Its attendance and materials used go with it (on delete cascade), and
 * the day goes back to automatic progress: a past working day counts its
 * planned share again, today nothing until it's over.
 */
export async function deleteTaskProgressEntry(
  taskId: number,
  projectId: number,
  entryDate: string
): Promise<TaskProgressActionState> {
  return safely(async () => {
    const profile = await requireProjectAccess(projectId);
    if (!profile || !isAdminRole(profile.role)) {
      return { error: "Only admins can delete a progress override." };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
      return { error: "That override couldn't be found." };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("task_progress_entries")
      .delete()
      .eq("task_id", taskId)
      .eq("entry_date", entryDate)
      .select("*");

    if (error) {
      logSupabaseError("[deleteTaskProgressEntry] Supabase delete failed", error);
      return { error: "Could not delete the override. Please try again." };
    }
    if (!data || data.length === 0) {
      return { error: "That override was already removed." };
    }

    // The history keeps who deleted it, when, and what it was (0071).
    const removed = data[0];
    await logOverride(supabase, profile, projectId, { kind: "task", id: taskId }, {
      action: "deleted",
      entryDate,
      quantityCompleted: removed.quantity_completed ?? 0,
      costs: entryCosts(removed),
      materialsUsed: [],
      attendance: [],
    });

    revalidateProjectPaths(projectId);
    return { success: true };
  });
}
