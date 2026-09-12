import type { ProjectStatus } from "@/lib/supabase/types";

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
      return "bg-emerald-50 text-emerald-700";
    case "completed":
      return "bg-sky-50 text-sky-700";
  }
}

/**
 * What projects.status should become once actual logged progress
 * changes — called after any event that can move the needle (approving
 * a daily log, resolving a flag on a work_item entry). A project can't
 * sit at "planning" once real work is logged, and it's "completed" the
 * moment every task's quantity is fully accounted for, not just
 * whenever someone remembers to flip the Edit Project dropdown.
 *
 * Deliberately doesn't force 0% back to "planning" — an admin may have
 * a legitimate reason to mark a project "ongoing" before any Work Log
 * quantity is in yet (site mobilization, prep work), and this only
 * reacts to progress actually changing, not to every read.
 */
export function deriveProjectStatusFromProgress(
  currentStatus: ProjectStatus,
  progressPercent: number
): ProjectStatus {
  if (progressPercent >= 100) return "completed";
  if (progressPercent > 0) return "ongoing";
  return currentStatus;
}
