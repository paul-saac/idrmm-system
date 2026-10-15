"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProjectAccess } from "@/lib/auth/project-access";
import { roleLabel } from "@/lib/auth/roles";
import type { OverrideLog, OverrideLogItem } from "@/lib/progress-logs/types";

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

/**
 * A task's or task-less phase's override history, newest first — the
 * progress window's History. Deleted overrides drop out of it: a delete
 * hides that day's saves from before it and isn't listed itself (the
 * rows stay in the table, which is append-only — just not shown). Empty
 * for anyone without access to the project, or before 0071 has run.
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

  // Each day's latest delete — its saves up to then were deleted.
  const deletedUpTo = new Map<string, number>();
  for (const row of data ?? []) {
    if (row.action !== "deleted") continue;
    const at = Date.parse(row.created_at);
    if (at > (deletedUpTo.get(row.entry_date) ?? -Infinity)) deletedUpTo.set(row.entry_date, at);
  }
  const shown = (data ?? []).filter(
    (row) =>
      row.action === "saved" &&
      Date.parse(row.created_at) > (deletedUpTo.get(row.entry_date) ?? -Infinity)
  );

  // Who saved each — their account's role, and its name when the log
  // didn't keep one. Read as the viewer, so only accounts they may see
  // (admins all; a foreman the staff's).
  const savedByIds = Array.from(
    new Set(shown.map((row) => row.saved_by).filter((id): id is string => !!id))
  );
  const accounts = new Map<string, { name: string | null; role: string }>();
  if (savedByIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, email, role")
      .in("id", savedByIds);
    for (const account of profiles ?? []) {
      accounts.set(account.id, {
        // Without a name, its email's name part — the same as the header's
        // profile menu shows — never the whole address.
        name:
          `${account.first_name} ${account.last_name}`.trim() ||
          account.email?.split("@")[0] ||
          null,
        role: roleLabel(account.role),
      });
    }
  }

  return shown.map((row) => ({
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
    })),
    attendance: readList(row.attendance, (worker) => ({
      name: String(worker.name ?? ""),
      hours: toNumber(worker.hours),
      rate: toNumber(worker.rate),
    })),
  }));
}
