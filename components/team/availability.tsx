import type { WorkerAssignment } from "@/lib/workers/data";

/** A member is Assigned while on any open task or phase (see
 * WorkerAssignment), Available otherwise — a tinted pill. */
export function AvailabilityBadge({ assigned }: { assigned: boolean }) {
  return (
    <span
      className={`rounded-sm px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
        assigned ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"
      }`}
    >
      {assigned ? "Assigned" : "Available"}
    </span>
  );
}

function formatShortDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** "until Oct 6", or "no end date" for a task nobody's dated yet. */
export function untilLabel(assignment: WorkerAssignment) {
  return assignment.endDate ? `until ${formatShortDate(assignment.endDate)}` : "no end date";
}

/** "Project Nica · Excavation (until Oct 6)" — one line per assignment. */
export function describeAssignment(assignment: WorkerAssignment) {
  return `${assignment.projectName} · ${assignment.itemName} (${untilLabel(assignment)})`;
}

/** Each member's assignments, soonest-ending first (undated last). */
export function groupAssignmentsByWorker(assignments: WorkerAssignment[]) {
  const byWorker = new Map<number, WorkerAssignment[]>();
  for (const assignment of assignments) {
    const list = byWorker.get(assignment.workerId) ?? [];
    list.push(assignment);
    byWorker.set(assignment.workerId, list);
  }
  for (const list of byWorker.values()) {
    list.sort((a, b) => (a.endDate ?? "9999").localeCompare(b.endDate ?? "9999"));
  }
  return byWorker;
}
