import { createClient } from "@/lib/supabase/server";

/**
 * Material ID is system-assigned, not typed by hand — "MAT-001",
 * "MAT-002", … per project, based on the highest existing sequence
 * number rather than a plain row count, so a deleted record never gets
 * its number reused by a later insert.
 *
 * Plain module rather than living in lib/materials/actions.ts — that
 * file is "use server", and Next.js requires every export from a
 * "use server" file to be an async Server Action, which importing a
 * plain helper into another domain's actions file (lib/daily-logs/
 * actions.ts, to auto-create a Material Record from an approved
 * Material Procurement Log) isn't. Same reasoning as lib/material-
 * requests/status.ts.
 */
export async function nextMaterialCode(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: number
) {
  const { data } = await supabase
    .from("project_materials")
    .select("material_code")
    .eq("project_id", projectId);

  let maxSeq = 0;
  for (const row of data ?? []) {
    const match = /^MAT-(\d+)$/.exec(row.material_code);
    if (match) {
      maxSeq = Math.max(maxSeq, Number(match[1]));
    }
  }
  return `MAT-${String(maxSeq + 1).padStart(3, "0")}`;
}
