export function projectScheduleDates(start: string | null, end: string | null) {
  const first = start || end || null;
  const last = end || first;
  return { start: first, end: first && last && last < first ? first : last };
}

export function isScheduleDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    && date.getUTCFullYear() >= 1980 && date.getUTCFullYear() <= 2100;
}

export function shiftScheduleDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export type ScheduleDateChange = {
  kind: "category" | "task";
  id: number;
  start: string;
  end: string;
  previousStart: string | null;
  previousEnd: string | null;
};
