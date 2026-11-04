import { EQUIPMENT_USE_LABELS, type EquipmentUseStatus, type EquipmentTaskUseStatus } from "@/lib/equipment/usage-status";

const COLORS: Record<EquipmentUseStatus | EquipmentTaskUseStatus, string> = {
  ongoing: "bg-emerald-50 text-emerald-700",
  upcoming: "bg-blue-50 text-blue-700",
  planned: "bg-amber-50 text-amber-700",
  completed: "bg-teal-50 text-teal-700",
  available: "bg-emerald-50 text-emerald-700",
  assigned: "bg-amber-50 text-amber-700",
  maintenance: "bg-red-50 text-red-700",
  retired: "bg-zinc-100 text-zinc-500",
  unknown: "bg-zinc-100 text-zinc-500",
};

export function EquipmentUsageBadge({ status }: { status: EquipmentUseStatus | EquipmentTaskUseStatus }) {
  const taskStatus = ["ongoing", "upcoming", "planned", "completed"].includes(status);
  return <span title={status === "completed" ? "Saved actual progress is 100%. Work can be completed before its planned dates." : taskStatus ? "On going requires saved actual progress. Planned dates do not establish actual work or completion." : undefined}
    className={`rounded-sm px-2 py-0.5 text-xs font-medium whitespace-nowrap ${COLORS[status]}`}>
    {EQUIPMENT_USE_LABELS[status]}
  </span>;
}
