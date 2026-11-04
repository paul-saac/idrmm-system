import type { EquipmentConflict } from "./tracking-types";

/** The database masks task names and dates when the viewer cannot access them. */
export function equipmentAllocationError(error: { details?: string | null }): EquipmentConflict | undefined {
  try {
    const value = JSON.parse(error.details ?? "");
    if (value.equipmentConflict === true && typeof value.equipment === "string" && typeof value.task === "string") {
      return { equipment: value.equipment, task: value.task,
        projectName: typeof value.projectName === "string" ? value.projectName : null,
        startDate: typeof value.startDate === "string" ? value.startDate : null,
        endDate: typeof value.endDate === "string" ? value.endDate : null };
    }
  } catch { /* Other database errors are handled by the caller. */ }
  return undefined;
}
