import type { RiskLevel } from "@/lib/forecasting/data";

export function riskLevelLabel(level: RiskLevel): string {
  switch (level) {
    case "low":
      return "Low Risk";
    case "medium":
      return "Medium Risk";
    case "high":
      return "High Risk";
    case "unknown":
      return "Not Enough Data";
  }
}

export function riskLevelBadgeClasses(level: RiskLevel): string {
  switch (level) {
    case "low":
      return "bg-emerald-50 text-emerald-700";
    case "medium":
      return "bg-amber-50 text-amber-700";
    case "high":
      return "bg-red-50 text-red-600";
    case "unknown":
      return "bg-zinc-100 text-zinc-500";
  }
}
