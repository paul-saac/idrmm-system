/**
 * Pure per-entry flag types and state derivation — split out from
 * lib/daily-logs/data.ts (which imports the server-only Supabase
 * client) so client components can import flagState() without pulling
 * a next/headers-dependent module into the browser bundle. data.ts
 * re-exports everything here for server-side consumers.
 */

/**
 * Every entry type a single per-entry review flag can attach to — see
 * 0023_daily_log_entry_flags.sql. A material_procurement / equipment_
 * acquisition flag targets the whole procurement/acquisition entry (its
 * header id), not one of its line items — the same granularity
 * "removeEntryIds" already uses when editing a log.
 */
export type EntryType =
  | "work_item"
  | "labor_item"
  | "expense_item"
  | "material_usage_item"
  | "material_procurement"
  | "equipment_acquisition";

export type EntryFlag = {
  id: number;
  entryType: EntryType;
  entryId: number;
  reason: string;
  flaggedByName: string;
  flaggedAt: string;
  resolvedByName: string | null;
  resolvedAt: string | null;
  /** Set once someone (an admin today, standing in for the foreman
   * portal that doesn't exist yet; the foreman themselves later) edits
   * this entry's own data in place while it's flagged — see
   * updateFlaggedEntry. Cleared back to null on re-flag. */
  entryUpdatedAt: string | null;
};

export type FlagState = "open" | "updated" | "resolved";

/**
 * A flag's state is derived, not stored — see
 * 0024_daily_log_entry_flag_updates.sql's header comment for the full
 * three-state rundown ("resolved" alone doesn't say whether the
 * underlying entry ever actually became correct).
 */
export function flagState(flag: EntryFlag): FlagState {
  if (flag.resolvedAt) return "resolved";
  return flag.entryUpdatedAt ? "updated" : "open";
}
