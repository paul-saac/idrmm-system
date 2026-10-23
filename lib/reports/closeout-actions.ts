"use server";

import { revalidatePath } from "next/cache";
import { requireProjectAccess } from "@/lib/auth/project-access";
import { createClient } from "@/lib/supabase/server";
import { CLOSEOUT_FIELDS, isDateOnly, type CloseoutNotes } from "./closeout-model";

export type CloseoutSaveState = { error?: string; success?: boolean; version?: number };

export async function saveCloseoutReport(projectId: number, _previous: CloseoutSaveState, form: FormData): Promise<CloseoutSaveState> {
  if (!Number.isSafeInteger(projectId) || projectId <= 0 || !(await requireProjectAccess(projectId))) return { error: "You cannot edit this project's closeout report." };
  const version = Number(form.get("version"));
  if (!Number.isSafeInteger(version) || version < 0) return { error: "Reload the report before saving." };
  const notes: CloseoutNotes = {};
  for (const field of CLOSEOUT_FIELDS) {
    const raw = form.get(field.key);
    if (raw === null) continue;
    if (typeof raw !== "string" || raw.length > 10000) return { error: `${field.label} must be at most 10,000 characters.` };
    notes[field.key] = raw.trim();
  }
  const milestoneDates: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("milestone:")) continue;
    const itemKey = key.slice(10);
    if (!/^(task|category)-[1-9]\d*$/.test(itemKey) || typeof value !== "string") return { error: "Invalid milestone." };
    if (!value) continue;
    if (!isDateOnly(value)) return { error: "Enter a valid milestone achievement date." };
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    if (value > today) return { error: "An achievement date cannot be in the future." };
    milestoneDates[itemKey] = value;
  }
  const supabase = await createClient();
  // Validate submitted milestone IDs against this project, including standalone phases.
  const [tasks, categories] = await Promise.all([
    supabase.from("estimate_tasks").select("id, is_milestone, category_id").eq("project_id", projectId),
    supabase.from("estimate_categories").select("id, is_milestone").eq("project_id", projectId),
  ]);
  if (tasks.error || categories.error) return { error: "Could not validate the project milestones. Please try again." };
  const parents = new Set((tasks.data ?? []).map((item) => item.category_id));
  const validKeys = new Set([
    ...(tasks.data ?? []).filter((item) => item.is_milestone).map((item) => `task-${item.id}`),
    ...(categories.data ?? []).filter((item) => item.is_milestone && !parents.has(item.id)).map((item) => `category-${item.id}`),
  ]);
  if (Object.keys(milestoneDates).some((key) => !validKeys.has(key))) return { error: "A milestone has changed. Reload the report before saving." };
  // Hidden sections may contain an earlier review. Preserve them when saving
  // the reduced form; removing a report section must not erase stored notes.
  const existing = version > 0
    ? await supabase.from("project_closeout_reports").select("notes").eq("project_id", projectId).eq("version", version).maybeSingle()
    : null;
  if (existing?.error) return { error: "Could not load the saved report. Please try again." };
  if (version > 0 && !existing?.data) return { error: "This report changed since you opened it. Reload before saving." };
  const values = { notes: { ...existing?.data?.notes, ...notes }, milestone_dates: milestoneDates };
  const result = version === 0
    ? await supabase.from("project_closeout_reports").insert({ project_id: projectId, ...values }).select("version").single()
    : await supabase.from("project_closeout_reports").update(values).eq("project_id", projectId).eq("version", version).select("version").maybeSingle();
  if (result.error) {
    if (["42P01", "PGRST205"].includes(result.error.code)) return { error: "Closeout saving is not available yet. Contact your administrator." };
    if (result.error.code === "23505") return { error: "Someone saved this report first. Reload to review their changes." };
    console.error("[saveCloseoutReport]", result.error.message);
    return { error: "Could not save the report. Your entries are still in the form." };
  }
  if (!result.data) return { error: "This report changed since you opened it. Reload before saving to avoid overwriting another person's work." };
  revalidatePath("/admin/reports");
  revalidatePath("/foreman/reports");
  revalidatePath("/project-manager/reports");
  return { success: true, version: result.data.version };
}
