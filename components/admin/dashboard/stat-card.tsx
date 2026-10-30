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
    <div className="relative overflow-hidden rounded border border-zinc-200 bg-white px-5 pt-5 pb-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">{label}</p>
        <Icon className="size-4 text-zinc-400" />
      </div>
      <div className="mt-3 flex items-end justify-between gap-3"><p className="text-3xl leading-none font-semibold tabular-nums text-zinc-900">{value}</p>{description && <p className="pb-1 text-right text-xs text-zinc-400">{description}</p>}</div>
      {/* A plain fill bar, not a border-b — see StatCard's own comment
          in project-detail-view.tsx for why a border-b here mitered a
          visible diagonal notch into the corner instead of a straight
          edge. */}
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-zinc-900" />
    </div>
  );
}
