import type { LucideIcon } from "lucide-react";

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "zinc",
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  /** "positive"/"negative" tint the icon chip for a Cost Variance card
   * whose sign flips meaning — everything else stays neutral zinc. */
  tone?: "zinc" | "positive" | "negative";
}) {
  const chipClasses =
    tone === "positive"
      ? "bg-emerald-50 text-emerald-600"
      : tone === "negative"
        ? "bg-red-50 text-red-600"
        : "bg-zinc-100 text-zinc-600";

  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white p-4">
      <div className={`flex size-9 flex-shrink-0 items-center justify-center rounded ${chipClasses}`}>
        <Icon className="size-4.5" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs text-zinc-500">{label}</p>
        <p className="truncate text-base font-semibold text-zinc-900">{value}</p>
      </div>
    </div>
  );
}
