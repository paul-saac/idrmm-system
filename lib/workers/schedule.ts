// A member's week (Working Days, 0069_hourly_rates_work_hours.sql) — hours
// for each day, Monday first. Client-safe (no server imports), shared by
// the member form, their profile and the progress window.

/** A week's hours when none are set — Monday to Friday, 8 each. */
export const DEFAULT_WORK_HOURS = [8, 8, 8, 8, 8, 0, 0];

/** Mon..Sun, for a week's hours (Monday first). */
export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A date's place in a Monday-first week: 0 = Monday, 6 = Sunday. */
export function weekdayIndex(date: Date = new Date()) {
  return (date.getDay() + 6) % 7;
}

/** "12 hrs", "1 hr", "7.5 hrs". */
export function formatHours(hours: number) {
  const value = Math.round(hours * 100) / 100;
  return `${value.toLocaleString("en-PH")} hr${value === 1 ? "" : "s"}`;
}
