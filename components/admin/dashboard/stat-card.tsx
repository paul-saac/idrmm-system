import type { LucideIcon } from "lucide-react";

export function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">{label}</p>
        <Icon className="size-4 text-zinc-400" />
      </div>
      <p className="mt-3 text-2xl font-semibold text-zinc-900">{value}</p>
    </div>
  );
}
