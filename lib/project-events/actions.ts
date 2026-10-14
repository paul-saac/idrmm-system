"use server";

import { revalidateProjectPaths } from "@/lib/projects/revalidate";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";
import {
  EVENT_NAME_MAX_LENGTH,
  isProjectEventType,
  timeToMinutes,
} from "@/lib/project-events/types";
import { isAdminRole } from "@/lib/auth/roles";

export type ProjectEventActionState = {
  error?: string;
  success?: boolean;
};

export type ProjectEventInput = {
  type: string;
  name: string;
  /** YYYY-MM-DD */
  date: string;
  /** "HH:MM" — meetings only; ignored for any other type. */
  startTime: string | null;
  endTime: string | null;
};

const TIME_PATTERN = /^\d{2}:\d{2}$/;

function normalizeEvent(input: ProjectEventInput) {
  if (!isProjectEventType(input.type)) {
    return { error: "Pick an event type." } as const;
  }
  const name = input.name.trim();
  if (!name) {
    return { error: "Event name is required." } as const;
  }
  if (name.length > EVENT_NAME_MAX_LENGTH) {
    return { error: `Event name can be at most ${EVENT_NAME_MAX_LENGTH} characters.` } as const;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    return { error: "Pick a date." } as const;
  }
  if (input.type !== "meeting") {
    return {
      fields: {
        event_type: input.type,
        name,
        event_date: input.date,
        start_time: null,
        end_time: null,
      },
    } as const;
  }
  if (
    !input.startTime ||
    !input.endTime ||
    !TIME_PATTERN.test(input.startTime) ||
    !TIME_PATTERN.test(input.endTime)
  ) {
    return { error: "Pick a start and end time." } as const;
  }
  if (timeToMinutes(input.endTime) <= timeToMinutes(input.startTime)) {
    return { error: "The meeting has to end after it starts." } as const;
  }
  return {
    fields: {
      event_type: input.type,
      name,
      event_date: input.date,
      start_time: input.startTime,
      end_time: input.endTime,
    },
  } as const;
}

// Events are project details — admin-only, like Edit Project (a
// foreman can still see them; see 0055_project_events.sql).
async function requireAdmin() {
  const profile = await getSessionProfile();
  return profile && isAdminRole(profile.role) ? profile : null;
}

/** Adds an event from the Calendar view's own Add event. A holiday
 * event also marks the day off (projects.holidays, kept in sync by
 * 0055_project_events.sql's trigger). */
export async function createProjectEvent(
  projectId: number,
  input: ProjectEventInput
): Promise<ProjectEventActionState> {
  try {
    const profile = await requireAdmin();
    if (!profile) return { error: "You are not authorized to add events." };
    const event = normalizeEvent(input);
    if ("error" in event) return { error: event.error };

    const supabase = await createClient();
    const { error } = await supabase
      .from("project_events")
      .insert({ project_id: projectId, created_by: profile.id, ...event.fields });
    if (error) {
      console.error("[createProjectEvent] Supabase insert failed:", error);
      return { error: "Could not add the event. Please try again." };
    }

    revalidateProjectPaths(projectId);
    return { success: true };
  } catch (error) {
    console.error("[createProjectEvent] Unexpected error:", error);
    return { error: "Something went wrong. Please try again." };
  }
}

export async function updateProjectEvent(
  eventId: number,
  projectId: number,
  input: ProjectEventInput
): Promise<ProjectEventActionState> {
  try {
    const profile = await requireAdmin();
    if (!profile) return { error: "You are not authorized to edit events." };
    const event = normalizeEvent(input);
    if ("error" in event) return { error: event.error };

    const supabase = await createClient();
    const { error } = await supabase
      .from("project_events")
      .update(event.fields)
      .eq("id", eventId)
      .eq("project_id", projectId);
    if (error) {
      console.error("[updateProjectEvent] Supabase update failed:", error);
      return { error: "Could not save the event. Please try again." };
    }

    revalidateProjectPaths(projectId);
    return { success: true };
  } catch (error) {
    console.error("[updateProjectEvent] Unexpected error:", error);
    return { error: "Something went wrong. Please try again." };
  }
}

export async function deleteProjectEvent(
  eventId: number,
  projectId: number
): Promise<ProjectEventActionState> {
  try {
    const profile = await requireAdmin();
    if (!profile) return { error: "You are not authorized to delete events." };

    const supabase = await createClient();
    const { error } = await supabase
      .from("project_events")
      .delete()
      .eq("id", eventId)
      .eq("project_id", projectId);
    if (error) {
      console.error("[deleteProjectEvent] Supabase delete failed:", error);
      return { error: "Could not delete the event. Please try again." };
    }

    revalidateProjectPaths(projectId);
    return { success: true };
  } catch (error) {
    console.error("[deleteProjectEvent] Unexpected error:", error);
    return { error: "Something went wrong. Please try again." };
  }
}
