import type { ProjectStatus } from "@/lib/supabase/types";
import type { ProjectLifecycle } from "./lifecycle";

export const PROJECT_STATUSES: ProjectStatus[] = [
  "planning",
  "ongoing",
  "completed",
];

export function projectStatusLabel(status: ProjectStatus): string {
  switch (status) {
    case "planning":
      return "Planning";
    case "ongoing":
      return "On going";
    case "completed":
      return "Completed";
  }
}

export function projectStatusBadgeClasses(status: ProjectStatus): string {
  switch (status) {
    case "planning":
      return "bg-amber-50 text-amber-700";
    case "ongoing":
      return "bg-emerald-100 text-emerald-700";
    case "completed":
      return "bg-sky-50 text-sky-700";
  }
}

/** Actual work starts a project; an administrator's actual end date
 * confirms completion only while every leaf item is fully logged. */
export function deriveProjectStatusFromProgress(
  lifecycle: ProjectLifecycle,
  actualEndDate: string | null,
): ProjectStatus {
  if (!lifecycle.hasRecordedWork) return "planning";
  if (lifecycle.allItemsComplete && actualEndDate) return "completed";
  return "ongoing";
}
