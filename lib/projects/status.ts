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

export function projectStatusBadgeClasses(status: ProjectStatus, appearance: "default" | "workspace" = "default"): string {
  if (appearance === "workspace") {
    switch (status) {
      case "planning":
        return "bg-[#554a2e] text-[#ffad00]";
      case "ongoing":
        return "bg-[#2c5432] text-[#00d53b]";
      case "completed":
        return "bg-[#2b5752] text-[#00ead5]";
    }
  }
  switch (status) {
    case "planning":
      return "bg-amber-50 text-amber-700";
    case "ongoing":
      return "bg-emerald-100 text-emerald-700";
    case "completed":
      return "bg-sky-50 text-sky-700";
  }
}

/** Actual work starts a project; completing every leaf item completes it. */
export function deriveProjectStatusFromProgress(
  lifecycle: ProjectLifecycle,
): ProjectStatus {
  if (!lifecycle.hasRecordedWork) return "planning";
  if (lifecycle.allItemsComplete) return "completed";
  return "ongoing";
}
