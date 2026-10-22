"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProjectAccess } from "@/lib/auth/project-access";
import { roleLabel } from "@/lib/auth/roles";
import type { Database } from "@/lib/supabase/types";
import type {
  OverrideLog,
  OverrideLogItem,
  ProjectOverrideHistory,
} from "@/lib/progress-logs/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type OverrideLogRow = Database["public"]["Tables"]["progress_override_logs"]["Row"];
type SavedByAccounts = Map<string, { name: string | null; role: string }>;

function toNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

// A jsonb list from the log row, each item read defensively.
function readList<T>(value: unknown, read: (item: Record<string, unknown>) => T): T[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map(read);
}

function itemKeyFor(row: OverrideLogRow) {
  if (row.task_id !== null) return `task-${row.task_id}`;
  if (row.category_id !== null) return `category-${row.category_id}`;
  return null;
}

// A delete hides earlier saves for the same date on the same task or phase.
// Shared by the one-item and whole-project reads so their history matches.
function visibleSavedRows(rows: readonly OverrideLogRow[]) {
  const deletedUpTo = new Map<string, number>();
  for (const row of rows) {
    const itemKey = itemKeyFor(row);
    if (!itemKey || row.action !== "deleted") continue;
    const key = `${itemKey}:${row.entry_date}`;
    const at = Date.parse(row.created_at);
    if (at > (deletedUpTo.get(key) ?? -Infinity)) deletedUpTo.set(key, at);
  }

  return rows.filter((row) => {
    const itemKey = itemKeyFor(row);
    if (!itemKey || row.action !== "saved") return false;
    return Date.parse(row.created_at) > (deletedUpTo.get(`${itemKey}:${row.entry_date}`) ?? -Infinity);
  });
}

async function savedByAccounts(supabase: Supabase, rows: readonly OverrideLogRow[]) {
  const savedByIds = Array.from(
    new Set(rows.map((row) => row.saved_by).filter((id): id is string => !!id))
  );
  const accounts: SavedByAccounts = new Map();
  if (savedByIds.length === 0) return accounts;

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, email, role")
    .in("id", savedByIds);
  for (const account of profiles ?? []) {
    accounts.set(account.id, {
      name:
        `${account.first_name} ${account.last_name}`.trim() ||
        account.email?.split("@")[0] ||
        null,
      role: roleLabel(account.role),
    });
  }
  return accounts;
}

function toOverrideLog(row: OverrideLogRow, accounts: SavedByAccounts): OverrideLog {
  return {
    id: row.id,
    action: row.action,
    entryDate: row.entry_date,
    createdAt: row.created_at,
    savedByName:
      row.saved_by_name || (row.saved_by ? (accounts.get(row.saved_by)?.name ?? null) : null),
    savedByRole: row.saved_by ? (accounts.get(row.saved_by)?.role ?? null) : null,
    quantityCompleted: toNumber(row.quantity_completed),
    costs: {
      labor: toNumber(row.labor_cost),
      material: toNumber(row.material_cost),
      equipment: toNumber(row.equipment_cost),
      other: toNumber(row.other_cost),
    },
    materialsUsed: readList(row.materials_used, (material) => ({
      name: String(material.name ?? ""),
      unit: typeof material.unit === "string" ? material.unit : null,
      quantity: toNumber(material.quantity),
      unitCost:
        material.unitCost === undefined || material.unitCost === null
          ? null
          : toNumber(material.unitCost),
    })),
    equipmentCosts: readList(
      (row as OverrideLogRow & { equipment_costs?: unknown }).equipment_costs,
      (item) => ({
        name: String(item.name ?? ""),
        amount: toNumber(item.amount),
        unplanned: Boolean(item.unplanned),
      })
    ),
    otherCosts: readList(
      (row as OverrideLogRow & { other_costs?: unknown }).other_costs,
      (item) => ({
        name: String(item.name ?? ""),
        amount: toNumber(item.amount),
        unplanned: Boolean(item.unplanned),
      })
    ),
    attendance: readList(row.attendance, (worker) => ({
      name: String(worker.name ?? ""),
      hours: toNumber(worker.hours),
      rate: toNumber(worker.rate),
    })),
  };
}

/**
 * A task's or task-less phase's override history, newest first. Deleted
 * overrides drop out: a delete hides earlier saves for its date and is not
 * listed itself. Empty for anyone without access or before migration 0071.
 */
export async function listOverrideLogs(
  projectId: number,
  item: OverrideLogItem
): Promise<OverrideLog[]> {
  const profile = await requireProjectAccess(projectId);
  if (!profile) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("progress_override_logs")
    .select("*")
    .eq(item.kind === "task" ? "task_id" : "category_id", item.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) {
    console.error("[progress-logs] History query failed:", error.message);
    return [];
  }

  const shown = visibleSavedRows(data ?? []);
  const accounts = await savedByAccounts(supabase, shown);
  return shown.map((row) => toOverrideLog(row, accounts));
}

/**
 * The whole project's override history, grouped by `task-<id>` or
 * `category-<id>`. This loads with the project page so a Progress Tracking
 * modal can render its Log history immediately when it opens.
 */
export async function listProjectOverrideHistory(
  projectId: number
): Promise<ProjectOverrideHistory> {
  const profile = await requireProjectAccess(projectId);
  if (!profile) return {};

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("progress_override_logs")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) {
    console.error("[progress-logs] Project history query failed:", error.message);
    return {};
  }

  const shown = visibleSavedRows(data ?? []);
  const accounts = await savedByAccounts(supabase, shown);
  const history: ProjectOverrideHistory = {};
  for (const row of shown) {
    const itemKey = itemKeyFor(row);
    if (!itemKey) continue;
    (history[itemKey] ??= []).push(toOverrideLog(row, accounts));
  }
  return history;
}
