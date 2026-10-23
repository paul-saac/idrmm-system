import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PunchItem } from "./punch-list-model";

export async function listPunchItems(projectId: number): Promise<{ items: PunchItem[]; available: boolean }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("project_punch_items")
      .select("*")
      .eq("project_id", projectId)
      .order("identified_on", { ascending: false })
      .order("id", { ascending: false });

    if (error) {
      console.warn("Project punch items query returned error (table may not exist yet):", error.message || error.code);
      return { items: [], available: false };
    }

    const rows = data ?? [];
    const profileIds = Array.from(new Set(rows.flatMap(row => [row.assigned_to, row.identified_by, row.verified_by]).filter((id): id is string => Boolean(id))));
    const names = new Map<string, string>();
    if (profileIds.length) {
      const { data: profiles, error: profileError } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .in("id", profileIds);
      if (profileError) {
        console.warn("Could not load punch-list personnel profiles:", profileError.message);
      } else {
        for (const profile of profiles ?? []) {
          names.set(profile.id, `${profile.first_name} ${profile.last_name}`.trim());
        }
      }
    }

    return {
      available: true,
      items: rows.map(row => ({
        ...row,
        assigned_to_name: row.assigned_to ? names.get(row.assigned_to) ?? null : null,
        identified_by_name: names.get(row.identified_by) ?? null,
        verified_by_name: row.verified_by ? names.get(row.verified_by) ?? null : null,
      })),
    };
  } catch (err) {
    console.warn("Unexpected error loading punch items:", err);
    return { items: [], available: false };
  }
}
