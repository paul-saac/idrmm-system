import type { LucideIcon } from "lucide-react";

export function StatCard({
  label,
  value,
  icon: Icon,
  description,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  description?: string;
}) {
  return (
    <div className="relative rounded-t-lg border border-zinc-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">{label}</p>
        <Icon className="size-4 text-zinc-400" />
      </div>
      <div className="mt-3 flex items-end justify-between gap-3"><p className="text-2xl font-semibold text-zinc-900">{value}</p>{description && <p className="pb-1 text-right text-xs text-zinc-400">{description}</p>}</div>
      {/* A plain fill bar, not a border-b — see StatCard's own comment
          in project-detail-view.tsx for why a border-b here mitered a
          visible diagonal notch into the corner instead of a straight
          edge. */}
      <div className="absolute inset-x-0 bottom-0 h-1 bg-zinc-900" />
    </div>
  );
}
