import type { CostAmounts } from "@/lib/task-progress/calculate";

/** Which task, or task-less phase (category), a history belongs to. */
export type OverrideLogItem = { kind: "task"; id: number } | { kind: "category"; id: number };

/** One row of the override history — a Daily Progress Update as it was
 * saved (or deleted): who, exactly when, and what was entered. See
 * 0071_progress_override_logs.sql. */
export type OverrideLog = {
  id: number;
  action: "saved" | "deleted";
  /** The day the update is for. */
  entryDate: string;
  /** Exactly when it was saved or deleted (an ISO timestamp). */
  createdAt: string;
  /** Their name as it was then — or, when that wasn't kept, their
   * account's name (or its email's name part); null when unknown. */
  savedByName: string | null;
  /** Their account's role (e.g. "Administrator") — null when unknown. */
  savedByRole: string | null;
  quantityCompleted: number;
  costs: CostAmounts;
  /** What was used that day — a material not on the planned lines with
   * the unit cost typed for it (0073). */
  materialsUsed: {
    name: string;
    unit: string | null;
    quantity: number;
    unitCost?: number | null;
  }[];
  /** Who worked that day, their hours and hourly rate then. */
  attendance: { name: string; hours: number; rate: number }[];
};

/** Every saved override history in a project, grouped by its task or
 * task-less phase key (`task-<id>` / `category-<id>`). Preloaded with the
 * project so opening a Progress Tracking modal needs no second fetch. */
export type ProjectOverrideHistory = Record<string, OverrideLog[]>;
