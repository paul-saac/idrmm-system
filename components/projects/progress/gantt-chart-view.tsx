"use client";

import { useMemo, useRef, useState } from "react";
import { Gantt, Willow, type IApi, type ILink, type ITask } from "@svar-ui/react-gantt";
import "@svar-ui/react-gantt/all.css";
import { ChevronsDown, ChevronsUp, CalendarDays } from "lucide-react";
import type { CostCategory } from "@/lib/cost-estimate/data";
import type { ProjectProgress } from "@/lib/progress/data";

function toDate(iso: string) {
  return new Date(`${iso}T00:00:00`);
}

function formatCurrency(amount: number) {
  return `₱${amount.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

function formatDateCell(value: unknown) {
  if (!(value instanceof Date)) return "—";
  return value.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function daysBetween(start: Date, end: Date) {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
}

function phaseRowId(categoryId: number) {
  return `phase-${categoryId}`;
}

// `format` as a plain string is NOT a date-fns-style token pattern —
// verified empirically (it renders the string back out completely
// literally, e.g. a literal "MMMM yyyy" label instead of "May 2026").
// Only the function form works, so every level below uses one.
const formatYear = (date: Date) => String(date.getFullYear());
const formatMonthYear = (date: Date) =>
  date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
const formatMonthShort = (date: Date) => date.toLocaleDateString("en-US", { month: "short" });
const formatQuarter = (date: Date) =>
  `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`;
const formatWeekOf = (date: Date) =>
  `Week of ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
const formatDayNum = (date: Date) => String(date.getDate());
const formatWeekdayDayNum = (date: Date) =>
  date.toLocaleDateString("en-US", { weekday: "short", day: "numeric" });

// Named timeline views (a toolbar control, not continuous scroll-zoom —
// continuous zoom was tried first and dropped: it has no natural
// "which preset am I on" state to highlight a button against, and
// jumping straight to a named granularity is what construction PM
// tools (and the reference demo) actually offer). Each view is its own
// `scales` array; switching views remounts the chart (via `key`) since
// SVAR has no supported way to swap scales on a live instance.
type TimelineView = "day" | "week" | "month" | "quarter" | "year";

const VIEW_SCALES: Record<TimelineView, { unit: string; step: number; format: (d: Date) => string }[]> = {
  day: [
    { unit: "month", step: 1, format: formatMonthYear },
    { unit: "day", step: 1, format: formatWeekdayDayNum },
  ],
  // Month -> Week -> Day, three tiers — confirmed SVAR renders an
  // arbitrary-length `scales` array as that many stacked header rows
  // (verified directly, not assumed from the type signature alone).
  week: [
    { unit: "month", step: 1, format: formatMonthYear },
    { unit: "week", step: 1, format: formatWeekOf },
    { unit: "day", step: 1, format: formatDayNum },
  ],
  month: [
    { unit: "year", step: 1, format: formatYear },
    { unit: "month", step: 1, format: formatMonthShort },
  ],
  quarter: [
    { unit: "year", step: 1, format: formatYear },
    { unit: "quarter", step: 1, format: formatQuarter },
  ],
  year: [{ unit: "year", step: 1, format: formatYear }],
};

const VIEW_CELL_WIDTH: Record<TimelineView, number> = {
  day: 60,
  week: 34,
  month: 60,
  quarter: 90,
  year: 120,
};

const VIEW_LABELS: Record<TimelineView, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  quarter: "Quarter",
  year: "Year",
};

const TOOLBAR_BUTTON_CLASS =
  "flex cursor-pointer items-center gap-1.5 rounded border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900";
const TOOLBAR_BUTTON_ACTIVE_CLASS =
  "flex cursor-pointer items-center gap-1.5 rounded border border-zinc-800 bg-zinc-800 px-2.5 py-1.5 text-xs font-medium text-white transition";

/**
 * The Schedule sub-tab: a real, read-only Gantt chart built on
 * @svar-ui/react-gantt (MIT-licensed core) — native task table (left)
 * synced with a native timeline (right), native hierarchy for phase
 * grouping (Cost Estimate categories as collapsible parent rows), and
 * native progress bars with a custom percentage label.
 *
 * Deliberately read-only (`readonly` on <Gantt>) — Task/Category
 * identity and every date live in the Cost Estimate Breakdown, which is
 * the single source of truth; this view only visualizes it. Dragging
 * was tried first and dropped: it let two places disagree about a
 * task's dates, and reverting a disallowed drag back to the stored
 * value produced a visible flicker. A non-interactive chart has nothing
 * to revert, because nothing here can change in the first place.
 *
 * Each phase (category) is a `type: "summary"` parent row. Auto-rollup
 * of a summary row's own dates from its children is a PRO-only feature
 * ("Summary task automation"), so this component computes each phase's
 * aggregate start/end/progress itself from its tasks.
 *
 * Bounded-height with the chart's own internal scroll (both axes) —
 * not full-page scroll. An earlier version let the chart grow to its
 * full natural height and relied on the page's own scroll container,
 * but that scrolled the toolbar and table headers away too; a fixed
 * box with @svar-ui/react-gantt's own internal scrollbar keeps both
 * sticky while only the rows/timeline move. Getting that internal
 * scroll to activate at all takes forcing `height:100%` through two
 * nested theme wrapper divs via Tailwind's arbitrary child-selectors —
 * @svar-ui/react-gantt sizes itself to its own content by default and
 * only respects a parent height if that parent chain actually has one
 * (verified by measuring computed heights directly, not assumed).
 */
export function GanttChartView({
  categories,
  progress,
  projectStartDate,
}: {
  categories: CostCategory[];
  progress: ProjectProgress;
  projectStartDate: string | null;
}) {
  const apiRef = useRef<IApi | null>(null);
  const [view, setView] = useState<TimelineView>("week");

  const percentCompleteByTaskId = useMemo(() => {
    const map = new Map<number, number>();
    for (const category of progress.categories) {
      for (const task of category.tasks) {
        map.set(task.id, task.percentComplete);
      }
    }
    return map;
  }, [progress]);

  const percentCompleteByCategoryId = useMemo(() => {
    const map = new Map<number, number>();
    for (const category of progress.categories) {
      map.set(category.id, category.percentComplete);
    }
    return map;
  }, [progress]);

  const fallbackStart = projectStartDate ? toDate(projectStartDate) : new Date();
  const fallbackEnd = new Date(fallbackStart.getTime() + 7 * 86_400_000);

  function resolvedDates(task: { plannedStartDate: string | null; plannedEndDate: string | null }) {
    return {
      start: task.plannedStartDate ? toDate(task.plannedStartDate) : fallbackStart,
      end: task.plannedEndDate ? toDate(task.plannedEndDate) : fallbackEnd,
    };
  }

  const tasks: ITask[] = useMemo(() => {
    const result: ITask[] = [];
    for (const category of categories) {
      if (category.tasks.length === 0) continue;

      const childDates = category.tasks.map(resolvedDates);
      const cost = category.tasks.reduce((sum, t) => sum + t.totalEstimateCost, 0);

      result.push({
        id: phaseRowId(category.id),
        text: category.name,
        type: "summary",
        open: true,
        start: new Date(Math.min(...childDates.map((d) => d.start.getTime()))),
        end: new Date(Math.max(...childDates.map((d) => d.end.getTime()))),
        progress: percentCompleteByCategoryId.get(category.id) ?? 0,
        cost,
      });

      category.tasks.forEach((task, i) => {
        const scheduled = Boolean(task.plannedStartDate && task.plannedEndDate);
        result.push({
          id: task.id,
          parent: phaseRowId(category.id),
          text: task.name,
          type: "task",
          start: childDates[i].start,
          end: childDates[i].end,
          progress: percentCompleteByTaskId.get(task.id) ?? 0,
          cost: task.totalEstimateCost,
          unscheduled: !scheduled,
        });
      });
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, percentCompleteByCategoryId, percentCompleteByTaskId]);

  // One dependency arrow per task with a predecessor set (Finish-to-Start
  // — see 0029_estimate_task_predecessor.sql). Self-referencing links are
  // already rejected server-side (validatePredecessor in
  // lib/cost-estimate/actions.ts), but the guard stays here too since
  // this list feeds straight into what SVAR draws.
  const links: ILink[] = useMemo(() => {
    const result: ILink[] = [];
    for (const category of categories) {
      for (const task of category.tasks) {
        if (task.predecessorTaskId && task.predecessorTaskId !== task.id) {
          result.push({
            id: `link-${task.predecessorTaskId}-${task.id}`,
            source: task.predecessorTaskId,
            target: task.id,
            type: "e2s",
          });
        }
      }
    }
    return result;
  }, [categories]);

  const hasAnyTask = categories.some((c) => c.tasks.length > 0);

  const columns = useMemo(
    () => [
      // Task stays left-aligned (it's a name, reads left-to-right like
      // any text). Start/End are dates, also left-aligned — reads more
      // naturally than centering a short string in a wide-ish column.
      // Days/Cost/% are the numeric columns, right-aligned to the
      // standard spreadsheet/table convention (digits line up by place
      // value, making magnitudes easy to compare down the column) —
      // "align to the text" meaning alignment that matches what kind of
      // text each column actually holds, not one alignment for all of
      // them. Widths adjusted so no header truncates ("Days" was
      // clipping to "D…" at 56px) while task names still get the most
      // room, the column most likely to need it.
      // flexgrow: 0 is deliberate — the "text" column carries
      // `flex-grow: 1` by default (confirmed via its actual inline
      // style, not assumed), the only column of the six that does, so
      // without this it can grow past its own configured width to fill
      // whatever extra space the grid pane happens to have. The other
      // five columns are already fixed-width; this makes Task match
      // them instead of being the one column that silently doesn't.
      { id: "text", header: "Task", width: 176, flexgrow: 0 },
      {
        id: "start",
        header: "Start",
        width: 72,
        cell: ({ row }: { row: ITask }) => (
          <span className="text-xs text-zinc-500">{formatDateCell(row.start)}</span>
        ),
      },
      {
        id: "end",
        header: "End",
        width: 72,
        cell: ({ row }: { row: ITask }) => (
          <span className="text-xs text-zinc-500">{formatDateCell(row.end)}</span>
        ),
      },
      {
        id: "duration",
        header: "Days",
        width: 74,
        align: "right" as const,
        cell: ({ row }: { row: ITask }) => (
          <span className="text-xs text-zinc-500">
            {row.start instanceof Date && row.end instanceof Date
              ? daysBetween(row.start, row.end)
              : "—"}
          </span>
        ),
      },
      {
        id: "cost",
        header: "Cost",
        width: 96,
        align: "right" as const,
        cell: ({ row }: { row: ITask }) => (
          <span className="text-xs text-zinc-500">
            {formatCurrency(Number(row.cost) || 0)}
          </span>
        ),
      },
      {
        id: "progress",
        header: "%",
        width: 50,
        align: "right" as const,
        cell: ({ row }: { row: ITask }) => (
          <span className="text-xs text-zinc-500">{row.progress ?? 0}%</span>
        ),
      },
    ],
    []
  );

  const phaseIds = useMemo(
    () => categories.filter((c) => c.tasks.length > 0).map((c) => phaseRowId(c.id)),
    [categories]
  );

  function setAllPhasesOpen(open: boolean) {
    const api = apiRef.current;
    if (!api) return;
    for (const id of phaseIds) {
      void api.exec("open-task", { id, mode: open });
    }
  }

  if (!hasAnyTask) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white py-16 text-center">
        <p className="text-sm font-medium text-zinc-700">
          No tasks to schedule yet
        </p>
        <p className="mt-1 text-sm text-zinc-400">
          Add task items in the Cost Estimate Breakdown first.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-zinc-400 italic">
        Read-only view of the schedule — set or change a task&apos;s planned
        dates from the Cost Estimate Breakdown. Tasks without a planned
        schedule show a temporary placeholder date here.
      </p>

      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2 py-1.5">
        {(Object.keys(VIEW_LABELS) as TimelineView[]).map((v) => (
          <button
            key={v}
            type="button"
            className={v === view ? TOOLBAR_BUTTON_ACTIVE_CLASS : TOOLBAR_BUTTON_CLASS}
            onClick={() => setView(v)}
          >
            {VIEW_LABELS[v]}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-zinc-200" />
        <button
          type="button"
          className={TOOLBAR_BUTTON_CLASS}
          onClick={() => setAllPhasesOpen(true)}
        >
          <ChevronsDown className="size-3.5" />
          Expand all
        </button>
        <button
          type="button"
          className={TOOLBAR_BUTTON_CLASS}
          onClick={() => setAllPhasesOpen(false)}
        >
          <ChevronsUp className="size-3.5" />
          Collapse all
        </button>
        <span className="mx-1 h-4 w-px bg-zinc-200" />
        <button
          type="button"
          className={TOOLBAR_BUTTON_CLASS}
          onClick={() => void apiRef.current?.exec("scroll-chart", { date: new Date() })}
        >
          <CalendarDays className="size-3.5" />
          Today
        </button>
      </div>

      <div className="flex h-160 flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white [&>div]:min-h-0 [&>div]:flex-1 [&>div>div]:h-full">
        <Willow>
          <Gantt
            key={view}
            init={(api) => {
              apiRef.current = api;
            }}
            readonly
            tasks={tasks}
            links={links}
            columns={columns}
            gridWidth={540}
            cellHeight={30}
            cellWidth={VIEW_CELL_WIDTH[view]}
            scales={VIEW_SCALES[view]}
            taskTemplate={({ data }) => (
              <div className="wx-content flex h-full items-center justify-center overflow-hidden px-1 text-xs font-medium">
                {Math.round(data.progress ?? 0)}%
              </div>
            )}
          />
        </Willow>
      </div>
    </div>
  );
}
