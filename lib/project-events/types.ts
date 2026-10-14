/**
 * A project's calendar events (0055_project_events.sql) — shared by the
 * server data/actions and the Calendar view, so no "use server" here.
 */

export const PROJECT_EVENT_TYPES = [
  { value: "holiday", label: "Holiday" },
  { value: "meeting", label: "Meeting" },
] as const;

export type ProjectEventType = (typeof PROJECT_EVENT_TYPES)[number]["value"];

export function isProjectEventType(value: unknown): value is ProjectEventType {
  return PROJECT_EVENT_TYPES.some((type) => type.value === value);
}

export function projectEventTypeLabel(type: ProjectEventType): string {
  return PROJECT_EVENT_TYPES.find((option) => option.value === type)?.label ?? type;
}

export type ProjectEvent = {
  id: number;
  type: ProjectEventType;
  name: string;
  /** YYYY-MM-DD */
  date: string;
  /** "HH:MM" (24-hour) — meetings only, null otherwise. */
  startTime: string | null;
  endTime: string | null;
};

export const EVENT_NAME_MAX_LENGTH = 100;

/** "HH:MM" or "HH:MM:SS" → minutes after midnight. */
export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Minutes after midnight → "HH:MM". */
export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** "HH:MM" → "9:15 AM". */
export function formatTime(time: string): string {
  const total = timeToMinutes(time);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const suffix = hours < 12 ? "AM" : "PM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

/** 15 → "15 mins", 60 → "1 hr", 90 → "1.5 hrs". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} mins`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(2).replace(/0$/, "")} ${
    hours === 1 ? "hr" : "hrs"
  }`;
}
