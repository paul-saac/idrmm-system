import type { ProjectEvent } from "@/lib/project-events/types";

/** Display-only slices; calendar exclusions are identical to Expected/forecast inputs. */
export function nonWorkingDaySlices(dates: readonly Date[], columnWidth: number, viewMode: string,
  workingDays: readonly number[], holidays: readonly string[], events: readonly ProjectEvent[]) {
  const weekdays = new Set(workingDays), excluded = new Set(holidays);
  const names = new Map<string, string[]>();
  for (const event of events) if (event.type === "holiday") names.set(event.date, [...(names.get(event.date) ?? []), event.name]);
  const slices: { date: string; x: number; width: number; holiday: boolean; title: string }[] = [];
  const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  for (let index = 0; index < dates.length; index++) {
    const start = dates[index], end = new Date(dates[index + 1] ?? start);
    if (!dates[index + 1]) {
      if (viewMode === "Year") end.setFullYear(end.getFullYear() + 1);
      else if (viewMode === "Month") end.setMonth(end.getMonth() + 1);
      else end.setDate(end.getDate() + (viewMode === "Week" ? 7 : 1));
    }
    const span = end.getTime() - start.getTime();
    if (span <= 0) continue;
    const day = new Date(start); day.setHours(0, 0, 0, 0);
    for (; day < end; day.setDate(day.getDate() + 1)) {
      const key = dateKey(day), holiday = excluded.has(key);
      if (!holiday && weekdays.has(day.getDay() || 7)) continue;
      const next = new Date(day); next.setDate(next.getDate() + 1);
      const left = Math.max(start.getTime(), day.getTime()), right = Math.min(end.getTime(), next.getTime());
      if (right <= left) continue;
      slices.push({ date: key, x: index * columnWidth + (left - start.getTime()) / span * columnWidth,
        width: (right - left) / span * columnWidth, holiday,
        title: holiday ? `${names.get(key)?.join(" / ") || "Holiday"} ? Non-working holiday`
          : `${day.toLocaleDateString("en-US", { weekday: "long" })} ? Non-working day` });
    }
  }
  return slices;
}
