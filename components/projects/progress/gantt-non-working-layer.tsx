"use client";
import { useMemo } from "react";
import type { ProjectEvent } from "@/lib/project-events/types";
import { nonWorkingDaySlices } from "./gantt-non-working-days";

export type CalendarLayerGeometry = { dates: Date[]; columnWidth: number; height: number; header: boolean; viewMode: string };
export function GanttNonWorkingLayer({ dates, columnWidth, height, header, viewMode, workingDays, holidays, events }:
  CalendarLayerGeometry & { workingDays: readonly number[]; holidays: readonly string[]; events: readonly ProjectEvent[] }) {
  const slices = useMemo(() => viewMode === "Day" ? nonWorkingDaySlices(dates, columnWidth, viewMode, workingDays, holidays, events) : [],
    [dates, columnWidth, viewMode, workingDays, holidays, events]);
  if (viewMode !== "Day") return null;
  return <g className="gantt-non-working-days" pointerEvents={header ? "auto" : "none"}>
    {slices.map(day => <g key={`${day.date}-${day.x}`}>
      <rect x={day.x} y={0} width={day.width} height={height} fill={header ? "transparent" : day.holiday ? "rgba(239,68,68,0.09)" : "rgba(113,113,122,0.08)"}>
        {header && <title>{day.title}</title>}
      </rect>
    </g>)}
  </g>;
}
