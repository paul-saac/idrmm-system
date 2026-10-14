"use client";

import { useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Plus,
} from "lucide-react";
import { toIsoDate, toLocalDate } from "@/lib/task-progress/calculate";
import {
  formatTime,
  projectEventTypeLabel,
  type ProjectEvent,
  type ProjectEventType,
} from "@/lib/project-events/types";

/** One task (or task-less category) placed on the calendar. */
export type CalendarItem = {
  kind: "task" | "category";
  id: number;
  name: string;
  /** YYYY-MM-DD, both inclusive. */
  start: string;
  end: string;
  percentComplete: number;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_MS = 86_400_000;
// Bars start below the day number and stack in lanes of this height.
const BAR_TOP = 32;
const LANE_HEIGHT = 24;
// A day's events sit between its number and the bars, sized and spaced
// exactly like a task bar's lane (h-5 + gap-1 = LANE_HEIGHT), starting
// this far down the cell.
const EVENT_TOP = 34;
const EVENT_STEP = LANE_HEIGHT;

const EVENT_STYLE: Record<ProjectEventType, string> = {
  holiday: "bg-red-100 text-red-700",
  meeting: "bg-sky-100 text-sky-800",
};
const MIN_ROW_HEIGHT = 112;
// Same colors as the Gantt chart's own task bars (gantt-task-react's
// defaults — see gantt-chart-view.tsx), so the two views read as one.
const BAR_COLOR = "#b8c2cc";
const BAR_PROGRESS_COLOR = "#a3a3ff";
// The Gantt chart's own today column (its todayColor prop).
const TODAY_COLOR = "rgba(252, 211, 77, 0.15)";

const RANGE_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function daysBetween(from: Date, to: Date) {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

type Segment = {
  item: CalendarItem;
  startCol: number;
  endCol: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
};

/** Cuts every item down to the part inside one week, then stacks them
 * into lanes — the first lane each one fits in without overlapping. */
function layoutWeek(items: CalendarItem[], weekStart: Date) {
  const weekEnd = addDays(weekStart, 6);
  const pieces: Omit<Segment, "lane">[] = [];
  for (const item of items) {
    const start = toLocalDate(item.start);
    const end = toLocalDate(item.end);
    if (end < weekStart || start > weekEnd) continue;
    pieces.push({
      item,
      startCol: Math.max(0, daysBetween(weekStart, start)),
      endCol: Math.min(6, daysBetween(weekStart, end)),
      continuesBefore: start < weekStart,
      continuesAfter: end > weekEnd,
    });
  }
  pieces.sort(
    (a, b) => a.startCol - b.startCol || b.endCol - b.startCol - (a.endCol - a.startCol)
  );
  const laneEnds: number[] = [];
  const segments = pieces.map((piece) => {
    let lane = laneEnds.findIndex((end) => end < piece.startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(piece.endCol);
    } else {
      laneEnds[lane] = piece.endCol;
    }
    return { ...piece, lane };
  });
  return { segments, lanes: laneEnds.length };
}

function SelectBox({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  options: { value: number; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="cursor-pointer appearance-none rounded border border-zinc-200 bg-white py-1.5 pr-8 pl-3 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-400"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-zinc-400" />
    </div>
  );
}

/**
 * The Gantt chart's Calendar view — the project's tasks laid out on a
 * month calendar, each a bar across the days it runs (its progress
 * filled in, same colors as the Gantt bars). Hovering a bar shows its
 * dates and % complete; clicking it opens the same Daily Progress Update
 * a Gantt bar does.
 *
 * Each day also lists its events (0055_project_events.sql) — holidays,
 * meetings — as chips above the bars. Hovering
 * a day offers Add event, and clicking a chip opens that event; both
 * only for someone who can edit them (canEditEvents). A holiday's day is
 * tinted red, from the project's own holiday list (`holidays`).
 */
export function ProjectCalendarView({
  items,
  events,
  holidays,
  workingDays,
  canEditEvents,
  onAddEvent,
  onEventClick,
  onItemClick,
}: {
  items: CalendarItem[];
  events: ProjectEvent[];
  holidays: readonly string[];
  workingDays: readonly number[];
  canEditEvents: boolean;
  onAddEvent: (iso: string) => void;
  onEventClick: (event: ProjectEvent) => void;
  onItemClick: (item: CalendarItem) => void;
}) {
  const today = toIsoDate(new Date());
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const holidaySet = useMemo(() => new Set(holidays), [holidays]);
  const eventsByDate = useMemo(() => {
    const map = new Map<string, ProjectEvent[]>();
    for (const event of events) {
      const list = map.get(event.date);
      if (list) list.push(event);
      else map.set(event.date, [event]);
    }
    return map;
  }, [events]);

  // Sunday on/before the 1st through Saturday on/after the last day.
  const weekStarts = useMemo(() => {
    const gridStart = addDays(month, -month.getDay());
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const gridEnd = addDays(last, 6 - last.getDay());
    const count = (daysBetween(gridStart, gridEnd) + 1) / 7;
    return Array.from({ length: count }, (_, week) => addDays(gridStart, week * 7));
  }, [month]);

  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 11 }, (_, i) => thisYear - 5 + i);
  if (!years.includes(month.getFullYear())) years.push(month.getFullYear());

  function shiftMonth(delta: number) {
    setMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  }

  return (
    <div className="border-x border-b border-zinc-200 bg-white">
      <div className="flex items-center justify-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          aria-label="Previous month"
          className="cursor-pointer rounded p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
        >
          <ChevronLeft className="size-4" />
        </button>
        <SelectBox
          label="Month"
          value={month.getMonth()}
          onChange={(value) => setMonth(new Date(month.getFullYear(), value, 1))}
          options={MONTHS.map((label, value) => ({ value, label }))}
        />
        <SelectBox
          label="Year"
          value={month.getFullYear()}
          onChange={(value) => setMonth(new Date(value, month.getMonth(), 1))}
          options={years.sort((a, b) => a - b).map((value) => ({ value, label: String(value) }))}
        />
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          aria-label="Next month"
          className="cursor-pointer rounded p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 border-y border-zinc-200 bg-zinc-50">
        {WEEKDAYS.map((weekday) => (
          <span
            key={weekday}
            className="px-2 py-2 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase"
          >
            {weekday}
          </span>
        ))}
      </div>

      {weekStarts.map((weekStart) => {
        const { segments, lanes } = layoutWeek(items, weekStart);
        // Bars start below the busiest day's event chips, so a chip never
        // sits under a bar.
        const maxEvents = Math.max(
          0,
          ...Array.from(
            { length: 7 },
            (_, col) => eventsByDate.get(toIsoDate(addDays(weekStart, col)))?.length ?? 0
          )
        );
        const barTop = maxEvents > 0 ? EVENT_TOP + maxEvents * EVENT_STEP : BAR_TOP;
        const rowHeight = Math.max(MIN_ROW_HEIGHT, barTop + lanes * LANE_HEIGHT + 8);
        return (
          <div
            key={weekStart.getTime()}
            className="relative grid grid-cols-7 border-b border-zinc-200 last:border-b-0"
            style={{ height: rowHeight }}
          >
            {Array.from({ length: 7 }, (_, col) => {
              const date = addDays(weekStart, col);
              const iso = toIsoDate(date);
              const inMonth = date.getMonth() === month.getMonth();
              const isHoliday = holidaySet.has(iso);
              const isWorking = workingDays.includes(date.getDay() || 7);
              const isToday = iso === today;
              const dayEvents = eventsByDate.get(iso) ?? [];
              return (
                <div
                  key={iso}
                  className={`group relative border-r border-zinc-200 px-2 pt-1.5 last:border-r-0 ${
                    isToday
                      ? ""
                      : isHoliday
                        ? "bg-red-50"
                        : !isWorking || !inMonth
                          ? "bg-zinc-50"
                          : ""
                  }`}
                  style={isToday ? { backgroundColor: TODAY_COLOR } : undefined}
                >
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span
                        className={`flex size-6 shrink-0 items-center justify-center text-xs tabular-nums ${
                          isToday
                            ? "font-semibold text-zinc-900"
                            : inMonth && isWorking
                              ? "font-medium text-zinc-900"
                              : "text-zinc-400"
                        }`}
                      >
                        {date.getDate()}
                      </span>
                      {/* A holiday with no event behind it (e.g. before
                          0055_project_events.sql has run). */}
                      {isHoliday && !dayEvents.some((e) => e.type === "holiday") && (
                        <span className="truncate text-[10px] font-semibold text-red-600">
                          Holiday
                        </span>
                      )}
                    </div>
                    {canEditEvents && (
                      <button
                        type="button"
                        onClick={() => onAddEvent(iso)}
                        className="flex shrink-0 cursor-pointer items-center gap-1 rounded bg-zinc-900 px-1.5 py-0.5 text-[11px] font-medium text-white opacity-0 transition group-hover:opacity-100 hover:bg-zinc-800 focus-visible:opacity-100"
                      >
                        <Plus className="size-3" />
                        Add event
                      </button>
                    )}
                  </div>
                  {dayEvents.length > 0 && (
                    // -mx-1: the cell's own px-2 less 4px, the same inset
                    // a task bar keeps from the cell edges.
                    <div className="-mx-1 mt-1 flex flex-col gap-1">
                      {dayEvents.map((event) => (
                        <button
                          key={event.id}
                          type="button"
                          onClick={() => onEventClick(event)}
                          disabled={!canEditEvents}
                          title={`${projectEventTypeLabel(event.type)}: ${event.name}${
                            event.startTime && event.endTime
                              ? `, ${formatTime(event.startTime)} – ${formatTime(event.endTime)}`
                              : ""
                          }`}
                          className={`flex h-5 w-full items-center gap-1 rounded px-2 text-left text-[11px] font-medium enabled:cursor-pointer enabled:hover:brightness-95 ${EVENT_STYLE[event.type]}`}
                        >
                          {/* Marks it as an event, not a task bar. */}
                          <CalendarDays className="size-3 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{event.name}</span>
                          {/* Time on the far right, apart from the name. */}
                          {event.startTime && (
                            <span className="shrink-0 font-semibold tabular-nums">
                              {formatTime(event.startTime)}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {segments.map((segment) => {
              const span = segment.endCol - segment.startCol + 1;
              const leftInset = segment.continuesBefore ? 0 : 4;
              const rightInset = segment.continuesAfter ? 0 : 4;
              const { item } = segment;
              return (
                <div
                  key={`${item.kind}-${item.id}`}
                  className="group/bar absolute z-10 hover:z-30"
                  style={{
                    top: barTop + segment.lane * LANE_HEIGHT,
                    left: `calc(${segment.startCol} * 100% / 7 + ${leftInset}px)`,
                    width: `calc(${span} * 100% / 7 - ${leftInset + rightInset}px)`,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onItemClick(item)}
                    className={`relative flex h-5 w-full cursor-pointer items-center overflow-hidden text-left transition hover:brightness-95 ${
                      segment.continuesBefore ? "" : "rounded-l"
                    } ${segment.continuesAfter ? "" : "rounded-r"}`}
                    style={{ backgroundColor: BAR_COLOR }}
                  >
                    <span
                      className="absolute inset-y-0 left-0"
                      style={{
                        width: `${Math.min(100, item.percentComplete)}%`,
                        backgroundColor: BAR_PROGRESS_COLOR,
                      }}
                    />
                    <span className="relative truncate px-2 text-[11px] font-medium text-zinc-900">
                      {item.name}
                    </span>
                  </button>
                  <div
                    className={`pointer-events-none absolute top-full mt-1.5 hidden w-56 rounded border border-zinc-200 bg-white p-3 shadow-lg group-hover/bar:block ${
                      segment.startCol >= 4 ? "right-0" : "left-0"
                    }`}
                  >
                    <p className="truncate text-sm font-semibold text-zinc-900">{item.name}</p>
                    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-zinc-600">
                      <CalendarDays className="size-3.5 text-zinc-400" />
                      {RANGE_LABEL.format(toLocalDate(item.start))} –{" "}
                      {RANGE_LABEL.format(toLocalDate(item.end))}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-zinc-600">
                      <Gauge className="size-3.5 text-zinc-400" />
                      <span className="font-semibold text-zinc-900">
                        {item.percentComplete.toFixed(0)}%
                      </span>
                      complete
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
