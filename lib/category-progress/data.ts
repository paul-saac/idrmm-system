import { createClient } from "@/lib/supabase/server";
import type { ProgressAnchor } from "@/lib/task-progress/calculate";
import type { TaskProgressToday } from "@/lib/task-progress/data";

/** Same idea as TaskProgressAnchors, one level up — see that type's own
 * doc comment. Keyed by category id; a category with no Progress
 * Tracking Override recorded yet (which, in practice, is every category
 * that still has tasks — see 0048_category_progress_tracking.sql's own
 * comment) is simply absent.
 *
 * cumulativeMaterialUsage is always empty here — a task-less category
 * has no planned material list of its own to log usage against (just
 * its single direct line, see CostCategory.materialDirectQuantity), so
 * its own Materials% is always excluded from its blend. */
export type CategoryProgressAnchors = Record<number, ProgressAnchor>;

export async function listCategoryProgressAnchors(
  categoryIds: number[]
): Promise<CategoryProgressAnchors> {
  if (categoryIds.length === 0) return {};
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("category_progress_entries")
    .select("category_id, labor_headcount, percent_complete_override")
    .in("category_id", categoryIds)
    // Oldest first, so the last row seen per category below is the
    // latest one — what latestPercentCompleteOverride is read from.
    .order("entry_date", { ascending: true });

  if (error) {
    console.error("[category-progress] entries query failed:", error.message);
  }

  const result: CategoryProgressAnchors = {};
  for (const row of data ?? []) {
    const existing = result[row.category_id];
    result[row.category_id] = {
      cumulativeMaterialUsage: {},
      cumulativeLaborHeadcount:
        (existing?.cumulativeLaborHeadcount ?? 0) + (row.labor_headcount ?? 0),
      latestPercentCompleteOverride: row.percent_complete_override,
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

  const { data: entries, error } = await supabase
    .from("category_progress_entries")
    .select("category_id, entry_date, labor_headcount, percent_complete_override")
    .in("category_id", categoryIds);

  if (error) {
    console.error("[category-progress] entries query failed:", error.message);
  }

  const result: Record<number, TaskProgressToday> = {};
  for (const categoryId of categoryIds) {
    result[categoryId] = {
      cumulativeMaterialUsage: {},
      cumulativeLaborHeadcount: 0,
      today: null,
    };
  }
  for (const row of entries ?? []) {
    const progress = result[row.category_id];
    if (!progress) continue;
    progress.cumulativeLaborHeadcount += row.labor_headcount ?? 0;
    if (row.entry_date === today) {
      progress.today = {
        laborHeadcount: row.labor_headcount ?? 0,
        materialUsage: {},
        percentCompleteOverride: row.percent_complete_override,
      };
    }
  }
  return result;
}
