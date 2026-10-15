import { createClient } from "@/lib/supabase/server";
import { ZERO_COSTS, materialKey, type ProgressAnchor } from "@/lib/task-progress/calculate";
import {
  attendanceByEntry,
  entryCosts,
  savedByNames,
  type TaskProgressToday,
} from "@/lib/task-progress/data";

/** Same idea as TaskProgressAnchors, one level up — see that type's own
 * doc comment. Keyed by category id; a category with no Daily Progress
 * Update saved yet (which, in practice, is every category that still has
 * tasks — see 0048_category_progress_tracking.sql's own comment) is
 * simply absent.
 *
 * cumulativeMaterialUsage sums what each update logged against the
 * category's own Material Breakdown lines (0070), keyed by materialKey —
 * the same as a task's. */
export type CategoryProgressAnchors = Record<number, ProgressAnchor>;

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Every entry for these categories, oldest first, each with its own
 * day's material usage attached (keyed by materialKey). "*" rather than a
 * column list, so a DB missing a newer column (e.g. 0057's costs) still
 * loads; a DB without 0070 yet just reads no materials used. */
async function fetchEntries(supabase: Supabase, categoryIds: number[]) {
  const { data, error } = await supabase
    .from("category_progress_entries")
    .select("*")
    .in("category_id", categoryIds)
    .order("entry_date", { ascending: true });

  if (error) {
    console.error("[category-progress] entries query failed:", error.message);
  }
  const rows = data ?? [];

  const materialsByEntry = new Map<number, Record<string, number>>();
  if (rows.length > 0) {
    const { data: materialRows, error: materialsError } = await supabase
      .from("category_progress_material_entries")
      .select("progress_entry_id, material_name, unit, quantity_used")
      .in(
        "progress_entry_id",
        rows.map((row) => row.id)
      );

    if (materialsError) {
      console.error(
        "[category-progress] material entries query failed:",
        materialsError.message
      );
    }

    for (const row of materialRows ?? []) {
      const usage = materialsByEntry.get(row.progress_entry_id) ?? {};
      const key = materialKey(row.material_name, row.unit);
      usage[key] = (usage[key] ?? 0) + (row.quantity_used ?? 0);
      materialsByEntry.set(row.progress_entry_id, usage);
    }
  }

  return rows.map((row) => ({ ...row, materialUsage: materialsByEntry.get(row.id) ?? {} }));
}

function emptyAnchor(): ProgressAnchor & { loggedDates: string[] } {
  return {
    cumulativeQuantityCompleted: 0,
    cumulativeMaterialUsage: {},
    cumulativeCosts: { ...ZERO_COSTS },
    loggedDates: [],
  };
}

function addRow(
  anchor: ReturnType<typeof emptyAnchor>,
  row: Awaited<ReturnType<typeof fetchEntries>>[number]
) {
  const costs = entryCosts(row);
  anchor.cumulativeQuantityCompleted += row.quantity_completed ?? 0;
  for (const [key, quantity] of Object.entries(row.materialUsage)) {
    anchor.cumulativeMaterialUsage[key] = (anchor.cumulativeMaterialUsage[key] ?? 0) + quantity;
  }
  anchor.cumulativeCosts.labor += costs.labor;
  anchor.cumulativeCosts.material += costs.material;
  anchor.cumulativeCosts.equipment += costs.equipment;
  anchor.cumulativeCosts.other += costs.other;
  anchor.loggedDates.push(row.entry_date);
}

export async function listCategoryProgressAnchors(
  categoryIds: number[]
): Promise<CategoryProgressAnchors> {
  if (categoryIds.length === 0) return {};
  const supabase = await createClient();
  const rows = await fetchEntries(supabase, categoryIds);

  const result: Record<number, ReturnType<typeof emptyAnchor>> = {};
  for (const row of rows) {
    addRow((result[row.category_id] ??= emptyAnchor()), row);
  }
  return result;
}

/** Local calendar date as `YYYY-MM-DD` — matches listTaskProgressToday's
 * own todayIso. */
function todayIso() {
  return new Date().toLocaleDateString("en-CA");
}

/**
 * Same idea as listTaskProgressToday, one level up — see that
 * function's own doc comment. Fetched for every category regardless of
 * whether it has tasks (a category with tasks simply never has any
 * entries, harmless).
 */
export async function listCategoryProgressToday(
  projectId: number
): Promise<Record<number, TaskProgressToday>> {
  const supabase = await createClient();

  const { data: categoryRows } = await supabase
    .from("estimate_categories")
    .select("id")
    .eq("project_id", projectId);
  const categoryIds = (categoryRows ?? []).map((row) => row.id);
  if (categoryIds.length === 0) return {};

  const today = todayIso();
  const rows = await fetchEntries(supabase, categoryIds);

  const result: Record<
    number,
    ReturnType<typeof emptyAnchor> & {
      today: TaskProgressToday["today"];
      latest: TaskProgressToday["latest"];
      todayAttendance: TaskProgressToday["todayAttendance"];
    }
  > = {};
  for (const categoryId of categoryIds) {
    result[categoryId] = { ...emptyAnchor(), today: null, latest: null, todayAttendance: [] };
  }
  const todayEntryCategory = new Map<number, number>();
  // Oldest first, so each category's last row is its latest override.
  const latestByCategory = new Map<number, (typeof rows)[number]>();
  for (const row of rows) {
    const progress = result[row.category_id];
    if (!progress) continue;
    addRow(progress, row);
    latestByCategory.set(row.category_id, row);
    if (row.entry_date === today) {
      progress.today = {
        quantityCompleted: row.quantity_completed ?? 0,
        costs: entryCosts(row),
        materialUsage: row.materialUsage,
      };
      todayEntryCategory.set(row.id, row.category_id);
    }
  }
  const attendance = await attendanceByEntry(
    supabase,
    "category",
    Array.from(todayEntryCategory.keys())
  );
  for (const [entryId, marks] of attendance) {
    const categoryId = todayEntryCategory.get(entryId);
    if (categoryId !== undefined) result[categoryId].todayAttendance = marks;
  }
  const names = await savedByNames(
    supabase,
    Array.from(latestByCategory.values(), (row) => row.recorded_by)
  );
  for (const [categoryId, row] of latestByCategory) {
    result[categoryId].latest = {
      quantityCompleted: row.quantity_completed ?? 0,
      costs: entryCosts(row),
      materialUsage: row.materialUsage,
      entryDate: row.entry_date,
      savedByName: (row.recorded_by && names.get(row.recorded_by)) || null,
    };
  }
  return result;
}
