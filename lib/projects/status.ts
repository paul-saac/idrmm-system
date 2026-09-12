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
