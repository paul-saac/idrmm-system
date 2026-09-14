"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Gantt, ViewMode, type Task as GanttTask } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import {
  ChevronsDown,
  ChevronsUp,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { CategoryForm } from "@/components/projects/cost-estimate/category-form";
import { TaskForm } from "@/components/projects/cost-estimate/task-form";
import { AddPhaseForm } from "@/components/projects/progress/add-phase-form";
import {
  CategoryDeleteButton,
  TaskDeleteButton,
} from "@/components/projects/cost-estimate/cost-estimate-view";
import { updateTaskSchedule } from "@/lib/cost-estimate/actions";
import type { CostCategory, CostTask } from "@/lib/cost-estimate/data";
import type { ProjectProgress } from "@/lib/progress/data";

function toDate(iso: string) {
  return new Date(`${iso}T00:00:00`);
}

function formatDateCell(value: Date) {
  return value.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function daysBetween(start: Date, end: Date) {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
}

function phaseRowId(categoryId: number) {
  return `phase-${categoryId}`;
}

/** Local-date components, not UTC — matches how toDate() above parses
 * `${iso}T00:00:00` as local midnight, so a round trip through this
 * never shifts a day at a timezone boundary. */
function toIsoDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Mirrors gantt-task-react's own default hover tooltip (StandardTooltipContent)
// pixel-for-pixel — same date format, same CSS-module classes (_3T42e/_29NTg,
// confirmed directly by reading the compiled bundle, the same technique
// already used for the barLabel classes referenced in globals.css) — with
// one deliberate change: Progress always renders, even at 0%. The
// library's own version guards it behind `!!task.progress`, so a task
// that hasn't started yet silently drops the line instead of showing
// "Progress: 0%".
function GanttTooltipContent({
  task,
  fontSize,
  fontFamily,
}: {
  task: GanttTask;
  fontSize: string;
  fontFamily: string;
}) {
  const durationDays = Math.floor(
    (task.end.getTime() - task.start.getTime()) / 86_400_000
  );
  const headingSize = (parseInt(fontSize, 10) || 14) + 6;

  return (
    <div className="_3T42e" style={{ fontSize, fontFamily }}>
      <b style={{ fontSize: `${headingSize}px` }}>
        {task.name}: {task.start.getDate()}-{task.start.getMonth() + 1}-
        {task.start.getFullYear()} - {task.end.getDate()}-
        {task.end.getMonth() + 1}-{task.end.getFullYear()}
      </b>
      {durationDays !== 0 && (
        <p className="_29NTg">Duration: {durationDays} day(s)</p>
      )}
      <p className="_29NTg">Progress: {Math.round(task.progress)}%</p>
    </div>
  );
}

// gantt-task-react's ViewMode enum has no "Quarter" granularity (it has
// Hour/QuarterDay/HalfDay/Day/Week/Month/Year instead — the "Quarter"
// options are sub-day zoom levels, not a 3-month view) — one real
// capability gap versus the previous SVAR build, not something this
// component can work around.
type TimelineView = "day" | "week" | "month" | "year";

const VIEW_MODE: Record<TimelineView, ViewMode> = {
  day: ViewMode.Day,
  week: ViewMode.Week,
  month: ViewMode.Month,
  year: ViewMode.Year,
};

const VIEW_LABELS: Record<TimelineView, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  year: "Year",
};

// Baseline column width per zoom level — the actual width used is
// whichever is wider between this and "however much it takes to fill
// the chart's available width" (see effectiveColumnWidth below), so a
// short project never leaves a dead strip of blank space to the right
// of its bars, and a long one still falls back to a sane, readable
// minimum and scrolls horizontally instead of over-compressing.
const BASE_COLUMN_WIDTH: Record<TimelineView, number> = {
  day: 60,
  week: 50,
  month: 100,
  year: 300,
};

// Rough (deliberately over-, never under-, estimated) count of header
// columns gantt-task-react will render for a given date span and zoom
// level — used only to size columns to fill available width, not to
// reproduce the library's exact internal date-seeding logic (which
// isn't exposed). Padded generously so a slight overestimate (columns a
// touch narrower than perfectly exact) is the failure mode, never an
// underestimate that would overshoot the container and defeat the
// point of this calculation.
function estimateColumnCount(view: TimelineView, min: Date, max: Date) {
  const days = Math.max(
    1,
    Math.round((max.getTime() - min.getTime()) / 86_400_000)
  );
  switch (view) {
    case "day":
      return days + 3;
    case "week":
      return Math.ceil(days / 7) + 3;
    case "month":
      return (
        (max.getFullYear() - min.getFullYear()) * 12 +
        (max.getMonth() - min.getMonth()) +
        3
      );
    case "year":
      return max.getFullYear() - min.getFullYear() + 3;
  }
}

// Same hand-built column-resize approach as the Cost Estimate Breakdown
// grid needed for SVAR — except here it's simpler: TaskListHeader/
// TaskListTable are plain React components we supply outright (not a
// string/HTML template rendered by the library), so a columnWidths
// state change is just a normal React re-render of our own lightweight
// table, not something that forces the whole chart to re-init. No
// guide-line-then-snap-on-release needed — every column resizes live.
const RESIZABLE_COLUMN_IDS = ["text", "start", "end", "duration"] as const;
type ResizableColumnId = (typeof RESIZABLE_COLUMN_IDS)[number];

// Start/end are wider than a plain date label needs — the native
// <input type="date"> that renders in those columns (see
// CustomTaskListTable) wants more room for its "MM/DD/YYYY" segments
// plus the calendar-icon affordance than static text like "Jan 5" did.
const DEFAULT_COLUMN_WIDTHS: Record<ResizableColumnId, number> = {
  text: 176,
  start: 108,
  end: 108,
  duration: 60,
};

const MIN_COLUMN_WIDTH: Record<ResizableColumnId, number> = {
  text: 100,
  start: 84,
  end: 84,
  duration: 40,
};

// Wide enough for the busiest case: a phase row's add-task / edit /
// delete trio. Task rows only ever show two of the three (no add-task),
// so they sit with a little extra breathing room in the same column.
const ACTIONS_COLUMN_WIDTH = 88;

const COLUMN_LABEL: Record<ResizableColumnId, string> = {
  text: "Task",
  start: "Start",
  end: "End",
  duration: "Days",
};

const RIGHT_ALIGNED_COLUMNS = new Set<ResizableColumnId>(["duration"]);

const TOOLBAR_BUTTON_CLASS =
  "flex cursor-pointer items-center gap-1.5 rounded border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900";
const TOOLBAR_BUTTON_ACTIVE_CLASS =
  "flex cursor-pointer items-center gap-1.5 rounded border border-zinc-800 bg-zinc-800 px-2.5 py-1.5 text-xs font-medium text-white transition";

const ROW_HEIGHT = 34;
const HEADER_HEIGHT = 44;

// No per-task `styles` override and no barCornerRadius prop below —
// both deliberately left at the library's own defaults (barBackgroundColor
// #b8c2cc / barProgressColor #a3a3ff for tasks, projectBackgroundColor
// #fac465 / projectProgressColor #7db59a for phases, milestoneBackgroundColor
// #f1c453, barCornerRadius 3 — confirmed directly by reading the compiled
// bundle's own default props) so the chart matches gantt-task-react's own
// reference look exactly instead of drifting from it.
//
// A larger custom barCornerRadius (10, tried earlier) broke visibly on
// short-duration bars: a radius bigger than half a narrow bar's own
// pixel width pinches the rounded-rect into a lozenge/tent shape rather
// than a clean pill — confirmed directly on a handful of 1-2 day tasks.
// The library's own default of 3 stays proportionate at any bar width.

/**
 * The Schedule tab: the project's planning workspace, built on
 * `gantt-task-react` (MIT-licensed, dependency-free). Third Gantt
 * engine tried this session — after SVAR (kept, then reverted back to
 * after a DHTMLX detour) — chosen this time specifically for its
 * TaskListHeader/TaskListTable props: unlike SVAR's string-based column
 * config or DHTMLX's HTML-string cell templates, these are plain React
 * components we supply outright, so the Task/Start/End/Days/Actions
 * grid below is real JSX — including mounting the actual
 * CategoryDeleteButton/TaskDeleteButton components directly in a cell,
 * which DHTMLX's HTML-template cells couldn't do at all.
 *
 * Its React peer dependency is `^18.0.0` — this app runs React 19, so
 * it's installed with --legacy-peer-deps. Works in practice (verified
 * directly: rendering, dragging, and the custom grid all behave
 * correctly), but it's an unverified-by-upstream combination worth
 * knowing about if something Gantt-related ever breaks after a React
 * bump.
 *
 * Drag persistence is simpler here than either previous engine, verified
 * directly before writing this:
 *  - `onDateChange(task, children)` fires exactly once, on release — not
 *    per animation frame like SVAR's raw drag event, so no event needs
 *    filtering by an `inProgress` flag.
 *  - `children` lists tasks that *depend on* the dragged one via
 *    `dependencies`, but their own start/end come back unchanged — the
 *    library does not auto-cascade a reschedule through dependents, it
 *    only tells you who they are. This component deliberately ignores
 *    `children` and persists only the directly-dragged task, matching
 *    how the Predecessor field has always worked elsewhere in this
 *    app (a visual dependency arrow, not an auto-scheduling engine) —
 *    nothing here should move a task the user didn't directly touch.
 *  - Returning `false` from `onDateChange` makes the library revert the
 *    drag's own internal visual state itself — confirmed by testing a
 *    failed persist directly. No manual revert bookkeeping needed on a
 *    failure, unlike the SVAR build's router.refresh()-based
 *    reconciliation (still called after a *successful* persist, since
 *    that's what pulls the corrected phase-row rollup back down through
 *    the `categories` prop).
 *  - Phase ("project"-type) rows are natively not draggable at all —
 *    confirmed directly (no onDateChange call, no visual movement).
 *    SVAR needed an intercepted "drag-task" to stop a phase drag from
 *    cascading into moving every child task; this library never needed
 *    that guard, though one is still kept here as cheap insurance.
 *
 * Each phase (category) is a `type: "project"` row. Auto-rollup of a
 * project row's own start/end from its children is not something this
 * library computes for you (its `start`/`end` fields are required, not
 * derived) — same as the SVAR build, this component still computes each
 * phase's aggregate start/end/progress itself from its tasks.
 */
export function GanttChartView({
  projectId,
  categories,
  progress,
  projectStartDate,
}: {
  projectId: number;
  categories: CostCategory[];
  progress: ProjectProgress;
  projectStartDate: string | null;
}) {
  const router = useRouter();
  // Month is the default zoom: unlike Week, its column labels are plain
  // month names with no "W##" numbering that could read as resetting
  // each time the visible range crosses a year boundary (an ISO-8601
  // week-numbering quirk, not a bug, but confusing at a glance for a
  // non-technical viewer). Week is still one click away for anyone who
  // wants the finer granularity.
  const [view, setView] = useState<TimelineView>("month");
  const [categoryModal, setCategoryModal] = useState<
    | { mode: "add" }
    | { mode: "edit"; category: { id: number; name: string } }
    | null
  >(null);
  const [taskModal, setTaskModal] = useState<
    | { mode: "add"; defaultCategoryId?: number }
    | { mode: "edit"; task: CostTask }
    | null
  >(null);
  const [collapsedPhaseIds, setCollapsedPhaseIds] = useState<Set<string>>(
    new Set()
  );
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [columnWidths, setColumnWidths] =
    useState<Record<ResizableColumnId, number>>(DEFAULT_COLUMN_WIDTHS);
  // Collapsing the grid to just the timeline is a documented
  // gantt-task-react pattern: an empty `listCellWidth` hides it
  // entirely (not a boolean prop) — useful for a wide project where the
  // Task/Start/End/etc columns aren't needed and the timeline could use
  // the room.
  const [showTaskList, setShowTaskList] = useState(true);

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

  // Keyed by the same string ids used in the `tasks` array below, so the
  // custom TaskListTable can hand a clicked row's full record to the
  // Edit modal / delete button without needing anywhere to stash extra
  // fields on a GanttTask object (its type has no room for custom
  // properties, unlike SVAR's ITask or DHTMLX's Task).
  const taskById = useMemo(() => {
    const map = new Map<string, CostTask>();
    for (const category of categories) {
      for (const task of category.tasks) {
        map.set(String(task.id), task);
      }
    }
    return map;
  }, [categories]);

  const categoryById = useMemo(() => {
    const map = new Map<string, { id: number; name: string }>();
    for (const category of categories) {
      map.set(phaseRowId(category.id), { id: category.id, name: category.name });
    }
    return map;
  }, [categories]);

  const tasks: GanttTask[] = useMemo(() => {
    const result: GanttTask[] = [];
    for (const category of categories) {
      // A phase with no task items yet still gets its own row (with a
      // placeholder date range) rather than being skipped entirely —
      // otherwise there'd be nowhere in the Gantt itself to click "+"
      // and add that phase's very first task.
      const childDates =
        category.tasks.length > 0
          ? category.tasks.map(resolvedDates)
          : [{ start: fallbackStart, end: fallbackEnd }];

      result.push({
        id: phaseRowId(category.id),
        type: "project",
        name: category.name,
        start: new Date(Math.min(...childDates.map((d) => d.start.getTime()))),
        end: new Date(Math.max(...childDates.map((d) => d.end.getTime()))),
        progress: percentCompleteByCategoryId.get(category.id) ?? 0,
        hideChildren: collapsedPhaseIds.has(phaseRowId(category.id)),
      });

      category.tasks.forEach((task, i) => {
        // A milestone collapses to a single date — the planned end if
        // set (a milestone usually marks when something finishes, e.g.
        // "Permit Approved"), otherwise the planned start.
        const milestoneDate = task.plannedEndDate
          ? childDates[i].end
          : childDates[i].start;

        result.push({
          id: String(task.id),
          type: task.isMilestone ? "milestone" : "task",
          name: task.name,
          start: task.isMilestone ? milestoneDate : childDates[i].start,
          end: task.isMilestone ? milestoneDate : childDates[i].end,
          progress: percentCompleteByTaskId.get(task.id) ?? 0,
          project: phaseRowId(category.id),
          dependencies: task.predecessorTaskId
            ? [String(task.predecessorTaskId)]
            : undefined,
        });
      });
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    categories,
    percentCompleteByCategoryId,
    percentCompleteByTaskId,
    collapsedPhaseIds,
  ]);

  const hasAnyCategory = categories.length > 0;

  const totalColumnsWidth =
    RESIZABLE_COLUMN_IDS.reduce((sum, id) => sum + columnWidths[id], 0) +
    ACTIONS_COLUMN_WIDTH;

  // Earliest start / latest end across every rendered row (phase and
  // task), used only to estimate how many header columns the current
  // zoom level will draw — see estimateColumnCount above.
  const timelineExtent = useMemo(() => {
    if (tasks.length === 0) return null;
    let min = tasks[0].start.getTime();
    let max = tasks[0].end.getTime();
    for (const t of tasks) {
      if (t.start.getTime() < min) min = t.start.getTime();
      if (t.end.getTime() > max) max = t.end.getTime();
    }
    return { min: new Date(min), max: new Date(max) };
  }, [tasks]);

  // Measures the chart's own bordered wrapper so columnWidth can be
  // widened to fill it exactly when the project's date range is short
  // — without this, a short project renders its bars flush-left and
  // leaves the rest of the card as dead white space (confirmed directly
  // by inspecting a short-range render: the chart's own SVG came out
  // hundreds of pixels narrower than the wrapper around it).
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = chartWrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const effectiveColumnWidth = useMemo(() => {
    const base = BASE_COLUMN_WIDTH[view];
    if (!timelineExtent || containerWidth === 0) return base;
    const chartAreaWidth =
      containerWidth - (showTaskList ? totalColumnsWidth : 0);
    if (chartAreaWidth <= 0) return base;
    const unitCount = estimateColumnCount(
      view,
      timelineExtent.min,
      timelineExtent.max
    );
    return Math.max(base, Math.floor(chartAreaWidth / unitCount));
  }, [view, containerWidth, timelineExtent, showTaskList, totalColumnsWidth]);

  // Hand-built drag-to-resize for one column header — see the
  // RESIZABLE_COLUMN_IDS comment above. Global mousemove/mouseup
  // listeners so the drag keeps tracking even if the cursor leaves the
  // thin handle, cleaned up on mouseup.
  function handleResizeMouseDown(id: ResizableColumnId) {
    return (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = columnWidths[id];

      function onMove(ev: MouseEvent) {
        const delta = ev.clientX - startX;
        const newWidth = Math.max(MIN_COLUMN_WIDTH[id], startWidth + delta);
        setColumnWidths((prev) => ({ ...prev, [id]: newWidth }));
      }
      function onUp() {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
  }

  // Shared by both the drag-to-move/resize handler below and the
  // inline Start/End date inputs in the task list — same server action,
  // same error surfacing, same post-success refresh.
  async function persistTaskDates(
    taskId: number,
    startIso: string,
    endIso: string
  ): Promise<boolean> {
    setScheduleError(null);
    const result = await updateTaskSchedule(taskId, projectId, startIso, endIso);
    if (result.error) {
      setScheduleError(result.error);
      return false;
    }
    router.refresh(); // pulls the recomputed phase-row rollup back down
    return true;
  }

  async function persistDrag(task: GanttTask): Promise<boolean> {
    if (task.type === "project") return false; // cheap insurance — see doc comment; project rows never reach here in practice
    // A milestone only moves (no resize handles on a zero-duration
    // diamond), so task.start/task.end are still equal after a drag —
    // both get persisted as the same planned_start_date/planned_end_date.
    return persistTaskDates(Number(task.id), toIsoDate(task.start), toIsoDate(task.end));
  }

  // Typing a new Start or End date directly in the task list is an
  // alternative to dragging the bar. A milestone has no duration — its
  // start and end are always kept equal — so editing either field moves
  // the whole diamond rather than stretching a (non-existent) duration.
  function handleTaskDateEdit(row: GanttTask, field: "start" | "end", value: string) {
    if (!value) return;
    const isMilestone = row.type === "milestone";
    const startIso =
      field === "start" ? value : isMilestone ? value : toIsoDate(row.start);
    const endIso =
      field === "end" ? value : isMilestone ? value : toIsoDate(row.end);
    persistTaskDates(Number(row.id), startIso, endIso);
  }

  // A phase row's own Start/End is a computed rollup (earliest child
  // start, latest child end) — there's no planned_start_date/
  // planned_end_date column on a category to write one directly into.
  // Editing it here instead shifts every task in the phase by the same
  // number of days, so the whole phase moves earlier/later as one block
  // while every task keeps its own duration and its spacing relative to
  // the others — the same thing dragging the phase bar itself would do,
  // if gantt-task-react's project bars were draggable (they deliberately
  // aren't; see the class doc comment). Editing Start anchors the shift
  // on the earliest child's current start; editing End anchors it on the
  // latest child's current end — either way it's one uniform shift, not
  // a per-child rescale, so the result is always just the same layout
  // moved in time, never compressed or stretched.
  async function handlePhaseDateEdit(
    categoryId: number,
    field: "start" | "end",
    value: string
  ) {
    if (!value) return;
    const category = categories.find((c) => c.id === categoryId);
    if (!category || category.tasks.length === 0) return;

    const childDates = category.tasks.map(resolvedDates);
    const anchor =
      field === "start"
        ? new Date(Math.min(...childDates.map((d) => d.start.getTime())))
        : new Date(Math.max(...childDates.map((d) => d.end.getTime())));
    const deltaMs = toDate(value).getTime() - anchor.getTime();
    if (deltaMs === 0) return;

    setScheduleError(null);
    const results = await Promise.all(
      category.tasks.map((task, i) => {
        const d = childDates[i];
        const newStart = new Date(d.start.getTime() + deltaMs);
        const newEnd = new Date(d.end.getTime() + deltaMs);
        return updateTaskSchedule(
          task.id,
          projectId,
          toIsoDate(newStart),
          toIsoDate(newEnd)
        );
      })
    );
    const failed = results.find((r) => r.error);
    if (failed) {
      setScheduleError(failed.error ?? "Could not shift the phase's schedule.");
      return;
    }
    router.refresh();
  }

  function setAllPhasesOpen(open: boolean) {
    setCollapsedPhaseIds((prev) => {
      const next = new Set(prev);
      for (const category of categories) {
        if (category.tasks.length === 0) continue;
        if (open) next.delete(phaseRowId(category.id));
        else next.add(phaseRowId(category.id));
      }
      return next;
    });
  }

  // A resizable column header cell + its drag handle at the right edge.
  function HeaderCell({ id }: { id: ResizableColumnId }) {
    return (
      <div
        className={`relative flex h-full shrink-0 items-center px-2 text-xs font-medium text-zinc-700 ${
          RIGHT_ALIGNED_COLUMNS.has(id) ? "justify-end" : "justify-start"
        }`}
        style={{ width: columnWidths[id] }}
      >
        {COLUMN_LABEL[id]}
        {/* Stays fully inside this column's own box (no negative-offset
            overflow into the next column's) — an overflowing handle
            gets covered by the next column's div, since later flex
            siblings paint over an earlier sibling's overflow in normal
            stacking order. Confirmed directly: the handle was
            unclickable at exactly the boundary until this was fixed. */}
        <div
          onMouseDown={handleResizeMouseDown(id)}
          className="absolute top-0 right-0 z-10 h-full w-2 cursor-col-resize"
        >
          <div className="ml-auto h-full w-px bg-zinc-200" />
        </div>
      </div>
    );
  }

  function CustomTaskListHeader() {
    return (
      <div
        style={{ height: HEADER_HEIGHT, width: totalColumnsWidth }}
        className="flex items-center border-r border-b border-zinc-200 bg-zinc-50"
      >
        {RESIZABLE_COLUMN_IDS.map((id) =>
          id === "text" ? (
            <div
              key={id}
              className="relative flex h-full shrink-0 items-center justify-between gap-1 px-2 text-xs font-medium text-zinc-700"
              style={{ width: columnWidths[id] }}
            >
              <span>{COLUMN_LABEL[id]}</span>
              <button
                type="button"
                onClick={() => setCategoryModal({ mode: "add" })}
                aria-label="Add phase"
                title="Add phase"
                className="shrink-0 cursor-pointer rounded p-0.5 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700"
              >
                <Plus className="size-3.5" />
              </button>
              <div
                onMouseDown={handleResizeMouseDown(id)}
                className="absolute top-0 right-0 z-10 h-full w-2 cursor-col-resize"
              >
                <div className="ml-auto h-full w-px bg-zinc-200" />
              </div>
            </div>
          ) : (
            <HeaderCell key={id} id={id} />
          )
        )}
        <div
          className="flex h-full shrink-0 items-center justify-end px-2 text-xs font-medium text-zinc-700"
          style={{ width: ACTIONS_COLUMN_WIDTH }}
        >
          Actions
        </div>
      </div>
    );
  }

  function CustomTaskListTable({
    tasks: rows,
    onExpanderClick,
  }: {
    rowHeight: number;
    tasks: GanttTask[];
    selectedTaskId: string;
    setSelectedTask: (taskId: string) => void;
    onExpanderClick: (task: GanttTask) => void;
  }) {
    return (
      <div style={{ width: totalColumnsWidth }} className="border-r border-zinc-200">
        {rows.map((row) => {
          const isProject = row.type === "project";
          const category = isProject ? categoryById.get(row.id) : undefined;
          const task = !isProject ? taskById.get(row.id) : undefined;
          const days = daysBetween(row.start, row.end);
          // A phase's Start/End is only editable once it actually has
          // tasks to shift — an empty phase's row shows a placeholder
          // date range with nothing behind it to persist a shift into.
          const canEditPhaseDates =
            isProject &&
            (categories.find((c) => phaseRowId(c.id) === row.id)?.tasks
              .length ?? 0) > 0;

          return (
            <div
              key={row.id}
              style={{ height: ROW_HEIGHT }}
              className="flex items-center border-b border-zinc-100 text-xs text-zinc-600"
            >
              <div
                className="flex h-full shrink-0 items-center gap-1 truncate px-2 text-zinc-800"
                style={{ width: columnWidths.text }}
              >
                {isProject && (
                  <button
                    type="button"
                    onClick={() => onExpanderClick(row)}
                    aria-label={row.hideChildren ? "Expand phase" : "Collapse phase"}
                    className="shrink-0 cursor-pointer text-zinc-400 hover:text-zinc-700"
                  >
                    {row.hideChildren ? (
                      <ChevronRight className="size-3.5" />
                    ) : (
                      <ChevronDown className="size-3.5" />
                    )}
                  </button>
                )}
                <span
                  className={
                    isProject
                      ? "truncate font-bold"
                      : "truncate font-medium"
                  }
                >
                  {row.name}
                </span>
              </div>
              <div
                className="flex h-full shrink-0 items-center"
                style={{ width: columnWidths.start }}
              >
                {isProject && !canEditPhaseDates ? (
                  <span className="px-2">{formatDateCell(row.start)}</span>
                ) : (
                  <input
                    // Forces a remount (and so a freshly-evaluated
                    // defaultValue) whenever the underlying date actually
                    // changes — including live, frame-by-frame, while
                    // dragging the bar. Without this the input is an
                    // ordinary uncontrolled field: it mounts once and
                    // never notices row.start changing on a later
                    // render, the same reason the Days column (plain
                    // text, recomputed every render — no such staleness)
                    // already tracked a drag live and this didn't.
                    // Typing a date is unaffected: that only changes the
                    // input's own DOM value, not row.start, so the key
                    // stays put and nothing remounts mid-edit.
                    key={toIsoDate(row.start)}
                    type="date"
                    defaultValue={toIsoDate(row.start)}
                    onChange={(e) =>
                      isProject && category
                        ? handlePhaseDateEdit(category.id, "start", e.target.value)
                        : handleTaskDateEdit(row, "start", e.target.value)
                    }
                    aria-label={`${row.name} start date`}
                    className="h-full w-full cursor-pointer border-none bg-transparent px-2 text-xs text-zinc-600 scheme-light hover:bg-zinc-100 focus:bg-white focus:outline focus:-outline-offset-2 focus:outline-zinc-400"
                  />
                )}
              </div>
              <div
                className="flex h-full shrink-0 items-center"
                style={{ width: columnWidths.end }}
              >
                {isProject && !canEditPhaseDates ? (
                  <span className="px-2">{formatDateCell(row.end)}</span>
                ) : (
                  <input
                    // See the matching comment on the Start input above.
                    key={toIsoDate(row.end)}
                    type="date"
                    defaultValue={toIsoDate(row.end)}
                    onChange={(e) =>
                      isProject && category
                        ? handlePhaseDateEdit(category.id, "end", e.target.value)
                        : handleTaskDateEdit(row, "end", e.target.value)
                    }
                    aria-label={`${row.name} end date`}
                    className="h-full w-full cursor-pointer border-none bg-transparent px-2 text-xs text-zinc-600 scheme-light hover:bg-zinc-100 focus:bg-white focus:outline focus:-outline-offset-2 focus:outline-zinc-400"
                  />
                )}
              </div>
              <div
                className="flex h-full shrink-0 items-center justify-end px-2"
                style={{ width: columnWidths.duration }}
              >
                {row.type === "milestone" ? "—" : days}
              </div>
              <div
                className="flex h-full shrink-0 items-center justify-end gap-1 px-2"
                style={{ width: ACTIONS_COLUMN_WIDTH }}
              >
                {isProject && category ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setTaskModal({
                          mode: "add",
                          defaultCategoryId: category.id,
                        })
                      }
                      aria-label={`Add task to ${category.name}`}
                      title="Add task"
                      className="cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
                    >
                      <Plus className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setCategoryModal({ mode: "edit", category })}
                      aria-label="Edit category"
                      title="Edit phase"
                      className="cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <CategoryDeleteButton
                      categoryId={category.id}
                      projectId={projectId}
                      categoryName={category.name}
                    />
                  </>
                ) : (
                  !isProject &&
                  task && (
                    <>
                      <button
                        type="button"
                        onClick={() => setTaskModal({ mode: "edit", task })}
                        aria-label="Edit task item"
                        title="Edit task"
                        className="cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <TaskDeleteButton
                        taskId={task.id}
                        projectId={projectId}
                        taskName={task.name}
                      />
                    </>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const categoryOptions = categories.map((c) => ({ id: c.id, name: c.name }));
  const allTasksForPredecessor = categories.flatMap((c) =>
    c.tasks.map((t) => ({ id: t.id, name: t.name, categoryName: c.name }))
  );

  return (
    // -mx-8 breaks out of the tab content wrapper's own px-8 (set in
    // project-detail-view.tsx, shared by every other tab) so the
    // toolbar and chart below reach the true left/right edges of the
    // page instead of sitting inset within it — scoped to just this
    // component, so every other tab keeps its normal padding.
    <div className="-mx-8 flex flex-col gap-3">
      {scheduleError && (
        <p role="alert" className="text-sm text-red-600">
          {scheduleError}
        </p>
      )}

      {!hasAnyCategory ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white py-16 text-center">
          <p className="text-sm font-medium text-zinc-700">
            No phases to schedule yet
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            Add a phase to start building the schedule.
          </p>
          <button
            type="button"
            onClick={() => setCategoryModal({ mode: "add" })}
            className="mt-3 flex cursor-pointer items-center gap-1.5 rounded border border-zinc-800 bg-zinc-800 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-950"
          >
            <Plus className="size-3.5" />
            Add Phase
          </button>
        </div>
      ) : (
        // The toolbar and chart share one border/rounded-corner/bg
        // instead of each having its own — a single panel with the
        // toolbar as its header (divided off by border-b only), not two
        // separate boxes with a gap between them.
        <div className="flex flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-200 px-2 py-1.5">
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
              onClick={() => setShowTaskList((s) => !s)}
              aria-pressed={showTaskList}
              className={showTaskList ? TOOLBAR_BUTTON_ACTIVE_CLASS : TOOLBAR_BUTTON_CLASS}
            >
              {showTaskList ? "Hide" : "Show"} Task List
            </button>
          </div>

          <div
            ref={chartWrapRef}
            className="gantt-task-react-root h-220 overflow-auto"
          >
            <Gantt
              tasks={tasks}
              viewMode={VIEW_MODE[view]}
              rowHeight={ROW_HEIGHT}
              headerHeight={HEADER_HEIGHT}
              listCellWidth={showTaskList ? `${totalColumnsWidth}px` : ""}
              columnWidth={effectiveColumnWidth}
              todayColor="rgba(252, 211, 77, 0.15)"
              TooltipContent={GanttTooltipContent}
              TaskListHeader={CustomTaskListHeader}
              TaskListTable={CustomTaskListTable}
              onDateChange={(task) => persistDrag(task)}
              onExpanderClick={(task) => {
                setCollapsedPhaseIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(task.id)) next.delete(task.id);
                  else next.add(task.id);
                  return next;
                });
              }}
            />
          </div>
        </div>
      )}

      <Modal
        open={categoryModal !== null}
        onClose={() => setCategoryModal(null)}
        title={categoryModal?.mode === "edit" ? "Edit Phase" : "Add Phase"}
      >
        {categoryModal?.mode === "edit" ? (
          <CategoryForm
            projectId={projectId}
            category={categoryModal.category}
            onSuccess={() => setCategoryModal(null)}
          />
        ) : (
          <AddPhaseForm
            projectId={projectId}
            onSuccess={() => setCategoryModal(null)}
          />
        )}
      </Modal>

      <Modal
        open={taskModal !== null}
        onClose={() => setTaskModal(null)}
        title={taskModal?.mode === "edit" ? "Edit Task Item" : "Add Task Item"}
      >
        <TaskForm
          projectId={projectId}
          categories={categoryOptions}
          tasks={allTasksForPredecessor}
          task={taskModal?.mode === "edit" ? taskModal.task : undefined}
          defaultCategoryId={
            taskModal?.mode === "add" ? taskModal.defaultCategoryId : undefined
          }
          onSuccess={() => setTaskModal(null)}
        />
      </Modal>
    </div>
  );
}
