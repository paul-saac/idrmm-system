import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { QualityInspection } from "./quality-inspection-model";

export async function listQualityInspections(projectId: number): Promise<{ items: QualityInspection[]; available: boolean }> {
  try {
    const client = await createClient();
    const { data, error } = await client.from("project_quality_inspections").select("*")
      .eq("project_id", projectId).order("inspected_on", { ascending: false }).order("id", { ascending: false });
    if (error) return { items: [], available: false };
    const rows = data ?? [];
    const profileIds = [...new Set(rows.map(row => row.recorded_by).filter(Boolean))];
    const names = new Map<string, string>();
    if (profileIds.length) {
      const { data: profiles } = await client.from("profiles").select("id, first_name, last_name").in("id", profileIds);
      for (const profile of profiles ?? []) names.set(profile.id, `${profile.first_name} ${profile.last_name}`.trim());
    }
    return { available: true, items: rows.map(row => ({ ...row, recorded_by_name: names.get(row.recorded_by) ?? null })) as QualityInspection[] };
  } catch {
    return { items: [], available: false };
  }
}
