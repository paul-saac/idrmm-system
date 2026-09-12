import { createClient } from "@/lib/supabase/server";
import type { ProjectStatus } from "@/lib/supabase/types";

export type ProjectRow = {
  id: number;
  name: string;
  location: string | null;
  status: ProjectStatus;
  startDate: string | null;
  targetEndDate: string | null;
  actualEndDate: string | null;
  allocatedBudget: number | null;
  projectManagerId: string;
  projectManagerName: string | null;
  foremanId: string;
  foremanName: string | null;
};

function formatName(
  profile: { first_name: string; last_name: string } | undefined
) {
  if (!profile) return null;
  const name = `${profile.first_name} ${profile.last_name}`.trim();
  return name || null;
}

/**
 * projects references profiles through two separate uuid columns
 * (project_manager_id, foreman_id) — rather than lean on PostgREST's
 * relationship-hint syntax for two FKs to the same table, this just
 * fetches the referenced profiles separately and merges them in JS.
 */
async function attachAssigneeNames<
  T extends { project_manager_id: string; foreman_id: string },
>(supabase: Awaited<ReturnType<typeof createClient>>, rows: T[]) {
  const ids = Array.from(
    new Set(rows.flatMap((row) => [row.project_manager_id, row.foreman_id]))
  );

  if (ids.length === 0) {
    return new Map<string, { first_name: string; last_name: string }>();
  }

  const { data } = await supabase
    .from("profiles")
    .select("id, first_name, last_name")
    .in("id", ids);

  return new Map((data ?? []).map((p) => [p.id, p]));
}

function toProjectRow(
  row: {
    id: number;
    project_name: string;
    location: string | null;
    status: ProjectStatus;
    start_date: string | null;
    target_end_date: string | null;
    actual_end_date: string | null;
    allocated_budget: number | null;
    project_manager_id: string;
    foreman_id: string;
  },
  namesById: Map<string, { first_name: string; last_name: string }>
): ProjectRow {
  return {
    id: row.id,
    name: row.project_name,
    location: row.location,
    status: row.status,
    startDate: row.start_date,
    targetEndDate: row.target_end_date,
    actualEndDate: row.actual_end_date,
    allocatedBudget: row.allocated_budget,
    projectManagerId: row.project_manager_id,
    projectManagerName: formatName(namesById.get(row.project_manager_id)),
    foremanId: row.foreman_id,
    foremanName: formatName(namesById.get(row.foreman_id)),
  };
}

export async function listProjects(): Promise<ProjectRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  const namesById = await attachAssigneeNames(supabase, data);

  return data.map((row) => toProjectRow(row, namesById));
}

export async function getProjectById(id: number): Promise<ProjectRow | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;

  const namesById = await attachAssigneeNames(supabase, [data]);

  return toProjectRow(data, namesById);
}
