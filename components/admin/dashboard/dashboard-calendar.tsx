"use client";

import { useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { calendarMonth, manilaToday, monthDate } from "./calendar-model";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const monthLabel = (date: Date) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(date);
const dateLabel = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(`${iso}T00:00:00Z`));

export function DashboardCalendar({ initialToday }: { initialToday: string }) {
  const [today, setToday] = useState(initialToday);
  const [month, setMonth] = useState(() => monthDate(initialToday));
  useEffect(() => {
    const update = () => setToday(manilaToday());
    const interval = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", update); };
  }, []);
  function changeMonth(offset: number) {
    setMonth(current => new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + offset, 1)));
  }
  const days = calendarMonth(month.getUTCFullYear(), month.getUTCMonth());
  return (
    <section aria-label="Calendar" className="overflow-hidden rounded border border-zinc-200 bg-white">
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900"><CalendarDays aria-hidden className="size-4 text-zinc-500" />Calendar</h2>
        <button type="button" onClick={() => { setToday(manilaToday()); setMonth(monthDate(manilaToday())); }} className="cursor-pointer rounded px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900">Today</button>
      </div>
      <div className="px-4 pt-3 pb-4">
        <div className="mb-3 flex items-center justify-between">
          <button type="button" aria-label="Previous month" onClick={() => changeMonth(-1)} className="flex size-8 cursor-pointer items-center justify-center rounded text-zinc-500 hover:bg-zinc-100"><ChevronLeft aria-hidden className="size-4" /></button>
          <p aria-live="polite" className="text-sm font-semibold text-zinc-900">{monthLabel(month)}</p>
          <button type="button" aria-label="Next month" onClick={() => changeMonth(1)} className="flex size-8 cursor-pointer items-center justify-center rounded text-zinc-500 hover:bg-zinc-100"><ChevronRight aria-hidden className="size-4" /></button>
        </div>
        <table className="w-full table-fixed text-center" aria-label={monthLabel(month)}>
          <thead><tr>{WEEKDAYS.map(day => <th key={day} scope="col" className="pb-2 text-[11px] font-medium text-zinc-400">{day}</th>)}</tr></thead>
          <tbody>{Array.from({ length: 6 }, (_, week) => (
            <tr key={week}>{days.slice(week * 7, week * 7 + 7).map(day => (
              <td key={day.iso} className="py-0.5">
                <time dateTime={day.iso} aria-current={day.iso === today ? "date" : undefined} title={dateLabel(day.iso)}
                  className={`mx-auto flex size-8 items-center justify-center rounded-full text-xs tabular-nums ${day.iso === today ? "bg-zinc-900 font-semibold text-white" : day.inMonth ? "text-zinc-700" : "text-zinc-300"}`}>
                  {day.day}
                </time>
              </td>
            ))}</tr>
          ))}</tbody>
        </table>
      </div>
      <p className="border-t border-zinc-200 px-5 py-3 text-center text-xs text-zinc-500"><time dateTime={today}>{dateLabel(today)}</time></p>
    </section>
  );
}
