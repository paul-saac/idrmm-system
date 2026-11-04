import { isScheduleDate } from "@/lib/cost-estimate/schedule-dates";

export type EquipmentTaskUseStatus = "ongoing" | "upcoming" | "planned" | "completed" | "unknown";
export type EquipmentUseStatus = "available" | "assigned" | "maintenance" | "retired" | "unknown";

export const EQUIPMENT_USE_LABELS: Record<EquipmentUseStatus | EquipmentTaskUseStatus, string> = {
  ongoing: "On going", upcoming: "Upcoming", planned: "Planned", completed: "Completed",
  available: "Available", assigned: "Assigned",
  maintenance: "Maintenance", retired: "Retired", unknown: "Status unavailable",
};

/** Saved actuals establish On going/Completed; dates only distinguish Upcoming/Planned. */
export function equipmentTaskUseStatus(start: string | null, end: string | null, asOf: string,
  progress: { started: boolean; completed: boolean } | null): EquipmentTaskUseStatus {
  if (!progress) return "unknown";
  if (progress.completed) return "completed";
  if (progress.started) return "ongoing";
  if (!isScheduleDate(start) || !isScheduleDate(end) || end < start) return "planned";
  if (asOf < start) return "upcoming";
  return "planned";
}

export function equipmentUseStatus(equipment: {
  status: string;
  assignmentLoadError?: boolean;
  taskAssignments?: readonly { useStatus: EquipmentTaskUseStatus }[];
}): EquipmentUseStatus {
  return ["available", "assigned", "maintenance", "retired"].includes(equipment.status)
    ? equipment.status as EquipmentUseStatus : "unknown";
}

export function equipmentTaskDateRange(start: string | null, end: string | null, style: "long" | "numeric" = "long"): string {
  const format = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    month: style === "numeric" ? "numeric" : "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
  const first = isScheduleDate(start) ? format(start) : null;
  const last = isScheduleDate(end) ? format(end) : null;
  if (!first && !last) return "Dates not set";
  if (!first) return `Start not set – ${last}`;
  if (!last) return `${first} – End not set`;
  return start === end ? first : `${first}${style === "numeric" ? " - " : " \u2013 "}${last}`;
}
