import { createClient } from "@/lib/supabase/server";
import type { ProgressAnchor } from "@/lib/task-progress/calculate";
import type { TaskProgressToday } from "@/lib/task-progress/data";

/** Same idea as TaskProgressAnchors, one level up — see that type's own
 * doc comment. Keyed by category id; a category with no Progress
 * Tracking Override recorded yet (which, in practice, is every category
 * that still has tasks — see 0048_category_progress_tracking.sql's own
 * comment) is simply absent. */
export type CategoryProgressAnchors = Record<number, ProgressAnchor>;

/**
 * Same idea as listTaskProgressAnchors, one level up — see that
 * function's own doc comment.
 */
export async function listCategoryProgressAnchors(
  categoryIds: number[]
): Promise<CategoryProgressAnchors> {
  if (categoryIds.length === 0) return {};
  const supabase = await createClient();

  const { data } = await supabase
    .from("category_progress_entries")
    .select("category_id, entry_date, quantity_completed")
    .in("category_id", categoryIds);

  const sums = new Map<number, number>();
  const latestDates = new Map<number, string>();
  for (const row of data ?? []) {
    sums.set(
      row.category_id,
      (sums.get(row.category_id) ?? 0) + (row.quantity_completed ?? 0)
    );
    const current = latestDates.get(row.category_id);
    if (!current || row.entry_date > current) {
      latestDates.set(row.category_id, row.entry_date);
    }
  }

  const result: CategoryProgressAnchors = {};
  for (const [categoryId, entryDate] of latestDates) {
    result[categoryId] = {
      entryDate,
      cumulativeQuantityCompleted: sums.get(categoryId) ?? 0,
    };
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
 * entries, harmless) rather than filtering here, same "fetch broadly,
 * let the UI decide what's reachable" shape the rest of this app's own
 * category/task lookups already use.
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

  const { data: entries } = await supabase
    .from("category_progress_entries")
    .select("id, category_id, entry_date, quantity_completed, labor_headcount")
    .in("category_id", categoryIds);

  const cumulative = new Map<number, number>();
  const todayEntryByCategory = new Map<
    number,
    { id: number; quantityCompleted: number; laborHeadcount: number }
  >();
  for (const row of entries ?? []) {
    cumulative.set(
      row.category_id,
      (cumulative.get(row.category_id) ?? 0) + (row.quantity_completed ?? 0)
    );
    if (row.entry_date === today) {
      todayEntryByCategory.set(row.category_id, {
        id: row.id,
        quantityCompleted: row.quantity_completed ?? 0,
        laborHeadcount: row.labor_headcount ?? 0,
      });
    }
  }

  const todayEntryIds = Array.from(todayEntryByCategory.values()).map(
    (e) => e.id
  );
  const materialsByEntryId = new Map<
    number,
    { materialId: number; quantity: number }[]
  >();
  if (todayEntryIds.length > 0) {
    const { data: usageRows } = await supabase
      .from("category_progress_material_usage")
      .select("progress_entry_id, material_id, quantity")
      .in("progress_entry_id", todayEntryIds);
    for (const row of usageRows ?? []) {
      const list = materialsByEntryId.get(row.progress_entry_id) ?? [];
      list.push({ materialId: row.material_id, quantity: row.quantity ?? 0 });
      materialsByEntryId.set(row.progress_entry_id, list);
    }
  }

  const result: Record<number, TaskProgressToday> = {};
  for (const categoryId of categoryIds) {
    const todayEntry = todayEntryByCategory.get(categoryId);
    result[categoryId] = {
      cumulativeQuantityCompleted: cumulative.get(categoryId) ?? 0,
      today: todayEntry
        ? {
            quantityCompleted: todayEntry.quantityCompleted,
            laborHeadcount: todayEntry.laborHeadcount,
            materials: materialsByEntryId.get(todayEntry.id) ?? [],
          }
        : null,
    };
  }
  return result;
}
