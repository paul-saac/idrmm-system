import { createClient } from "@/lib/supabase/server";
import {
  isProjectEventType,
  type ProjectEvent,
} from "@/lib/project-events/types";

/**
 * Every calendar event on a project (0055_project_events.sql), by date.
 * Empty — never a failed page — if the table isn't there yet.
 */
export async function listProjectEvents(projectId: number): Promise<ProjectEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_events")
    .select("id, event_type, name, event_date, start_time, end_time")
    .eq("project_id", projectId)
    .order("event_date", { ascending: true })
    .order("start_time", { ascending: true, nullsFirst: true });

  if (error) {
    console.error("[project-events] list failed:", error.message);
    return [];
  }

  return (data ?? [])
    .filter((row) => isProjectEventType(row.event_type))
    .map((row) => ({
      id: row.id,
      type: row.event_type as ProjectEvent["type"],
      name: row.name,
      date: row.event_date,
      startTime: row.start_time ? row.start_time.slice(0, 5) : null,
      endTime: row.end_time ? row.end_time.slice(0, 5) : null,
    }));
}
